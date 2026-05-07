use std::{
    collections::{HashMap, HashSet},
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

fn cached_folder_thumbnail_path(
    dirs: &AppDirs,
    path: &Path,
    metadata: Option<&fs::Metadata>,
) -> Option<PathBuf> {
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root).join("folders");
    let thumbnail_path =
        thumbnail_dir.join(format!("{}.webp", folder_thumbnail_hash(path, metadata)));
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

fn sidecar_key(path: &Path) -> Option<String> {
    let parent = path.parent().map(normalize_path).unwrap_or_default();
    let stem = path.file_stem().and_then(|value| value.to_str())?;
    let stem = stem.strip_suffix(".inst").unwrap_or(stem);
    Some(format!("{}/{}", parent, stem).to_ascii_lowercase())
}

fn orphan_sidecar_image_path(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem().and_then(|value| value.to_str())?;
    let stem = stem.strip_suffix(".inst").unwrap_or(stem);
    Some(path.with_file_name(stem))
}

fn collect_orphan_sidecar_paths(root: &Path, image_paths: &[PathBuf]) -> Vec<PathBuf> {
    let image_keys = image_paths
        .iter()
        .filter_map(|path| sidecar_key(path))
        .collect::<HashSet<_>>();
    let mut orphan_paths = HashMap::<String, PathBuf>::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.into_path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("txt") {
            continue;
        }
        let Some(key) = sidecar_key(&path) else {
            continue;
        };
        if image_keys.contains(&key) {
            continue;
        }
        let has_content = fs::read_to_string(&path)
            .map(|content| !content.trim().is_empty())
            .unwrap_or(false);
        if !has_content {
            continue;
        }
        if let Some(image_path) = orphan_sidecar_image_path(&path) {
            orphan_paths.entry(key).or_insert(image_path);
        }
    }

    let mut paths = orphan_paths.into_values().collect::<Vec<_>>();
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    paths
}

pub fn count_orphan_sidecar_items(root: &Path) -> usize {
    let image_paths = files::collect_image_paths(root);
    collect_orphan_sidecar_paths(root, &image_paths).len()
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
        registry
            .folders
            .sort_by_key(|path| path.to_ascii_lowercase());
        write_registry(dirs, &registry)?;
    }

    Ok(())
}

pub fn remove_folder_dataset(dirs: &AppDirs, folder_path: &str) -> AppResult<usize> {
    let normalized = folder_path
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned();
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
            source_kind: Some("folder".to_owned()),
            dataset_id: Some(dataset_id(&root)),
        })
        .collect())
}

pub fn list_folder_images(dirs: &AppDirs) -> AppResult<Vec<DatasetImage>> {
    let registry = read_registry(dirs)?;
    let mut images = Vec::new();

    for root in registry
        .folders
        .iter()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        let profile_id = folder_profile_id(&root);
        let root_path = normalize_path(&root);
        let dataset_id = dataset_id(&root);
        let paths = files::collect_image_paths(&root);
        let orphan_paths = collect_orphan_sidecar_paths(&root, &paths);
        let mut entries = paths
            .into_iter()
            .map(|path| (path, false))
            .collect::<Vec<_>>();
        entries.extend(orphan_paths.into_iter().map(|path| (path, true)));

        for (index, (path, source_missing)) in entries.iter().enumerate() {
            let id = folder_image_id(&root, index);
            let metadata = (!source_missing).then(|| fs::metadata(path).ok()).flatten();
            let thumbnail_path = if *source_missing {
                None
            } else {
                Some(
                    cached_folder_thumbnail_path(dirs, path, metadata.as_ref())
                        .unwrap_or_else(|| path.to_path_buf()),
                )
            };
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
                storage_path: None,
                thumbnail_path: thumbnail_path.map(|path| path.to_string_lossy().to_string()),
                width: None,
                height: None,
                file_size: metadata.map(|metadata| metadata.len() as i64),
                file_hash: None,
                source_missing: *source_missing,
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
    if !path.is_file() && path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err(AppError::InvalidInput(format!(
            "图片路径所在目录不存在：{image_path}"
        )));
    }
    write_sidecar(annotation_path(&path), content)
}

pub fn save_folder_instruction(image_path: &str, instruction: &str) -> AppResult<()> {
    let path = PathBuf::from(image_path);
    if !path.is_file() && path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err(AppError::InvalidInput(format!(
            "图片路径所在目录不存在：{image_path}"
        )));
    }
    write_sidecar(instruction_path(&path), instruction)
}

fn renamed_image_path(path: &Path, new_name: &str) -> AppResult<PathBuf> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err(AppError::InvalidInput(
            "Image name cannot be empty or contain path separators".to_owned(),
        ));
    }

    let file_name = if Path::new(new_name).extension().is_some() {
        new_name.to_owned()
    } else if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        format!("{new_name}.{extension}")
    } else {
        new_name.to_owned()
    };

    Ok(path
        .parent()
        .map(|parent| parent.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name)))
}

pub fn rename_folder_image(image_path: &str, new_name: &str) -> AppResult<String> {
    let old_path = PathBuf::from(image_path);
    let new_path = renamed_image_path(&old_path, new_name)?;
    let old_annotation_path = annotation_path(&old_path);
    let old_instruction_path = instruction_path(&old_path);
    let new_annotation_path = annotation_path(&new_path);
    let new_instruction_path = instruction_path(&new_path);

    if old_path.is_file() && new_path.exists() && old_path != new_path {
        return Err(AppError::InvalidInput(format!(
            "Target image already exists: {}",
            new_path.to_string_lossy()
        )));
    }
    if old_annotation_path != new_annotation_path && new_annotation_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Target annotation already exists: {}",
            new_annotation_path.to_string_lossy()
        )));
    }
    if old_instruction_path != new_instruction_path && new_instruction_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Target instruction already exists: {}",
            new_instruction_path.to_string_lossy()
        )));
    }

    if old_path.is_file() && old_path != new_path {
        fs::rename(&old_path, &new_path)?;
    }
    if old_annotation_path.is_file() && old_annotation_path != new_annotation_path {
        fs::rename(old_annotation_path, new_annotation_path)?;
    }
    if old_instruction_path.is_file() && old_instruction_path != new_instruction_path {
        fs::rename(old_instruction_path, new_instruction_path)?;
    }

    Ok(new_path.to_string_lossy().to_string())
}

pub fn delete_folder_image(image_path: &str) -> AppResult<usize> {
    let path = PathBuf::from(image_path);
    let mut deleted = 0;

    for target in [
        path.clone(),
        annotation_path(&path),
        instruction_path(&path),
    ] {
        if target.is_file() {
            fs::remove_file(target)?;
            deleted += 1;
        }
    }

    Ok(deleted)
}
