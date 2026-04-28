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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: i64,
    pub image_id: i64,
    pub profile_id: i64,
    pub content: String,
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
    pub tags: Vec<String>,
    pub caption: String,
    pub annotations: Vec<Annotation>,
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
              confidence REAL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(image_id, profile_id)
            );

            CREATE TABLE IF NOT EXISTS image_tags (
              image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
              tag TEXT NOT NULL,
              source_profile TEXT NOT NULL,
              PRIMARY KEY(image_id, tag, source_profile)
            );

            CREATE TABLE IF NOT EXISTS export_presets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              profile_ids TEXT NOT NULL,
              format TEXT NOT NULL,
              filter_rules TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag);
            CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_profile ON annotations(profile_id);
            "#,
        )?;
        Ok(())
    }

    pub fn ensure_default_profiles(&self) -> AppResult<()> {
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM annotation_profiles", [], |row| {
                    row.get(0)
                })?;

        if count == 0 {
            self.conn.execute(
                "INSERT INTO annotation_profiles (id, name, format_type, source_type, description) VALUES (1, 'Manual tags', 'tags', 'manual', 'Human curated keyword tags')",
                [],
            )?;
            self.conn.execute(
                "INSERT INTO annotation_profiles (id, name, format_type, source_type, description) VALUES (2, 'Manual caption', 'caption', 'manual', 'Human written training caption')",
                [],
            )?;
        }

        Ok(())
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
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_images(&self) -> AppResult<Vec<DatasetImage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, file_name, thumbnail_path, width, height, file_size, file_hash, imported_at, updated_at
             FROM images
             ORDER BY imported_at DESC, id DESC",
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
            let tags = annotations
                .iter()
                .find(|annotation| annotation.profile_id == 1)
                .map(|annotation| {
                    annotation
                        .content
                        .split(',')
                        .map(str::trim)
                        .filter(|tag| !tag.is_empty())
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let caption = annotations
                .iter()
                .find(|annotation| annotation.profile_id == 2)
                .map(|annotation| annotation.content.clone())
                .unwrap_or_default();

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
                tags,
                caption,
                annotations,
            });
        }

        Ok(images)
    }

    pub fn insert_image_if_missing(&self, image: &NewImage) -> AppResult<bool> {
        let exists: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM images WHERE file_hash = ?1 OR path = ?2",
                params![image.file_hash, image.path.to_string_lossy()],
                |row| row.get(0),
            )
            .optional()?;

        if exists.is_some() {
            return Ok(false);
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

        Ok(true)
    }

    pub fn save_manual_annotations(
        &mut self,
        image_id: i64,
        tags: Vec<String>,
        caption: String,
    ) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        let tag_content = tags.join(", ");

        for (profile_id, content) in [(1_i64, tag_content), (2_i64, caption)] {
            tx.execute(
                "INSERT INTO annotations (image_id, profile_id, content, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(image_id, profile_id)
                 DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
                params![image_id, profile_id, content, now, now],
            )?;
        }

        tx.execute(
            "DELETE FROM image_tags WHERE image_id = ?1",
            params![image_id],
        )?;
        for tag in tags {
            tx.execute(
                "INSERT OR IGNORE INTO image_tags (image_id, tag, source_profile) VALUES (?1, ?2, 'manual')",
                params![image_id, tag],
            )?;
        }
        tx.execute(
            "UPDATE images SET updated_at = ?1 WHERE id = ?2",
            params![now, image_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn list_annotations_for_image(&self, image_id: i64) -> AppResult<Vec<Annotation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, image_id, profile_id, content, confidence, created_at, updated_at
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
                confidence: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}
