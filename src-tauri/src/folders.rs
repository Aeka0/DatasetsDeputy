use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    app_dirs::AppDirs,
    db::{Annotation, AnnotationProfile, DatasetImage},
    errors::{AppError, AppResult},
    files,
};

const FOLDER_PROFILE_NAME: &str = "TXT";
const ID_NAMESPACE_SIZE: i64 = 1_000_000;

#[derive(Default, Serialize, Deserialize)]
struct FolderRegistry {
    folders: Vec<String>,
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned()
}

fn registry_path(dirs: &AppDirs) -> &Path {
    &dirs.folder_registry
}

fn read_registry(dirs: &AppDirs) -> AppResult<FolderRegistry> {
    let path = registry_path(dirs);
    if !path.exists() {
        return Ok(FolderRegistry::default());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_registry(dirs: &AppDirs, registry: &FolderRegistry) -> AppResult<()> {
    if let Some(parent) = registry_path(dirs).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(registry_path(dirs), serde_json::to_string_pretty(registry)?)?;
    Ok(())
}

fn folder_prefix(root: &Path) -> i64 {
    let normalized = normalize_path(root).to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    1_000 + (u64::from_le_bytes(bytes) % 8_000) as i64
}

fn folder_profile_id(root: &Path) -> i64 {
    -(folder_prefix(root) * ID_NAMESPACE_SIZE)
}

fn folder_image_id(root: &Path, local_index: usize) -> i64 {
    -(folder_prefix(root) * ID_NAMESPACE_SIZE + local_index as i64 + 1)
}

fn dataset_id(root: &Path) -> String {
    format!("folder:{}", normalize_path(root))
}

fn folder_thumbnail_hash(path: &Path, metadata: Option<&fs::Metadata>) -> String {
    let normalized = normalize_path(path).to_ascii_lowercase();
    let modified = metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let len = metadata.map(fs::Metadata::len).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hasher.update(len.to_le_bytes());
    hasher.update(modified.to_le_bytes());
    format!("folder-{:x}", hasher.finalize())
}

fn cached_folder_thumbnail_path(dirs: &AppDirs, path: &Path, metadata: Option<&fs::Metadata>) -> Option<PathBuf> {
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root).join("folders");
    let thumbnail_path = thumbnail_dir.join(format!(
        "{}.webp",
        folder_thumbnail_hash(path, metadata)
    ));
    thumbnail_path.is_file().then_some(thumbnail_path)
}

fn read_text_file(path: PathBuf) -> AppResult<String> {
    if path.is_file() {
        Ok(fs::read_to_string(path)?)
    } else {
        Ok(String::new())
    }
}

fn annotation_path(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

fn instruction_path(image_path: &Path) -> PathBuf {
    let stem = image_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    image_path.with_file_name(format!("{stem}.inst.txt"))
}

fn write_sidecar(path: PathBuf, content: &str) -> AppResult<()> {
    fs::write(path, content)?;
    Ok(())
}

pub fn add_folder_dataset(dirs: &AppDirs, folder: &Path) -> AppResult<()> {
    if !folder.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Folder does not exist: {}",
            folder.to_string_lossy()
        )));
    }

    let normalized = normalize_path(folder);
    let mut registry = read_registry(dirs)?;
    if !registry
        .folders
        .iter()
        .any(|path| path.eq_ignore_ascii_case(&normalized))
    {
        registry.folders.push(normalized);
        registry.folders.sort_by_key(|path| path.to_ascii_lowercase());
        write_registry(dirs, &registry)?;
    }

    Ok(())
}

pub fn remove_folder_dataset(dirs: &AppDirs, folder_path: &str) -> AppResult<usize> {
    let normalized = folder_path.replace('\\', "/").trim_end_matches('/').to_owned();
    let mut registry = read_registry(dirs)?;
    let original_count = registry.folders.len();
    registry
        .folders
        .retain(|path| !path.eq_ignore_ascii_case(&normalized));
    write_registry(dirs, &registry)?;

    Ok(original_count.saturating_sub(registry.folders.len()))
}

pub fn list_folder_profiles(dirs: &AppDirs) -> AppResult<Vec<AnnotationProfile>> {
    let registry = read_registry(dirs)?;
    Ok(registry
        .folders
        .iter()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .map(|root| AnnotationProfile {
            id: folder_profile_id(&root),
            name: FOLDER_PROFILE_NAME.to_owned(),
            format_type: "structured".to_owned(),
            source_type: "imported".to_owned(),
            description: Some("Folder sidecar TXT annotation".to_owned()),
            model_info: None,
            source_kind: Some("folder".to_owned()),
            dataset_id: Some(dataset_id(&root)),
        })
        .collect())
}

pub fn list_folder_images(dirs: &AppDirs) -> AppResult<Vec<DatasetImage>> {
    let registry = read_registry(dirs)?;
    let mut images = Vec::new();

    for root in registry.folders.iter().map(PathBuf::from).filter(|path| path.is_dir()) {
        let profile_id = folder_profile_id(&root);
        let root_path = normalize_path(&root);
        let dataset_id = dataset_id(&root);
        let paths = files::collect_image_paths(&root);

        for (index, path) in paths.iter().enumerate() {
            let id = folder_image_id(&root, index);
            let metadata = fs::metadata(path).ok();
            let thumbnail_path = cached_folder_thumbnail_path(dirs, path, metadata.as_ref())
                .unwrap_or_else(|| path.to_path_buf());
            let annotation = read_text_file(annotation_path(path))?;
            let instruction = read_text_file(instruction_path(path))?;
            let updated_at = metadata
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
                .map(chrono::DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();

            images.push(DatasetImage {
                id,
                path: path.to_string_lossy().to_string(),
                file_name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("image")
                    .to_owned(),
                thumbnail_path: Some(thumbnail_path.to_string_lossy().to_string()),
                width: None,
                height: None,
                file_size: metadata.map(|metadata| metadata.len() as i64),
                file_hash: None,
                imported_at: updated_at.clone(),
                updated_at: updated_at.clone(),
                annotations: vec![Annotation {
                    id: id * 10 - 1,
                    image_id: id,
                    profile_id,
                    content: annotation,
                    instruction,
                    confidence: None,
                    created_at: updated_at.clone(),
                    updated_at: updated_at.clone(),
                }],
                source_kind: Some("folder".to_owned()),
                dataset_id: Some(dataset_id.clone()),
                root_path: Some(root_path.clone()),
            });
        }
    }

    Ok(images)
}

pub fn save_folder_annotation(image_path: &str, content: &str) -> AppResult<()> {
    let path = PathBuf::from(image_path);
    if !path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Image does not exist: {image_path}"
        )));
    }
    write_sidecar(annotation_path(&path), content)
}

pub fn save_folder_instruction(image_path: &str, instruction: &str) -> AppResult<()> {
    let path = PathBuf::from(image_path);
    if !path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Image does not exist: {image_path}"
        )));
    }
    write_sidecar(instruction_path(&path), instruction)
}
