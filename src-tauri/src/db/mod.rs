use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::errors::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationProfile {
    pub id: i64,
    pub name: String,
    pub format_type: String,
    pub source_type: String,
    pub description: Option<String>,
    pub model_info: Option<String>,
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
    pub thumbnail_path: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<i64>,
    pub file_hash: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
    pub annotations: Vec<Annotation>,
    pub source_kind: Option<String>,
    pub dataset_id: Option<String>,
    pub root_path: Option<String>,
}

pub struct NewImage {
    pub path: PathBuf,
    pub thumbnail_path: Option<PathBuf>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<i64>,
    pub file_hash: String,
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
              name TEXT NOT NULL,
              format_type TEXT NOT NULL,
              source_type TEXT NOT NULL,
              description TEXT,
              model_info TEXT
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

            CREATE TABLE IF NOT EXISTS export_presets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              profile_ids TEXT NOT NULL,
              format TEXT NOT NULL,
              filter_rules TEXT
            );

            CREATE TABLE IF NOT EXISTS dataset_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_profile ON annotations(profile_id);
            "#,
        )?;
        Ok(())
    }

    pub fn set_dataset_metadata(&mut self, root_name: &str, root_path: &str) -> AppResult<()> {
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

    pub fn dataset_root_path(&self) -> AppResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT value FROM dataset_metadata WHERE key = 'root_path'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_annotation_profiles(&self) -> AppResult<Vec<AnnotationProfile>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, format_type, source_type, description, model_info FROM annotation_profiles ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AnnotationProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                format_type: row.get(2)?,
                source_type: row.get(3)?,
                description: row.get(4)?,
                model_info: row.get(5)?,
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
                "SELECT id FROM annotation_profiles
                 WHERE name = ?1 AND source_type = 'imported'",
                params![name],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = existing {
            return Ok(id);
        }

        self.conn.execute(
            "INSERT INTO annotation_profiles (name, format_type, source_type, description)
             VALUES (?1, 'structured', 'imported', 'Imported dataset annotation')",
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

        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO annotation_profiles (name, format_type, source_type, description)
             VALUES (?1, 'structured', 'manual', 'Dataset-wide annotation')",
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
            "SELECT id, path, file_name, thumbnail_path, width, height, file_size, file_hash, imported_at, updated_at
             FROM images
             ORDER BY replace(path, '\', '/') COLLATE NOCASE ASC, id ASC",
        )?;

        let image_rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<u32>>(4)?,
                row.get::<_, Option<u32>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })?;

        let mut images = Vec::new();
        for image in image_rows {
            let (
                id,
                path,
                file_name,
                thumbnail_path,
                width,
                height,
                file_size,
                file_hash,
                imported_at,
                updated_at,
            ) = image?;
            let annotations = self.list_annotations_for_image(id)?;
            images.push(DatasetImage {
                id,
                path,
                file_name,
                thumbnail_path,
                width,
                height,
                file_size,
                file_hash,
                imported_at,
                updated_at,
                annotations,
                source_kind: None,
                dataset_id: None,
                root_path: None,
            });
        }

        Ok(images)
    }

    pub fn clear_thumbnail_paths(&self) -> AppResult<usize> {
        Ok(self.conn.execute(
            "UPDATE images SET thumbnail_path = NULL WHERE thumbnail_path IS NOT NULL",
            [],
        )?)
    }

    pub fn insert_image_if_missing(&self, image: &NewImage) -> AppResult<(i64, bool)> {
        let exists: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM images WHERE file_hash = ?1 OR path = ?2",
                params![image.file_hash, image.path.to_string_lossy()],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = exists {
            return Ok((id, false));
        }

        let now = Utc::now().to_rfc3339();
        let file_name = image
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned();

        self.conn.execute(
            "INSERT INTO images (path, file_name, thumbnail_path, width, height, file_size, file_hash, imported_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                image.path.to_string_lossy(),
                file_name,
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

        Ok((self.conn.last_insert_rowid(), true))
    }

    pub fn delete_images_under_path(&mut self, folder_path: &str) -> AppResult<usize> {
        let normalized_path = normalize_dataset_path(folder_path);
        let child_pattern = format!("{normalized_path}/%");
        let tx = self.conn.transaction()?;
        let deleted = tx.execute(
            r#"DELETE FROM images
               WHERE replace(path, '\', '/') = ?1
                  OR replace(path, '\', '/') LIKE ?2"#,
            params![normalized_path, child_pattern],
        )?;
        tx.execute(
            r#"DELETE FROM annotation_profiles
               WHERE NOT EXISTS (
                   SELECT 1
                   FROM annotations
                   WHERE annotations.profile_id = annotation_profiles.id
               )"#,
            [],
        )?;
        tx.commit()?;

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

    fn list_annotations_for_image(&self, image_id: i64) -> AppResult<Vec<Annotation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, image_id, profile_id, content, instruction, confidence, created_at, updated_at
             FROM annotations
             WHERE image_id = ?1
             ORDER BY profile_id",
        )?;
        let rows = stmt.query_map(params![image_id], |row| {
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

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

fn normalize_dataset_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_owned()
}
