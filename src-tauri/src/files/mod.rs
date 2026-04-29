use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::{
    db::{Database, NewImage},
    errors::AppResult,
    thumbnail,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub folder_path: String,
    pub root_name: String,
    pub image_count: usize,
    pub image_folder_count: usize,
    pub annotated_image_count: usize,
}

pub fn collect_image_paths(folder: &Path) -> Vec<PathBuf> {
    WalkDir::new(folder)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_supported_image(path))
        .collect()
}

pub fn scan_import_preview(folder: &Path) -> ImportPreview {
    let paths = collect_image_paths(folder);
    let root_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Dataset")
        .to_owned();
    let mut image_folders = HashSet::new();
    let mut annotated_image_count = 0;

    for path in &paths {
        if let Some(parent) = path.parent() {
            if parent != folder {
                image_folders.insert(parent.to_path_buf());
            }
        }

        if has_annotation_file(path) {
            annotated_image_count += 1;
        }
    }

    ImportPreview {
        folder_path: folder.to_string_lossy().to_string(),
        root_name,
        image_count: paths.len(),
        image_folder_count: image_folders.len(),
        annotated_image_count,
    }
}

pub fn import_image(db: &Database, path: &Path, thumbnail_dir: &Path) -> AppResult<bool> {
    let hash = hash_file(path)?;
    let metadata = std::fs::metadata(path)?;
    let thumbnail = thumbnail::create_thumbnail(path, thumbnail_dir, &hash)?;

    db.insert_image_if_missing(&NewImage {
        path: path.to_path_buf(),
        thumbnail_path: Some(thumbnail.path),
        width: Some(thumbnail.width),
        height: Some(thumbnail.height),
        file_size: Some(metadata.len() as i64),
        file_hash: hash,
    })
}

fn hash_file(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn is_supported_image(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif"
    )
}

fn has_annotation_file(path: &Path) -> bool {
    ["txt", "caption", "json", "jsonl"]
        .iter()
        .any(|extension| path.with_extension(extension).is_file())
}

pub fn default_thumbnail_dir(root: &Path) -> PathBuf {
    root.join("temp").join("thumbnails")
}
