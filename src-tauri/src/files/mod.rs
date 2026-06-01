use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
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

pub struct ImportImageResult {
    pub image_id: i64,
    pub has_annotation: bool,
    pub format_warning: Option<String>,
    pub storage_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug)]
pub struct QuickFileMetadata {
    pub size: i64,
    pub modified_millis: i64,
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
    let mut paths = WalkDir::new(folder)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_supported_image(path))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    paths
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

pub fn import_image(
    db: &mut Database,
    path: &Path,
    dataset_path: &Path,
    thumbnail_dir: &Path,
    asset_dir: Option<&Path>,
    import_profile_id: Option<i64>,
    thumbnail_size: u32,
) -> AppResult<ImportImageResult> {
    let hash = hash_file(path)?;
    let metadata = quick_file_metadata(path)?;
    let storage_path = match asset_dir {
        Some(asset_dir) => Some(copy_to_managed_asset_store(path, asset_dir, &hash)?),
        None => None,
    };
    let image_source_path = storage_path.as_deref().unwrap_or(path);
    let thumbnail =
        thumbnail::create_thumbnail(image_source_path, thumbnail_dir, &hash, thumbnail_size)?;

    let image_id = db.insert_image(&NewImage {
        path: path.to_path_buf(),
        dataset_path: dataset_path.to_path_buf(),
        storage_path: storage_path.clone(),
        thumbnail_path: Some(thumbnail.path.clone()),
        width: Some(thumbnail.width),
        height: Some(thumbnail.height),
        file_size: Some(metadata.size),
        file_mtime: Some(metadata.modified_millis),
        file_hash: hash,
    })?;

    let annotation_content = read_annotation_file(path)?;
    let has_annotation = annotation_content
        .as_deref()
        .map(str::trim)
        .is_some_and(|content| !content.is_empty());

    if let (Some(content), Some(profile_id)) = (annotation_content, import_profile_id) {
        db.save_imported_annotation_if_empty(image_id, profile_id, &content)?;
    }

    Ok(ImportImageResult {
        image_id,
        has_annotation,
        format_warning: thumbnail.format_warning,
        storage_path,
    })
}

fn copy_to_managed_asset_store(path: &Path, asset_dir: &Path, hash: &str) -> AppResult<PathBuf> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "bin".to_owned());
    let shard_a = &hash[..2];
    let shard_b = &hash[2..4];
    let target_dir = asset_dir.join("sha256").join(shard_a).join(shard_b);
    fs::create_dir_all(&target_dir)?;
    let target_path = target_dir.join(format!("{hash}.{extension}"));

    if !target_path.is_file() {
        fs::copy(path, &target_path)?;
    }

    Ok(target_path)
}

pub fn hash_file(path: &Path) -> AppResult<String> {
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

pub fn quick_file_metadata(path: &Path) -> AppResult<QuickFileMetadata> {
    let metadata = std::fs::metadata(path)?;
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default();
    Ok(QuickFileMetadata {
        size: metadata.len().min(i64::MAX as u64) as i64,
        modified_millis,
    })
}

pub fn quick_cache_key(path: &Path) -> AppResult<String> {
    let metadata = quick_file_metadata(path)?;
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hasher.update(metadata.size.to_le_bytes());
    hasher.update(metadata.modified_millis.to_le_bytes());
    Ok(format!("quick-{:x}", hasher.finalize()))
}

pub fn is_supported_image(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif"
    )
}

fn has_annotation_file(path: &Path) -> bool {
    annotation_candidates(path)
        .iter()
        .any(|candidate| candidate.is_file())
}

fn read_annotation_file(path: &Path) -> AppResult<Option<String>> {
    for candidate in annotation_candidates(path) {
        if candidate.is_file() {
            return Ok(Some(fs::read_to_string(candidate)?));
        }
    }

    Ok(None)
}

fn annotation_candidates(path: &Path) -> Vec<PathBuf> {
    ["txt", "caption", "json", "jsonl"]
        .iter()
        .map(|extension| path.with_extension(extension))
        .collect()
}

pub fn default_thumbnail_dir(root: &Path) -> PathBuf {
    root.join("temp").join("thumbnails")
}
