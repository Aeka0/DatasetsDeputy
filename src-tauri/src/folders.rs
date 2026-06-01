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
    files, thumbnail, thumbnail_settings, ID_NAMESPACE_SIZE,
};

const FOLDER_PROFILE_NAME: &str = "TXT";

pub struct FolderThumbnailUpdate {
    pub image_id: i64,
    pub thumbnail_path: String,
}

#[derive(Default, Serialize, Deserialize)]
struct FolderRegistry {
    folders: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct FolderIndexEntry {
    path: String,
    #[serde(default)]
    source_missing: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct FolderIndex {
    root: String,
    entries: Vec<FolderIndexEntry>,
    built_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct FolderIndexStore {
    folders: Vec<FolderIndex>,
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

fn index_path(dirs: &AppDirs) -> PathBuf {
    dirs.config.join("folder-indexes.json")
}

fn read_registry(dirs: &AppDirs) -> AppResult<FolderRegistry> {
    let path = registry_path(dirs);
    if !path.exists() {
        return Ok(FolderRegistry::default());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_index_store(dirs: &AppDirs) -> AppResult<FolderIndexStore> {
    let path = index_path(dirs);
    if !path.exists() {
        return Ok(FolderIndexStore::default());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_index_store(dirs: &AppDirs, store: &FolderIndexStore) -> AppResult<()> {
    let path = index_path(dirs);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(store)?)?;
    Ok(())
}

fn write_registry(dirs: &AppDirs, registry: &FolderRegistry) -> AppResult<()> {
    if let Some(parent) = registry_path(dirs).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(registry_path(dirs), serde_json::to_string_pretty(registry)?)?;
    Ok(())
}

fn build_folder_index(root: &Path) -> FolderIndex {
    let paths = files::collect_image_paths(root);
    let orphan_paths = collect_orphan_sidecar_paths(root, &paths);
    let mut entries = paths
        .into_iter()
        .map(|path| FolderIndexEntry {
            path: normalize_path(&path),
            source_missing: false,
        })
        .collect::<Vec<_>>();
    entries.extend(orphan_paths.into_iter().map(|path| FolderIndexEntry {
        path: normalize_path(&path),
        source_missing: true,
    }));
    entries.sort_by_key(|entry| entry.path.to_ascii_lowercase());
    entries.dedup_by(|left, right| left.path.eq_ignore_ascii_case(&right.path));

    FolderIndex {
        root: normalize_path(root),
        entries,
        built_at: Utc::now().to_rfc3339(),
    }
}

fn replace_folder_index(
    dirs: &AppDirs,
    store: &mut FolderIndexStore,
    index: FolderIndex,
) -> AppResult<()> {
    store
        .folders
        .retain(|folder| !folder.root.eq_ignore_ascii_case(&index.root));
    store.folders.push(index);
    store
        .folders
        .sort_by_key(|folder| folder.root.to_ascii_lowercase());
    write_index_store(dirs, store)
}

fn ensure_folder_index(dirs: &AppDirs, root: &Path) -> AppResult<FolderIndex> {
    let normalized = normalize_path(root);
    let mut store = read_index_store(dirs)?;
    if let Some(index) = store
        .folders
        .iter()
        .find(|index| index.root.eq_ignore_ascii_case(&normalized))
        .cloned()
    {
        return Ok(index);
    }

    let index = build_folder_index(root);
    replace_folder_index(dirs, &mut store, index.clone())?;
    Ok(index)
}

pub fn refresh_folder_index(dirs: &AppDirs, root: &Path) -> AppResult<()> {
    if !root.is_dir() {
        return Ok(());
    }
    let mut store = read_index_store(dirs)?;
    replace_folder_index(dirs, &mut store, build_folder_index(root))
}

pub fn refresh_folder_indexes(dirs: &AppDirs) -> AppResult<()> {
    let registry = read_registry(dirs)?;
    let mut store = read_index_store(dirs)?;
    let registered_roots = registry
        .folders
        .iter()
        .map(|root| root.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    store
        .folders
        .retain(|index| registered_roots.contains(&index.root.to_ascii_lowercase()));

    for root in registry
        .folders
        .iter()
        .map(PathBuf::from)
        .filter(|root| root.is_dir())
    {
        let index = build_folder_index(&root);
        store
            .folders
            .retain(|folder| !folder.root.eq_ignore_ascii_case(&index.root));
        store.folders.push(index);
    }
    store
        .folders
        .sort_by_key(|folder| folder.root.to_ascii_lowercase());
    write_index_store(dirs, &store)
}

pub fn refresh_registered_folder_for_path(dirs: &AppDirs, target: &Path) -> AppResult<()> {
    let registry = read_registry(dirs)?;
    let normalized_target = normalize_path(target).to_ascii_lowercase();
    for root in registry.folders.iter().map(PathBuf::from) {
        let normalized_root = normalize_path(&root).to_ascii_lowercase();
        if normalized_target == normalized_root
            || normalized_target.starts_with(&format!("{normalized_root}/"))
        {
            return refresh_folder_index(dirs, &root);
        }
    }
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

fn folder_image_id(root: &Path, image_path: &Path) -> i64 {
    let normalized_root = normalize_path(root).to_ascii_lowercase();
    let normalized_path = normalize_path(image_path).to_ascii_lowercase();
    let relative_path = normalized_path
        .strip_prefix(&normalized_root)
        .map(|path| path.trim_start_matches('/'))
        .unwrap_or(normalized_path.as_str());
    let mut hasher = Sha256::new();
    hasher.update(relative_path.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    let local_id = (u64::from_le_bytes(bytes) % (ID_NAMESPACE_SIZE as u64 - 1)) as i64 + 1;
    -(folder_prefix(root) * ID_NAMESPACE_SIZE + local_id)
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
    thumbnail::is_valid_thumbnail(&thumbnail_path).then_some(thumbnail_path)
}

fn folder_thumbnail_path(
    dirs: &AppDirs,
    path: &Path,
    metadata: Option<&fs::Metadata>,
) -> Option<PathBuf> {
    cached_folder_thumbnail_path(dirs, path, metadata)
}

pub fn ensure_folder_thumbnails(
    dirs: &AppDirs,
    image_ids: &HashSet<i64>,
) -> AppResult<Vec<FolderThumbnailUpdate>> {
    if image_ids.is_empty() {
        return Ok(Vec::new());
    }

    let registry = read_registry(dirs)?;
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root).join("folders");
    let thumbnail_size = thumbnail_settings::load_settings(dirs)
        .map(|settings| settings.thumbnail_size)
        .unwrap_or(256);
    let mut updates = Vec::new();
    let mut remaining_ids = image_ids.clone();

    for root in registry
        .folders
        .iter()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        if remaining_ids.is_empty() {
            break;
        }

        let index = ensure_folder_index(dirs, &root)?;
        for entry in index.entries {
            if entry.source_missing {
                continue;
            }
            let path = PathBuf::from(&entry.path);
            if !path.is_file() || !files::is_supported_image(&path) {
                continue;
            }
            let id = folder_image_id(&root, &path);
            if !remaining_ids.remove(&id) {
                continue;
            }
            let metadata = fs::metadata(&path).ok();
            if let Some(thumbnail_path) =
                cached_folder_thumbnail_path(dirs, &path, metadata.as_ref())
            {
                updates.push(FolderThumbnailUpdate {
                    image_id: id,
                    thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
                });
                continue;
            }
            let hash = folder_thumbnail_hash(&path, metadata.as_ref());
            if let Ok(thumbnail) =
                thumbnail::create_thumbnail(&path, &thumbnail_dir, &hash, thumbnail_size)
            {
                updates.push(FolderThumbnailUpdate {
                    image_id: id,
                    thumbnail_path: thumbnail.path.to_string_lossy().to_string(),
                });
            }

            if remaining_ids.is_empty() {
                break;
            }
        }
    }

    Ok(updates)
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

pub fn add_folder_dataset(dirs: &AppDirs, folder: &Path) -> AppResult<bool> {
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
        refresh_folder_index(dirs, folder)?;
        return Ok(true);
    }

    Ok(false)
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
    let mut store = read_index_store(dirs)?;
    store
        .folders
        .retain(|index| !index.root.eq_ignore_ascii_case(&normalized));
    write_index_store(dirs, &store)?;

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
        let index = ensure_folder_index(dirs, &root)?;

        for entry in index.entries {
            let path = PathBuf::from(&entry.path);
            let id = folder_image_id(&root, &path);
            let source_missing = entry.source_missing || !path.is_file();
            let annotation = read_text_file(annotation_path(&path))?;
            let instruction = read_text_file(instruction_path(&path))?;
            if source_missing && annotation.trim().is_empty() && instruction.trim().is_empty() {
                continue;
            }
            let metadata = (!source_missing)
                .then(|| fs::metadata(&path).ok())
                .flatten();
            let thumbnail_path = if source_missing {
                None
            } else {
                folder_thumbnail_path(dirs, &path, metadata.as_ref())
            };
            let updated_at = metadata
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
                .map(chrono::DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();

            images.push(DatasetImage {
                id,
                path: path.to_string_lossy().to_string(),
                dataset_path: None,
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
                source_missing,
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
                root_name: None,
                root_path: Some(root_path.clone()),
            });
        }
    }

    Ok(images)
}

pub fn is_path_within_registered_folder(dirs: &AppDirs, target: &Path) -> AppResult<bool> {
    let registry = read_registry(dirs)?;
    let canonical_target = dunce::canonicalize(target)
        .or_else(|_| {
            target
                .parent()
                .and_then(|p| dunce::canonicalize(p).ok())
                .map(|p| p.join(target.file_name().unwrap_or_default()))
                .ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::NotFound, "无法解析目标路径")
                })
        })
        .map(|p| normalize_path(&p))?;

    for folder in &registry.folders {
        if let Ok(canonical_folder) = dunce::canonicalize(folder) {
            let normalized_folder = normalize_path(&canonical_folder);
            if canonical_target == normalized_folder
                || canonical_target.starts_with(&format!("{normalized_folder}/"))
            {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn require_path_within_registered_folder(dirs: &AppDirs, target: &Path) -> AppResult<()> {
    if !is_path_within_registered_folder(dirs, target)? {
        return Err(AppError::InvalidInput(
            "目标路径不在已注册的工作文件夹范围内".to_owned(),
        ));
    }
    Ok(())
}

pub fn require_subfolder_of_registered(dirs: &AppDirs, target: &Path) -> AppResult<()> {
    let registry = read_registry(dirs)?;
    let canonical_target = dunce::canonicalize(target).map_err(|_| {
        AppError::InvalidInput(format!("无法解析目标路径：{}", target.to_string_lossy()))
    })?;
    let normalized_target = normalize_path(&canonical_target);

    for folder in &registry.folders {
        if let Ok(canonical_folder) = dunce::canonicalize(folder) {
            let normalized_folder = normalize_path(&canonical_folder);
            if normalized_target.starts_with(&format!("{normalized_folder}/")) {
                return Ok(());
            }
        }
    }

    Err(AppError::InvalidInput(
        "目标路径必须是已注册工作文件夹的子目录".to_owned(),
    ))
}

pub fn save_folder_annotation(dirs: &AppDirs, image_path: &str, content: &str) -> AppResult<()> {
    let path = PathBuf::from(image_path);
    require_path_within_registered_folder(dirs, &path)?;
    if !path.is_file() && path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err(AppError::InvalidInput(format!(
            "图片路径所在目录不存在：{image_path}"
        )));
    }
    write_sidecar(annotation_path(&path), content)
}

pub fn save_folder_instruction(
    dirs: &AppDirs,
    image_path: &str,
    instruction: &str,
) -> AppResult<()> {
    let path = PathBuf::from(image_path);
    require_path_within_registered_folder(dirs, &path)?;
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

fn validate_child_folder_name(name: &str) -> AppResult<&str> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return Err(AppError::InvalidInput(
            "Folder name cannot be empty or contain path separators".to_owned(),
        ));
    }
    Ok(name)
}

fn execute_file_moves(moves: &[(PathBuf, PathBuf)]) -> AppResult<()> {
    let mut completed: Vec<(&PathBuf, &PathBuf)> = Vec::new();
    for (source, target) in moves {
        if let Err(error) = fs::rename(source, target) {
            for (completed_source, completed_target) in completed.into_iter().rev() {
                let _ = fs::rename(completed_target, completed_source);
            }
            return Err(error.into());
        }
        completed.push((source, target));
    }
    Ok(())
}

pub fn consolidate_folder_loose_files(
    dirs: &AppDirs,
    folder_path: &str,
    folder_name: &str,
    image_paths: &[String],
) -> AppResult<usize> {
    let folder_name = validate_child_folder_name(folder_name)?;
    let parent = PathBuf::from(folder_path);
    if !parent.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Parent folder does not exist: {folder_path}"
        )));
    }
    require_path_within_registered_folder(dirs, &parent)?;

    let target_folder = parent.join(folder_name);
    if target_folder.exists() {
        return Err(AppError::InvalidInput(format!(
            "Target folder already exists: {}",
            target_folder.to_string_lossy()
        )));
    }

    let normalized_parent = normalize_path(&parent);
    let mut file_moves = Vec::new();
    let mut moved_images = 0;
    for image_path in image_paths {
        let source = PathBuf::from(image_path);
        if source.parent().map(normalize_path).unwrap_or_default() != normalized_parent {
            return Err(AppError::InvalidInput(format!(
                "Image is not a direct loose file under {folder_path}: {image_path}"
            )));
        }

        let Some(file_name) = source.file_name() else {
            continue;
        };
        if !source.is_file() {
            return Err(AppError::InvalidInput(format!(
                "Loose image no longer exists: {image_path}"
            )));
        }
        let target = target_folder.join(file_name);
        let annotation_source = annotation_path(&source);
        let instruction_source = instruction_path(&source);
        let annotation_target = annotation_path(&target);
        let instruction_target = instruction_path(&target);

        for target_path in [&target, &annotation_target, &instruction_target] {
            if target_path.exists() {
                return Err(AppError::InvalidInput(format!(
                    "Target file already exists: {}",
                    target_path.to_string_lossy()
                )));
            }
        }

        file_moves.push((source, target));
        moved_images += 1;
        if annotation_source.is_file() {
            file_moves.push((annotation_source, annotation_target));
        }
        if instruction_source.is_file() {
            file_moves.push((instruction_source, instruction_target));
        }
    }

    fs::create_dir_all(&target_folder)?;
    if let Err(error) = execute_file_moves(&file_moves) {
        if fs::read_dir(&target_folder).is_ok_and(|mut entries| entries.next().is_none()) {
            let _ = fs::remove_dir(&target_folder);
        }
        return Err(error);
    }

    Ok(moved_images)
}

pub fn restore_consolidated_folder_loose_files(
    dirs: &AppDirs,
    folder_path: &str,
    folder_name: &str,
    image_paths: &[String],
) -> AppResult<usize> {
    let folder_name = validate_child_folder_name(folder_name)?;
    let parent = PathBuf::from(folder_path);
    require_path_within_registered_folder(dirs, &parent)?;
    let target_folder = parent.join(folder_name);
    let mut file_moves = Vec::new();
    let mut restored_images = 0;
    for original_path in image_paths {
        let original = PathBuf::from(original_path);
        let file_name = original.file_name().ok_or_else(|| {
            AppError::InvalidInput(format!("Image path has no file name: {original_path}"))
        })?;
        let current = target_folder.join(file_name);
        let annotation_current = annotation_path(&current);
        let annotation_original = annotation_path(&original);
        let instruction_current = instruction_path(&current);
        let instruction_original = instruction_path(&original);
        if !current.is_file()
            || original.exists()
            || annotation_original.exists()
            || instruction_original.exists()
        {
            return Err(AppError::InvalidInput(format!(
                "Consolidated image has been changed: {}",
                current.to_string_lossy()
            )));
        }
        file_moves.push((current, original));
        restored_images += 1;
        if annotation_current.is_file() {
            file_moves.push((annotation_current, annotation_original));
        }
        if instruction_current.is_file() {
            file_moves.push((instruction_current, instruction_original));
        }
    }
    execute_file_moves(&file_moves)?;
    if target_folder.is_dir() && fs::read_dir(&target_folder)?.next().is_none() {
        fs::remove_dir(target_folder)?;
    }
    Ok(restored_images)
}

pub fn delete_folder_images(image_paths: &[String]) -> AppResult<usize> {
    let mut deleted = 0;
    for image_path in image_paths {
        deleted += delete_folder_image(image_path)?;
    }
    Ok(deleted)
}
