use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::errors::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationProfile {
    pub id: i64,
    pub name: String,
    pub source_kind: Option<String>,
    pub dataset_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: i64,
    pub image_id: i64,
    pub profile_id: i64,
    pub content: String,
    pub instruction: String,
    pub confidence: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetImage {
    pub id: i64,
    pub path: String,
    pub file_name: String,
    pub storage_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<i64>,
    pub file_hash: Option<String>,
    pub source_missing: bool,
    pub imported_at: String,
    pub updated_at: String,
    pub annotations: Vec<Annotation>,
    pub source_kind: Option<String>,
    pub dataset_id: Option<String>,
    pub root_path: Option<String>,
}

pub struct NewImage {
    pub path: PathBuf,
    pub storage_path: Option<PathBuf>,
    pub thumbnail_path: Option<PathBuf>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<i64>,
    pub file_hash: String,
}

pub struct ImageSourceMetadata {
    pub file_size: i64,
    pub file_hash: String,
    pub thumbnail_path: Option<PathBuf>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub struct AnnotationChange {
    pub image_id: i64,
    pub profile_id: i64,
    pub content: Option<String>,
    pub instruction: Option<String>,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { conn })
    }

    pub fn migrate(&self) -> AppResult<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS images (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              path TEXT NOT NULL UNIQUE,
              file_name TEXT NOT NULL,
              storage_path TEXT,
              thumbnail_path TEXT,
              width INTEGER,
              height INTEGER,
              file_size INTEGER,
              file_hash TEXT NOT NULL UNIQUE,
              imported_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS annotation_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL COLLATE NOCASE UNIQUE
            );

            CREATE TABLE IF NOT EXISTS annotations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
              profile_id INTEGER NOT NULL REFERENCES annotation_profiles(id) ON DELETE CASCADE,
              content TEXT NOT NULL,
              instruction TEXT NOT NULL DEFAULT '',
              confidence REAL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(image_id, profile_id)
            );

            CREATE TABLE IF NOT EXISTS dataset_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_profile ON annotations(profile_id);
            "#,
        )?;
        self.ensure_images_storage_path_column()?;
        self.drop_annotation_profile_legacy_columns()?;
        Ok(())
    }

    fn ensure_images_storage_path_column(&self) -> AppResult<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(images)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;

        if !columns.iter().any(|existing| existing == "storage_path") {
            self.conn
                .execute("ALTER TABLE images ADD COLUMN storage_path TEXT", [])?;
        }

        Ok(())
    }

    fn drop_annotation_profile_legacy_columns(&self) -> AppResult<()> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(annotation_profiles)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;

        for column in ["format_type", "source_type", "description", "model_info"] {
            if columns.iter().any(|existing| existing == column) {
                self.conn.execute(
                    &format!("ALTER TABLE annotation_profiles DROP COLUMN {column}"),
                    [],
                )?;
            }
        }

        Ok(())
    }

    pub fn set_dataset_metadata(
        &mut self,
        root_name: &str,
        root_path: &str,
        source_kind: &str,
    ) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO dataset_metadata (key, value) VALUES ('root_name', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![root_name],
        )?;
        tx.execute(
            "INSERT INTO dataset_metadata (key, value) VALUES ('root_path', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![root_path],
        )?;
        tx.execute(
            "INSERT INTO dataset_metadata (key, value) VALUES ('source_kind', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![source_kind],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn rename_folder_paths(
        &mut self,
        old_folder_path: &str,
        new_folder_path: &str,
    ) -> AppResult<usize> {
        let old_folder_path = normalize_dataset_path(old_folder_path);
        let new_folder_path = normalize_dataset_path(new_folder_path);
        let old_child_prefix = format!("{old_folder_path}/");
        let now = Utc::now().to_rfc3339();
        let images = self
            .list_images()?
            .into_iter()
            .filter_map(|image| {
                let normalized_path = normalize_dataset_path(&image.path);
                if normalized_path == old_folder_path {
                    Some((image.id, new_folder_path.clone()))
                } else if normalized_path.starts_with(&old_child_prefix) {
                    Some((
                        image.id,
                        format!(
                            "{}{}",
                            new_folder_path,
                            &normalized_path[old_folder_path.len()..]
                        ),
                    ))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let renamed = images.len();

        let tx = self.conn.transaction()?;
        for (image_id, path) in images {
            tx.execute(
                "UPDATE images SET path = ?1, updated_at = ?2 WHERE id = ?3",
                params![path, now, image_id],
            )?;
        }

        let root_path: Option<String> = tx
            .query_row(
                "SELECT value FROM dataset_metadata WHERE key = 'root_path'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if root_path.as_deref().map(normalize_dataset_path).as_deref()
            == Some(old_folder_path.as_str())
        {
            let root_name = Path::new(&new_folder_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Dataset");
            tx.execute(
                "INSERT INTO dataset_metadata (key, value) VALUES ('root_name', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![root_name],
            )?;
            tx.execute(
                "INSERT INTO dataset_metadata (key, value) VALUES ('root_path', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![new_folder_path],
            )?;
        }

        tx.commit()?;
        Ok(renamed)
    }

    pub fn dataset_source_kind(&self) -> AppResult<String> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM dataset_metadata WHERE key = 'source_kind'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(|| "database".to_owned()))
    }

    pub fn list_annotation_profiles(&self) -> AppResult<Vec<AnnotationProfile>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name FROM annotation_profiles ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok(AnnotationProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                source_kind: None,
                dataset_id: None,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn ensure_import_profile(&self, name: &str) -> AppResult<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(crate::errors::AppError::InvalidInput(
                "Import annotation profile name cannot be empty".to_owned(),
            ));
        }

        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM annotation_profiles WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = existing {
            return Ok(id);
        }

        self.conn.execute(
            "INSERT INTO annotation_profiles (name) VALUES (?1)",
            params![name],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    pub fn create_dataset_annotation_profile(
        &mut self,
        name: String,
        image_ids: Vec<i64>,
    ) -> AppResult<i64> {
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(crate::errors::AppError::InvalidInput(
                "Annotation profile name cannot be empty".to_owned(),
            ));
        }

        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM annotation_profiles WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |row| row.get(0),
            )
            .optional()?;

        if existing.is_some() {
            return Err(crate::errors::AppError::InvalidInput(
                "Annotation profile name already exists".to_owned(),
            ));
        }

        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO annotation_profiles (name) VALUES (?1)",
            params![name],
        )?;
        let profile_id = tx.last_insert_rowid();

        for image_id in image_ids {
            tx.execute(
                "INSERT OR IGNORE INTO annotations (image_id, profile_id, content, created_at, updated_at)
                 VALUES (?1, ?2, '', ?3, ?4)",
                params![image_id, profile_id, now, now],
            )?;
        }

        tx.commit()?;
        Ok(profile_id)
    }

    pub fn list_images(&self) -> AppResult<Vec<DatasetImage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, file_name, storage_path, thumbnail_path, width, height, file_size, file_hash, imported_at, updated_at
             FROM images
             ORDER BY replace(path, '\', '/') COLLATE NOCASE ASC, id ASC",
        )?;

        let image_rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<u32>>(5)?,
                row.get::<_, Option<u32>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?;

        let mut images = Vec::new();
        let mut image_index_by_id = HashMap::new();
        for image in image_rows {
            let (
                id,
                path,
                file_name,
                storage_path,
                thumbnail_path,
                width,
                height,
                file_size,
                file_hash,
                imported_at,
                updated_at,
            ) = image?;
            image_index_by_id.insert(id, images.len());
            images.push(DatasetImage {
                id,
                path,
                file_name,
                storage_path,
                thumbnail_path,
                width,
                height,
                file_size,
                file_hash,
                source_missing: false,
                imported_at,
                updated_at,
                annotations: Vec::new(),
                source_kind: None,
                dataset_id: None,
                root_path: None,
            });
        }

        let mut annotation_stmt = self.conn.prepare(
            "SELECT id, image_id, profile_id, content, instruction, confidence, created_at, updated_at
             FROM annotations
             ORDER BY image_id, profile_id",
        )?;
        let annotation_rows = annotation_stmt.query_map([], |row| {
            Ok(Annotation {
                id: row.get(0)?,
                image_id: row.get(1)?,
                profile_id: row.get(2)?,
                content: row.get(3)?,
                instruction: row.get(4)?,
                confidence: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;

        for annotation in annotation_rows {
            let annotation = annotation?;
            if let Some(index) = image_index_by_id.get(&annotation.image_id) {
                images[*index].annotations.push(annotation);
            }
        }

        Ok(images)
    }

    pub fn clear_thumbnail_paths(&self) -> AppResult<usize> {
        Ok(self.conn.execute(
            "UPDATE images SET thumbnail_path = NULL WHERE thumbnail_path IS NOT NULL",
            [],
        )?)
    }

    pub fn insert_image(&self, image: &NewImage) -> AppResult<i64> {
        let now = Utc::now().to_rfc3339();
        let file_name = image
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned();

        self.conn.execute(
            "INSERT INTO images (path, file_name, storage_path, thumbnail_path, width, height, file_size, file_hash, imported_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                image.path.to_string_lossy(),
                file_name,
                image
                    .storage_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                image
                    .thumbnail_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                image.width,
                image.height,
                image.file_size,
                image.file_hash,
                now,
                now
            ],
        )?;

        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_image_source_metadata(
        &mut self,
        image_id: i64,
        metadata: &ImageSourceMetadata,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE images
             SET thumbnail_path = ?1,
                 width = ?2,
                 height = ?3,
                 file_size = ?4,
                 file_hash = ?5,
                 updated_at = ?6
             WHERE id = ?7",
            params![
                metadata
                    .thumbnail_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                metadata.width,
                metadata.height,
                metadata.file_size,
                metadata.file_hash,
                now,
                image_id
            ],
        )?;
        Ok(())
    }

    pub fn rename_image(&mut self, image_id: i64, new_name: &str) -> AppResult<String> {
        let new_name = new_name.trim();
        if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
            return Err(crate::errors::AppError::InvalidInput(
                "Image name cannot be empty or contain path separators".to_owned(),
            ));
        }

        let old_path: String = self.conn.query_row(
            "SELECT path FROM images WHERE id = ?1",
            params![image_id],
            |row| row.get(0),
        )?;
        let old_path_buf = PathBuf::from(&old_path);
        let new_path = old_path_buf
            .parent()
            .map(|parent| parent.join(new_name))
            .unwrap_or_else(|| PathBuf::from(new_name));
        let new_path_string = new_path.to_string_lossy().to_string();
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            "UPDATE images SET path = ?1, file_name = ?2, updated_at = ?3 WHERE id = ?4",
            params![new_path_string, new_name, now, image_id],
        )?;

        Ok(new_path.to_string_lossy().to_string())
    }

    pub fn get_image_storage_path(&self, image_id: i64) -> AppResult<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT storage_path FROM images WHERE id = ?1",
                params![image_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten())
    }

    pub fn get_storage_paths_under_path(&self, folder_path: &str) -> AppResult<Vec<String>> {
        let normalized_path = normalize_dataset_path(folder_path);
        let child_pattern = format!("{normalized_path}/%");
        let mut stmt = self.conn.prepare(
            r#"SELECT storage_path FROM images
               WHERE storage_path IS NOT NULL
                 AND (replace(path, '\', '/') = ?1
                  OR replace(path, '\', '/') LIKE ?2)"#,
        )?;
        let paths = stmt
            .query_map(params![normalized_path, child_pattern], |row| {
                row.get::<_, String>(0)
            })?
            .filter_map(Result::ok)
            .collect();
        Ok(paths)
    }

    pub fn get_all_storage_paths(&self) -> AppResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT storage_path FROM images WHERE storage_path IS NOT NULL")?;
        let paths = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        Ok(paths)
    }

    pub fn has_storage_path_reference(&self, storage_path: &str) -> AppResult<bool> {
        let normalized = storage_path.replace('\\', "/");
        let count: i64 = self.conn.query_row(
            r#"SELECT COUNT(*) FROM images
               WHERE replace(storage_path, '\', '/') = ?1"#,
            params![normalized],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn delete_image(&mut self, image_id: i64) -> AppResult<usize> {
        let deleted = self
            .conn
            .execute("DELETE FROM images WHERE id = ?1", params![image_id])?;
        Ok(deleted)
    }

    pub fn delete_images_under_path(&mut self, folder_path: &str) -> AppResult<usize> {
        let normalized_path = normalize_dataset_path(folder_path);
        let child_pattern = format!("{normalized_path}/%");
        let deleted = self.conn.execute(
            r#"DELETE FROM images
               WHERE replace(path, '\', '/') = ?1
                  OR replace(path, '\', '/') LIKE ?2"#,
            params![normalized_path, child_pattern],
        )?;
        Ok(deleted)
    }

    pub fn upsert_annotation(
        &mut self,
        image_id: i64,
        profile_id: i64,
        content: String,
    ) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO annotations (image_id, profile_id, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(image_id, profile_id)
             DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
            params![image_id, profile_id, content, now, now],
        )?;

        tx.execute(
            "UPDATE images SET updated_at = ?1 WHERE id = ?2",
            params![now, image_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_instruction(
        &mut self,
        image_id: i64,
        profile_id: i64,
        instruction: String,
    ) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO annotations (image_id, profile_id, content, instruction, created_at, updated_at)
             VALUES (?1, ?2, '', ?3, ?4, ?5)
             ON CONFLICT(image_id, profile_id)
             DO UPDATE SET instruction = excluded.instruction, updated_at = excluded.updated_at",
            params![image_id, profile_id, instruction, now, now],
        )?;

        tx.execute(
            "UPDATE images SET updated_at = ?1 WHERE id = ?2",
            params![now, image_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_annotation_changes(&mut self, changes: Vec<AnnotationChange>) -> AppResult<()> {
        if changes.is_empty() {
            return Ok(());
        }

        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        {
            let mut content_stmt = tx.prepare(
                "INSERT INTO annotations (image_id, profile_id, content, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(image_id, profile_id)
                 DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
            )?;
            let mut instruction_stmt = tx.prepare(
                "INSERT INTO annotations (image_id, profile_id, content, instruction, created_at, updated_at)
                 VALUES (?1, ?2, '', ?3, ?4, ?5)
                 ON CONFLICT(image_id, profile_id)
                 DO UPDATE SET instruction = excluded.instruction, updated_at = excluded.updated_at",
            )?;
            let mut image_stmt = tx.prepare("UPDATE images SET updated_at = ?1 WHERE id = ?2")?;

            for change in changes {
                if let Some(content) = change.content {
                    content_stmt.execute(params![
                        change.image_id,
                        change.profile_id,
                        content,
                        now,
                        now
                    ])?;
                }
                if let Some(instruction) = change.instruction {
                    instruction_stmt.execute(params![
                        change.image_id,
                        change.profile_id,
                        instruction,
                        now,
                        now
                    ])?;
                }
                image_stmt.execute(params![now, change.image_id])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn clear_annotation(&mut self, annotation_id: i64) -> AppResult<()> {
        let annotation: Option<(i64, i64)> = self
            .conn
            .query_row(
                "SELECT image_id, profile_id FROM annotations WHERE id = ?1",
                params![annotation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        let Some((image_id, _profile_id)) = annotation else {
            return Ok(());
        };

        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE annotations SET content = '', updated_at = ?1 WHERE id = ?2",
            params![now, annotation_id],
        )?;

        tx.execute(
            "UPDATE images SET updated_at = ?1 WHERE id = ?2",
            params![now, image_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn save_imported_annotation_if_empty(
        &mut self,
        image_id: i64,
        profile_id: i64,
        content: &str,
    ) -> AppResult<bool> {
        let content = content.trim();
        if content.is_empty() {
            return Ok(false);
        }

        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT content FROM annotations WHERE image_id = ?1 AND profile_id = ?2",
                params![image_id, profile_id],
                |row| row.get(0),
            )
            .optional()?;

        if existing
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        {
            return Ok(false);
        }

        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO annotations (image_id, profile_id, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(image_id, profile_id)
             DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
            params![image_id, profile_id, content, now, now],
        )?;

        tx.execute(
            "UPDATE images SET updated_at = ?1 WHERE id = ?2",
            params![now, image_id],
        )?;
        tx.commit()?;
        Ok(true)
    }
}

fn normalize_dataset_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_owned()
}
