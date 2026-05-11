use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_dirs,
    db::{AnnotationChange, AnnotationProfile, Database, DatasetImage, ImageSourceMetadata},
    errors::{AppError, AppResult},
    export::{self, ExportDatasetRequest, ExportItem, ExportPreview, PreparedExport},
    files::{self, ImportPreview, ImportSummary},
    folders,
    gemini::{self, GeminiSettings},
    model_settings::{self, ModelSettings},
    python_env::{self, PythonEnvInstallResult, PythonEnvProbeReport, PythonEnvSettings},
    thumbnail,
    thumbnail_settings::{self, ThumbnailSettings},
    wd14_tagger,
    window_rendering::{self, WindowRenderingSettings},
    AppState, ID_NAMESPACE_SIZE,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub file_path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    pub file_path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub root_name: Option<String>,
    pub root_path: Option<String>,
    pub success_without_annotations: usize,
    pub success_with_annotations: usize,
    pub failed: usize,
    pub failures: Vec<ImportFailure>,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: String,
    pub processed: usize,
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub current_path: Option<String>,
    pub root_name: Option<String>,
    pub root_path: Option<String>,
    pub done: bool,
    pub report: Option<ImportReport>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCacheInfo {
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilesInfo {
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemItemCheckSummary {
    pub checked: usize,
    pub updated: usize,
    pub missing: usize,
    pub failed: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImageImportPreview {
    pub target_folder_path: String,
    pub image_paths: Vec<String>,
    pub image_count: usize,
    pub annotation_count: usize,
    pub instruction_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImageImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub annotation_count: usize,
    pub instruction_count: usize,
}

struct ImageImportTarget {
    target: Option<PathBuf>,
    source_kind: String,
    database_prefix: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPathSelection {
    pub path: String,
    pub model_type: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wd14AnnotationProgress {
    pub start: usize,
    pub contents: Vec<String>,
    pub execution_provider: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAnnotationChange {
    pub image_id: i64,
    pub profile_id: i64,
    pub content: Option<String>,
    pub instruction: Option<String>,
}

#[tauri::command]
pub fn finish_startup(app: AppHandle) -> Result<(), String> {
    finish_startup_windows(app)
}

pub fn finish_startup_windows(app: AppHandle) -> Result<(), String> {
    let app_for_thread = app.clone();
    app.run_on_main_thread(move || {
        let Some(main_window) = app_for_thread.get_webview_window("main") else {
            tracing::error!("启动切换失败：未找到主窗口。");
            return;
        };

        if let Err(error) = main_window.show() {
            tracing::error!("启动切换失败：显示主窗口失败：{error}");
            return;
        }
        if let Err(error) = main_window.set_focus() {
            tracing::warn!("启动切换警告：聚焦主窗口失败：{error}");
        }

        if let Some(splash_window) = app_for_thread.get_webview_window("splash") {
            if let Err(error) = splash_window.hide() {
                tracing::warn!("启动切换警告：隐藏 Splash 窗口失败：{error}");
            }
            if let Err(error) = splash_window.close() {
                tracing::warn!("启动切换警告：关闭 Splash 窗口失败：{error}");
            }
        }
    })
    .map_err(|error| format!("调度启动窗口切换失败：{error}"))
}

struct DatasetDatabaseRef {
    prefix: i64,
    path: PathBuf,
}

fn stable_database_prefix(path: &Path) -> i64 {
    let normalized = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    10_000 + (u64::from_le_bytes(bytes) % 9_000_000) as i64
}

fn dataset_database_refs(dirs: &app_dirs::AppDirs) -> AppResult<Vec<DatasetDatabaseRef>> {
    let mut paths = fs::read_dir(&dirs.dataset_databases)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sqlite"))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    let mut used_prefixes = HashSet::new();
    let refs = paths
        .into_iter()
        .map(|path| {
            let mut prefix = stable_database_prefix(&path);
            while used_prefixes.contains(&prefix) {
                prefix += 1;
            }
            used_prefixes.insert(prefix);
            DatasetDatabaseRef { prefix, path }
        })
        .collect();
    Ok(refs)
}

fn to_public_id(prefix: i64, local_id: i64) -> i64 {
    prefix * ID_NAMESPACE_SIZE + local_id
}

fn split_public_id(public_id: i64) -> AppResult<(i64, i64)> {
    let prefix = public_id / ID_NAMESPACE_SIZE;
    let local_id = public_id % ID_NAMESPACE_SIZE;
    if prefix <= 0 || local_id <= 0 {
        return Err(AppError::InvalidInput(format!(
            "Invalid dataset-scoped id: {public_id}"
        )));
    }
    Ok((prefix, local_id))
}

fn open_database(path: &Path) -> AppResult<Database> {
    let db = Database::open(path)?;
    db.migrate()?;
    Ok(db)
}

fn open_database_by_prefix(
    dirs: &app_dirs::AppDirs,
    prefix: i64,
) -> AppResult<(Database, PathBuf)> {
    let db_ref = dataset_database_refs(dirs)?
        .into_iter()
        .find(|db_ref| db_ref.prefix == prefix)
        .ok_or_else(|| AppError::InvalidInput(format!("Dataset database not found: {prefix}")))?;
    Ok((open_database(&db_ref.path)?, db_ref.path))
}

fn namespace_profile(
    mut profile: AnnotationProfile,
    prefix: i64,
    source_kind: &str,
) -> AnnotationProfile {
    profile.id = to_public_id(prefix, profile.id);
    profile.source_kind = Some(source_kind.to_owned());
    profile.dataset_id = Some(format!("{source_kind}:{prefix}"));
    profile
}

fn namespace_image(mut image: DatasetImage, prefix: i64, source_kind: &str) -> DatasetImage {
    let source_path = if source_kind == "asset" {
        image.storage_path.as_deref().unwrap_or(&image.path)
    } else {
        &image.path
    };
    image.id = to_public_id(prefix, image.id);
    for annotation in &mut image.annotations {
        annotation.id = to_public_id(prefix, annotation.id);
        annotation.image_id = to_public_id(prefix, annotation.image_id);
        annotation.profile_id = to_public_id(prefix, annotation.profile_id);
    }
    image.source_missing = !Path::new(source_path).is_file();
    image.source_kind = Some(source_kind.to_owned());
    image.dataset_id = Some(format!("{source_kind}:{prefix}"));
    image
}

fn normalize_database_source_kind(value: Option<String>) -> AppResult<String> {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("asset") => Ok("asset".to_owned()),
        Some("database") | None => Ok("database".to_owned()),
        Some(other) => Err(AppError::InvalidInput(format!(
            "不支持的数据管理模式：{other}"
        ))),
    }
}

fn validate_child_target(root: &Path, folder_path: &str) -> AppResult<PathBuf> {
    let target = PathBuf::from(folder_path);
    if !target.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Target folder does not exist: {folder_path}"
        )));
    }

    let canonical_root = dunce::canonicalize(root).map_err(|_| {
        AppError::InvalidInput(format!("无法解析根路径：{}", root.to_string_lossy()))
    })?;
    let canonical_target = dunce::canonicalize(&target)
        .map_err(|_| AppError::InvalidInput(format!("无法解析目标路径：{folder_path}")))?;

    if canonical_target == canonical_root || !canonical_target.starts_with(&canonical_root) {
        return Err(AppError::InvalidInput(
            "Images can only be imported into a dataset subfolder".to_owned(),
        ));
    }

    Ok(target)
}

fn validate_image_import_target(
    dirs: &app_dirs::AppDirs,
    dataset_id: &str,
    folder_path: &str,
) -> AppResult<ImageImportTarget> {
    if let Some(root_path) = dataset_id
        .strip_prefix("folder:")
        .filter(|value| !value.is_empty())
    {
        return Ok(ImageImportTarget {
            target: Some(validate_child_target(
                &PathBuf::from(root_path),
                folder_path,
            )?),
            source_kind: "folder".to_owned(),
            database_prefix: None,
        });
    }

    let (dataset_kind, prefix_value) =
        if let Some(prefix_value) = dataset_id.strip_prefix("database:") {
            ("database", prefix_value)
        } else if let Some(prefix_value) = dataset_id.strip_prefix("asset:") {
            ("asset", prefix_value)
        } else {
            return Err(AppError::InvalidInput(format!(
                "Unsupported image import dataset id: {dataset_id}"
            )));
        };
    if prefix_value.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Invalid database dataset id: {dataset_id}"
        )));
    }
    let prefix = prefix_value.parse::<i64>().map_err(|_| {
        AppError::InvalidInput(format!("Invalid database dataset id: {dataset_id}"))
    })?;
    let (db, _) = open_database_by_prefix(dirs, prefix)?;
    let source_kind = db.dataset_source_kind()?;
    if source_kind != dataset_kind {
        return Err(AppError::InvalidInput(format!(
            "Dataset type mismatch: expected {dataset_kind}, got {source_kind}"
        )));
    }

    Ok(ImageImportTarget {
        target: None,
        source_kind,
        database_prefix: Some(prefix),
    })
}

fn source_annotation_path(image_path: &Path) -> PathBuf {
    image_path.with_extension("txt")
}

fn source_instruction_path(image_path: &Path) -> PathBuf {
    let stem = image_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    image_path.with_file_name(format!("{stem}.inst.txt"))
}

fn has_non_empty_text(path: &Path) -> bool {
    path.is_file()
        && fs::read_to_string(path)
            .map(|content| !content.trim().is_empty())
            .unwrap_or(false)
}

fn selected_image_import_preview(
    target_folder_path: String,
    paths: Vec<PathBuf>,
) -> FolderImageImportPreview {
    let mut image_paths = paths
        .into_iter()
        .filter(|path| path.is_file() && files::is_supported_image(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    image_paths.sort_by_key(|path| path.to_ascii_lowercase());
    image_paths.dedup_by(|left, right| left.eq_ignore_ascii_case(right));

    let annotation_count = image_paths
        .iter()
        .filter(|path| has_non_empty_text(&source_annotation_path(Path::new(path))))
        .count();
    let instruction_count = image_paths
        .iter()
        .filter(|path| has_non_empty_text(&source_instruction_path(Path::new(path))))
        .count();

    FolderImageImportPreview {
        target_folder_path,
        image_count: image_paths.len(),
        annotation_count,
        instruction_count,
        image_paths,
    }
}

fn sqlite_sidecar_paths(path: &Path) -> [PathBuf; 3] {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", path.to_string_lossy())),
    ]
}

fn remove_sqlite_files(path: &Path) -> AppResult<()> {
    for file in sqlite_sidecar_paths(path) {
        if file.exists() {
            fs::remove_file(file)?;
        }
    }
    Ok(())
}

/// Check whether any asset database still references the given `storage_path`.
/// `skip_db_path` is excluded from the scan (e.g. the database that was just deleted).
fn is_asset_path_still_referenced(
    dirs: &app_dirs::AppDirs,
    storage_path: &str,
    skip_db_path: Option<&Path>,
) -> AppResult<bool> {
    for db_ref in dataset_database_refs(dirs)? {
        if skip_db_path == Some(db_ref.path.as_path()) {
            continue;
        }
        let db = open_database(&db_ref.path)?;
        if db.dataset_source_kind()? != "asset" {
            continue;
        }
        if db.has_storage_path_reference(storage_path)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Delete asset library files that are no longer referenced by any asset database.
/// `skip_db_path` is excluded from the reference scan (for databases that have already
/// been deleted or will be deleted).
fn cleanup_unreferenced_asset_files(
    dirs: &app_dirs::AppDirs,
    storage_paths: &[String],
    skip_db_path: Option<&Path>,
) -> usize {
    let mut cleaned = 0;
    for storage_path in storage_paths {
        match is_asset_path_still_referenced(dirs, storage_path, skip_db_path) {
            Ok(true) => continue,
            Ok(false) => {}
            Err(err) => {
                tracing::warn!("检查资产引用失败：{err}");
                continue;
            }
        }
        let file_path = Path::new(storage_path);
        if file_path.is_file() {
            if let Err(err) = fs::remove_file(file_path) {
                tracing::warn!("删除资产文件失败：{storage_path} - {err}");
            } else {
                tracing::info!("已清理资产文件：{storage_path}");
                cleaned += 1;
            }
        }
    }
    cleaned
}

fn output_folder_name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_output_folder_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "dataset".to_owned())
}

fn sanitize_output_folder_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_owned()
}

fn export_relative_path(path: &Path, root_path: Option<&str>) -> PathBuf {
    let relative = root_path
        .map(Path::new)
        .and_then(|root| path.strip_prefix(root).ok())
        .filter(|relative| {
            !relative.as_os_str().is_empty()
                && relative
                    .components()
                    .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
        })
        .map(Path::to_path_buf);

    relative.unwrap_or_else(|| {
        path.file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("image"))
    })
}

fn deduplicate_relative_path(path: PathBuf, used_paths: &mut HashSet<String>) -> PathBuf {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if used_paths.insert(normalized) {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 2.. {
        let file_name = match extension {
            Some(extension) if !extension.is_empty() => {
                format!("{stem} ({index}).{extension}")
            }
            _ => format!("{stem} ({index})"),
        };
        let candidate = parent.join(file_name);
        let normalized = candidate
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if used_paths.insert(normalized) {
            return candidate;
        }
    }

    unreachable!("relative path de-duplication loop should always return")
}

fn source_size(path: &Path, fallback: Option<i64>) -> AppResult<u64> {
    if let Ok(metadata) = fs::metadata(path) {
        return Ok(metadata.len());
    }

    Ok(fallback
        .and_then(|value| u64::try_from(value).ok())
        .unwrap_or(0))
}

fn directory_size(path: &Path) -> AppResult<u64> {
    if !path.exists() {
        return Ok(0);
    }

    let mut size = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            size += directory_size(&entry.path())?;
        } else if metadata.is_file() {
            size += metadata.len();
        }
    }

    Ok(size)
}

fn training_cache_item_size(path: &Path) -> AppResult<u64> {
    if path.is_dir() {
        return directory_size(path);
    }

    Ok(fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0))
}

fn is_training_cache_file(path: &Path) -> bool {
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == ".aitk_size.json")
    {
        return true;
    }

    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("npz"))
}

fn remove_files_in_directory(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            remove_files_in_directory(&entry_path)?;
        } else if metadata.is_file() {
            if let Err(error) = fs::remove_file(&entry_path) {
                tracing::warn!("清理日志文件失败 {:?}: {}", entry_path, error);
            }
        }
    }

    Ok(())
}

fn renamed_folder_path(folder_path: &str, new_name: &str) -> AppResult<PathBuf> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err(AppError::InvalidInput(
            "Folder name cannot be empty or contain path separators".to_owned(),
        ));
    }

    let old_path = PathBuf::from(folder_path);
    let parent = old_path.parent().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Cannot rename folder without a parent: {folder_path}"
        ))
    })?;
    Ok(parent.join(new_name))
}

fn normalize_logical_dataset_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn join_logical_dataset_path(parent: &str, name: &str) -> PathBuf {
    let parent = normalize_logical_dataset_path(parent);
    if parent.is_empty() {
        PathBuf::from(name)
    } else {
        PathBuf::from(format!("{parent}/{name}"))
    }
}

fn import_relative_dataset_path(root: &Path, image_path: &Path) -> PathBuf {
    image_path
        .strip_prefix(root)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .or_else(|| image_path.file_name().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("image"))
}

fn repair_database_image_thumbnail(
    db: &mut Database,
    image: &mut DatasetImage,
    source_kind: &str,
    thumbnail_dir: &Path,
    thumbnail_size: u32,
    verify_source_hash: bool,
) -> AppResult<bool> {
    let source_path = if source_kind == "asset" {
        image.storage_path.as_deref().unwrap_or(&image.path)
    } else {
        &image.path
    };
    let source_path = PathBuf::from(source_path);
    if !source_path.is_file() {
        return Ok(false);
    }

    let has_cached_thumbnail = image
        .thumbnail_path
        .as_deref()
        .map(Path::new)
        .is_some_and(Path::is_file);
    let source_hash = if verify_source_hash || !has_cached_thumbnail {
        Some(files::hash_file(&source_path)?)
    } else {
        None
    };
    let source_changed = source_hash
        .as_deref()
        .is_some_and(|hash| image.file_hash.as_deref() != Some(hash));

    if has_cached_thumbnail && !source_changed {
        return Ok(false);
    }

    let hash = source_hash
        .or_else(|| image.file_hash.clone())
        .unwrap_or_else(String::new);
    let hash = if hash.is_empty() {
        files::hash_file(&source_path)?
    } else {
        hash
    };
    let metadata = fs::metadata(&source_path)?;
    let thumbnail =
        thumbnail::create_thumbnail(&source_path, thumbnail_dir, &hash, thumbnail_size)?;
    db.update_image_source_metadata(
        image.id,
        &ImageSourceMetadata {
            file_size: metadata.len() as i64,
            file_hash: hash.clone(),
            thumbnail_path: Some(thumbnail.path.clone()),
            width: Some(thumbnail.width),
            height: Some(thumbnail.height),
        },
    )?;

    image.file_size = Some(metadata.len() as i64);
    image.file_hash = Some(hash);
    image.thumbnail_path = Some(thumbnail.path.to_string_lossy().to_string());
    image.width = Some(thumbnail.width);
    image.height = Some(thumbnail.height);
    Ok(true)
}

fn list_images_for_dirs(dirs: &app_dirs::AppDirs) -> AppResult<Vec<DatasetImage>> {
    let mut images = Vec::new();
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root);
    let thumbnail_settings = thumbnail_settings::load_settings(dirs)?;
    for db_ref in dataset_database_refs(dirs)? {
        let mut db = open_database(&db_ref.path)?;
        let source_kind = db.dataset_source_kind()?;
        let mut database_images = db.list_images()?;
        if source_kind == "database" || source_kind == "asset" {
            for image in &mut database_images {
                if let Err(error) = repair_database_image_thumbnail(
                    &mut db,
                    image,
                    &source_kind,
                    &thumbnail_dir,
                    thumbnail_settings.thumbnail_size,
                    false,
                ) {
                    tracing::warn!(
                        "Failed to refresh thumbnail cache for {:?}: {}",
                        image.path,
                        error
                    );
                }
            }
        }
        for image in database_images {
            images.push(namespace_image(image, db_ref.prefix, &source_kind));
        }
    }
    images.extend(folders::list_folder_images(dirs)?);
    Ok(images)
}

fn list_annotation_profiles_for_dirs(
    dirs: &app_dirs::AppDirs,
) -> AppResult<Vec<AnnotationProfile>> {
    let mut profiles = Vec::new();
    for db_ref in dataset_database_refs(dirs)? {
        let db = open_database(&db_ref.path)?;
        let source_kind = db.dataset_source_kind()?;
        for profile in db.list_annotation_profiles()? {
            profiles.push(namespace_profile(profile, db_ref.prefix, &source_kind));
        }
    }
    profiles.extend(folders::list_folder_profiles(dirs)?);
    Ok(profiles)
}

fn check_database_problem_items(
    dirs: &app_dirs::AppDirs,
    prefix: i64,
    expected_source_kind: &str,
    local_image_ids: Option<HashSet<i64>>,
) -> AppResult<ProblemItemCheckSummary> {
    let (mut db, _) = open_database_by_prefix(dirs, prefix)?;
    let source_kind = db.dataset_source_kind()?;
    if source_kind != expected_source_kind {
        return Err(AppError::InvalidInput(format!(
            "数据集类型不匹配：期望 {expected_source_kind}，实际 {source_kind}"
        )));
    }

    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root);
    let thumbnail_settings = thumbnail_settings::load_settings(dirs)?;
    let mut summary = ProblemItemCheckSummary {
        checked: 0,
        updated: 0,
        missing: 0,
        failed: 0,
    };

    for mut image in db.list_images()? {
        if local_image_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(&image.id))
        {
            continue;
        }
        summary.checked += 1;
        let source_path = if source_kind == "asset" {
            image.storage_path.as_deref().unwrap_or(&image.path)
        } else {
            &image.path
        };
        let source_path = PathBuf::from(source_path);
        if !source_path.is_file() {
            summary.missing += 1;
            continue;
        }
        let result = (|| -> AppResult<bool> {
            repair_database_image_thumbnail(
                &mut db,
                &mut image,
                &source_kind,
                &thumbnail_dir,
                thumbnail_settings.thumbnail_size,
                true,
            )
        })();

        match result {
            Ok(true) => summary.updated += 1,
            Ok(false) => {}
            Err(error) => {
                summary.failed += 1;
                tracing::warn!("问题条目检查失败：{:?}：{}", source_path, error);
            }
        }
    }

    Ok(summary)
}

fn check_folder_problem_items(dataset_id: &str) -> AppResult<ProblemItemCheckSummary> {
    let folder_root = dataset_id
        .strip_prefix("folder:")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            AppError::InvalidInput(format!("Invalid folder dataset id: {dataset_id}"))
        })?;
    if !folder_root.is_dir() {
        return Ok(ProblemItemCheckSummary {
            checked: 0,
            updated: 0,
            missing: 1,
            failed: 0,
        });
    }

    let missing = folders::count_orphan_sidecar_items(&folder_root);
    Ok(ProblemItemCheckSummary {
        checked: missing,
        updated: 0,
        missing,
        failed: 0,
    })
}

#[tauri::command]
pub async fn list_images(state: State<'_, AppState>) -> AppResult<Vec<DatasetImage>> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || list_images_for_dirs(&dirs))
        .await
        .map_err(|error| AppError::InvalidInput(format!("Image listing task failed: {error}")))?
}

#[tauri::command]
pub async fn list_annotation_profiles(
    state: State<'_, AppState>,
) -> AppResult<Vec<AnnotationProfile>> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || list_annotation_profiles_for_dirs(&dirs))
        .await
        .map_err(|error| AppError::InvalidInput(format!("Profile listing task failed: {error}")))?
}

#[tauri::command]
pub async fn check_problem_items(
    state: State<'_, AppState>,
    dataset_id: String,
    image_ids: Option<Vec<i64>>,
) -> AppResult<ProblemItemCheckSummary> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(prefix_value) = dataset_id.strip_prefix("database:") {
            let prefix = prefix_value.parse::<i64>().map_err(|_| {
                AppError::InvalidInput(format!("Invalid database dataset id: {dataset_id}"))
            })?;
            let local_image_ids = image_ids
                .map(|ids| {
                    ids.into_iter()
                        .filter_map(|id| split_public_id(id).ok())
                        .filter_map(|(id_prefix, local_id)| {
                            (id_prefix == prefix).then_some(local_id)
                        })
                        .collect::<HashSet<_>>()
                })
                .filter(|ids| !ids.is_empty());
            return check_database_problem_items(&dirs, prefix, "database", local_image_ids);
        }
        if let Some(prefix_value) = dataset_id.strip_prefix("asset:") {
            let prefix = prefix_value.parse::<i64>().map_err(|_| {
                AppError::InvalidInput(format!("Invalid asset dataset id: {dataset_id}"))
            })?;
            let local_image_ids = image_ids
                .map(|ids| {
                    ids.into_iter()
                        .filter_map(|id| split_public_id(id).ok())
                        .filter_map(|(id_prefix, local_id)| {
                            (id_prefix == prefix).then_some(local_id)
                        })
                        .collect::<HashSet<_>>()
                })
                .filter(|ids| !ids.is_empty());
            return check_database_problem_items(&dirs, prefix, "asset", local_image_ids);
        }
        if dataset_id.starts_with("folder:") {
            return check_folder_problem_items(&dataset_id);
        }
        Err(AppError::InvalidInput(format!(
            "Unsupported dataset id: {dataset_id}"
        )))
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("问题条目检查任务失败：{error}")))?
}

#[tauri::command]
pub fn get_gemini_settings(state: State<'_, AppState>) -> AppResult<GeminiSettings> {
    gemini::load_settings(&state.dirs)
}

#[tauri::command]
pub fn save_gemini_settings(
    state: State<'_, AppState>,
    settings: GeminiSettings,
) -> AppResult<GeminiSettings> {
    gemini::save_settings(&state.dirs, settings)
}

#[tauri::command]
pub async fn fetch_gemini_models(
    state: State<'_, AppState>,
    settings: Option<GeminiSettings>,
) -> AppResult<Vec<String>> {
    let settings = match settings {
        Some(settings) => settings,
        None => gemini::load_settings(&state.dirs)?,
    };
    gemini::fetch_models(&settings).await
}

#[tauri::command]
pub async fn test_gemini_connection(
    state: State<'_, AppState>,
    settings: Option<GeminiSettings>,
) -> AppResult<usize> {
    let settings = match settings {
        Some(settings) => settings,
        None => gemini::load_settings(&state.dirs)?,
    };
    gemini::fetch_models(&settings)
        .await
        .map(|models| models.len())
}

#[tauri::command]
pub async fn generate_gemini_annotation(
    state: State<'_, AppState>,
    image_path: String,
    prompt: String,
) -> AppResult<String> {
    let settings = gemini::load_settings(&state.dirs)?;
    gemini::generate_annotation(&settings, &PathBuf::from(image_path), &prompt).await
}

#[tauri::command]
pub async fn generate_wd14_annotation(
    state: State<'_, AppState>,
    image_path: String,
) -> AppResult<String> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        wd14_tagger::generate_annotation(&dirs, &PathBuf::from(image_path))
            .map(|result| result.positive_prompt)
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("WD14 标注任务失败：{error}")))?
}

#[tauri::command]
pub async fn generate_wd14_annotations(
    app: AppHandle,
    state: State<'_, AppState>,
    image_paths: Vec<String>,
) -> AppResult<Vec<String>> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = image_paths
            .into_iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        wd14_tagger::generate_annotations_streaming(&dirs, &paths, |start, results| {
            let contents = results
                .iter()
                .map(|result| result.positive_prompt.clone())
                .collect::<Vec<_>>();
            let execution_provider = results
                .first()
                .map(|result| result.execution_provider.clone())
                .unwrap_or_default();
            app.emit(
                "wd14-annotation-progress",
                Wd14AnnotationProgress {
                    start,
                    contents,
                    execution_provider,
                },
            )
            .map_err(|error| AppError::InvalidInput(format!("WD14 progress event failed: {error}")))
        })
        .map(|results| {
            results
                .into_iter()
                .map(|result| result.positive_prompt)
                .collect()
        })
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("WD14 annotation task failed: {error}")))?
}

#[tauri::command]
pub fn get_python_env_settings(state: State<'_, AppState>) -> AppResult<PythonEnvSettings> {
    python_env::load_settings(&state.dirs)
}

#[tauri::command]
pub fn save_python_env_settings(
    state: State<'_, AppState>,
    settings: PythonEnvSettings,
) -> AppResult<PythonEnvSettings> {
    python_env::save_settings(&state.dirs, settings)
}

#[tauri::command]
pub fn get_model_settings(state: State<'_, AppState>) -> AppResult<ModelSettings> {
    model_settings::load_settings(&state.dirs)
}

#[tauri::command]
pub fn save_model_settings(
    state: State<'_, AppState>,
    settings: ModelSettings,
) -> AppResult<ModelSettings> {
    model_settings::save_settings(&state.dirs, settings)
}

#[tauri::command]
pub fn get_thumbnail_settings(state: State<'_, AppState>) -> AppResult<ThumbnailSettings> {
    thumbnail_settings::load_settings(&state.dirs)
}

#[tauri::command]
pub fn save_thumbnail_settings(
    state: State<'_, AppState>,
    settings: ThumbnailSettings,
) -> AppResult<ThumbnailSettings> {
    thumbnail_settings::save_settings(&state.dirs, settings)
}

#[tauri::command]
pub fn get_window_rendering_settings(
    state: State<'_, AppState>,
) -> AppResult<WindowRenderingSettings> {
    Ok(window_rendering::load_settings(&state.dirs))
}

#[tauri::command]
pub fn save_window_rendering_settings(
    state: State<'_, AppState>,
    settings: WindowRenderingSettings,
) -> AppResult<WindowRenderingSettings> {
    window_rendering::save_settings(&state.dirs, settings)
}

#[tauri::command]
pub async fn pick_wd14_model_path(app: AppHandle) -> AppResult<ModelPathSelection> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path);
    });

    let Some(path) = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| AppError::InvalidInput(format!("模型路径选择任务失败：{error}")))?
        .map_err(|error| AppError::InvalidInput(format!("模型路径选择失败：{error}")))?
    else {
        return Err(AppError::DialogCancelled);
    };
    let path = path
        .into_path()
        .map_err(|_| AppError::InvalidInput("选择的模型路径不是本地路径".to_owned()))?;
    let path = path.to_string_lossy().to_string();
    Ok(ModelPathSelection {
        model_type: model_settings::infer_model_type_for_path(&path),
        path,
    })
}

#[tauri::command]
pub async fn pick_python_env_path(app: AppHandle) -> AppResult<String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path);
    });

    let Some(path) = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| AppError::InvalidInput(format!("环境路径选择任务失败：{error}")))?
        .map_err(|error| AppError::InvalidInput(format!("环境路径选择失败：{error}")))?
    else {
        return Err(AppError::DialogCancelled);
    };
    let path = path
        .into_path()
        .map_err(|_| AppError::InvalidInput("选择的路径不是本地路径".to_owned()))?;
    Ok(python_env::resolve_external_environment_path(&path)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn probe_python_env(
    state: State<'_, AppState>,
    settings: Option<PythonEnvSettings>,
) -> AppResult<PythonEnvProbeReport> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || python_env::probe_environment(&dirs, settings))
        .await
        .map_err(|error| AppError::InvalidInput(format!("运行时检测任务失败：{error}")))?
}

#[tauri::command]
pub async fn install_managed_python_deps(
    state: State<'_, AppState>,
    install_profile: Option<String>,
) -> AppResult<PythonEnvInstallResult> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        python_env::install_managed_dependencies(&dirs, install_profile)
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("PyTorch 依赖安装任务失败：{error}")))?
}

#[tauri::command]
pub async fn install_managed_onnx_deps(
    state: State<'_, AppState>,
    install_profile: Option<String>,
) -> AppResult<PythonEnvInstallResult> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        python_env::install_managed_onnx_dependencies(&dirs, install_profile)
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("ONNX Runtime 依赖安装任务失败：{error}")))?
}

#[tauri::command]
pub async fn prepare_import_folder(app: AppHandle) -> AppResult<ImportPreview> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = sender.send(folder);
    });

    let Some(folder) = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| AppError::InvalidInput(format!("Folder picker task failed: {error}")))?
        .map_err(|error| AppError::InvalidInput(format!("Folder picker failed: {error}")))?
    else {
        return Err(AppError::DialogCancelled);
    };
    let folder = folder
        .into_path()
        .map_err(|_| AppError::InvalidInput("Selected folder is not a local path".to_owned()))?;

    tauri::async_runtime::spawn_blocking(move || files::scan_import_preview(&folder))
        .await
        .map_err(|error| AppError::InvalidInput(format!("Import preview task failed: {error}")))
}

#[tauri::command]
pub async fn mount_folder_dataset(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dirs = state.dirs.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = sender.send(folder);
    });

    let Some(folder) = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| AppError::InvalidInput(format!("Folder picker task failed: {error}")))?
        .map_err(|error| AppError::InvalidInput(format!("Folder picker failed: {error}")))?
    else {
        return Err(AppError::DialogCancelled);
    };
    let folder = folder
        .into_path()
        .map_err(|_| AppError::InvalidInput("Selected folder is not a local path".to_owned()))?;

    folders::add_folder_dataset(&dirs, &folder)
}

#[tauri::command]
pub async fn prepare_folder_image_import(
    state: State<'_, AppState>,
    app: AppHandle,
    dataset_id: String,
    target_folder_path: String,
) -> AppResult<FolderImageImportPreview> {
    let import_target =
        validate_image_import_target(&state.dirs, &dataset_id, &target_folder_path)?;
    let target_folder_path = import_target
        .target
        .as_ref()
        .map(|target| target.to_string_lossy().to_string())
        .unwrap_or(target_folder_path);
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["jpg", "jpeg", "png", "webp", "bmp", "gif"])
        .pick_files(move |files| {
            let _ = sender.send(files);
        });

    let Some(files) = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| AppError::InvalidInput(format!("File picker task failed: {error}")))?
        .map_err(|error| AppError::InvalidInput(format!("File picker failed: {error}")))?
    else {
        return Err(AppError::DialogCancelled);
    };

    let paths = files
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect::<Vec<_>>();

    tauri::async_runtime::spawn_blocking(move || {
        selected_image_import_preview(target_folder_path, paths)
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("Image import preview task failed: {error}")))
}

#[tauri::command]
pub async fn import_images_to_folder(
    state: State<'_, AppState>,
    dataset_id: String,
    target_folder_path: String,
    image_paths: Vec<String>,
    profile_id: Option<i64>,
) -> AppResult<FolderImageImportSummary> {
    let import_target =
        validate_image_import_target(&state.dirs, &dataset_id, &target_folder_path)?;
    let has_sidecars = image_paths.iter().any(|path| {
        let path = Path::new(path);
        has_non_empty_text(&source_annotation_path(path))
            || has_non_empty_text(&source_instruction_path(path))
    });
    if has_sidecars && profile_id.is_none() {
        return Err(AppError::InvalidInput(
            "Annotation type is required for importing sidecar text".to_owned(),
        ));
    }

    let dirs = state.dirs.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut summary = FolderImageImportSummary {
            imported: 0,
            skipped: 0,
            failed: 0,
            annotation_count: 0,
            instruction_count: 0,
        };
        let mut database = match import_target.database_prefix {
            Some(prefix) => Some(open_database_by_prefix(&dirs, prefix)?.0),
            None => None,
        };
        let local_profile_id = match profile_id {
            Some(public_profile_id) => match import_target.database_prefix {
                Some(prefix) => {
                    let (profile_prefix, local_profile_id) = split_public_id(public_profile_id)?;
                    if profile_prefix != prefix {
                        return Err(AppError::InvalidInput(
                            "Annotation type does not belong to the selected dataset".to_owned(),
                        ));
                    }
                    Some(local_profile_id)
                }
                None => Some(public_profile_id),
            },
            None => None,
        };

        if let Some(target) = import_target.target.as_ref() {
            fs::create_dir_all(target)?;
        }
        let thumbnail_dir = files::default_thumbnail_dir(&dirs.root);
        let thumbnail_size = thumbnail_settings::load_settings(&dirs)?.thumbnail_size;
        let asset_dir = dirs.datasets.join("assets");
        for source in image_paths {
            let source_path = PathBuf::from(&source);
            if !source_path.is_file() || !files::is_supported_image(&source_path) {
                summary.failed += 1;
                continue;
            }

            let source_annotation = source_annotation_path(&source_path);
            let source_instruction = source_instruction_path(&source_path);
            if let Some(db) = database.as_mut() {
                let import_asset_dir =
                    (import_target.source_kind == "asset").then_some(asset_dir.as_path());
                let dataset_path = source_path
                    .file_name()
                    .map(|name| {
                        join_logical_dataset_path(&target_folder_path, &name.to_string_lossy())
                    })
                    .unwrap_or_else(|| join_logical_dataset_path(&target_folder_path, "image"));
                match files::import_image(
                    db,
                    &source_path,
                    &dataset_path,
                    &thumbnail_dir,
                    import_asset_dir,
                    None,
                    thumbnail_size,
                ) {
                    Ok(result) => {
                        if let (Some(profile_id), true) =
                            (local_profile_id, has_non_empty_text(&source_annotation))
                        {
                            if let Ok(content) = fs::read_to_string(&source_annotation) {
                                if db
                                    .save_imported_annotation_if_empty(
                                        result.image_id,
                                        profile_id,
                                        &content,
                                    )
                                    .unwrap_or(false)
                                {
                                    summary.annotation_count += 1;
                                }
                            }
                        }
                        if let (Some(profile_id), true) =
                            (local_profile_id, has_non_empty_text(&source_instruction))
                        {
                            if let Ok(instruction) = fs::read_to_string(&source_instruction) {
                                if db
                                    .upsert_instruction(result.image_id, profile_id, instruction)
                                    .is_ok()
                                {
                                    summary.instruction_count += 1;
                                }
                            }
                        }
                        summary.imported += 1;
                    }
                    Err(_) => {
                        summary.failed += 1;
                    }
                }
            } else {
                let Some(target) = import_target.target.as_ref() else {
                    summary.failed += 1;
                    continue;
                };
                let Some(file_name) = source_path.file_name() else {
                    summary.failed += 1;
                    continue;
                };
                let target_image_path = target.join(file_name);
                if target_image_path.exists() {
                    summary.skipped += 1;
                    continue;
                }

                if fs::copy(&source_path, &target_image_path).is_err() {
                    summary.failed += 1;
                    continue;
                }

                if has_non_empty_text(&source_annotation)
                    && fs::copy(
                        &source_annotation,
                        source_annotation_path(&target_image_path),
                    )
                    .is_ok()
                {
                    summary.annotation_count += 1;
                }

                if has_non_empty_text(&source_instruction)
                    && fs::copy(
                        &source_instruction,
                        source_instruction_path(&target_image_path),
                    )
                    .is_ok()
                {
                    summary.instruction_count += 1;
                }

                summary.imported += 1;
            }
        }

        Ok(summary)
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("Folder image import task failed: {error}")))?
}

#[tauri::command]
pub fn get_thumbnail_cache_info(state: State<'_, AppState>) -> AppResult<ThumbnailCacheInfo> {
    let thumbnail_dir = files::default_thumbnail_dir(&state.dirs.root);
    Ok(ThumbnailCacheInfo {
        size_bytes: directory_size(&thumbnail_dir)?,
    })
}

#[tauri::command]
pub fn clear_thumbnail_cache(state: State<'_, AppState>) -> AppResult<ThumbnailCacheInfo> {
    let thumbnail_dir = files::default_thumbnail_dir(&state.dirs.root);
    if thumbnail_dir.exists() {
        fs::remove_dir_all(&thumbnail_dir)?;
    }
    fs::create_dir_all(&thumbnail_dir)?;

    let mut cleared_paths = 0;
    for db_ref in dataset_database_refs(&state.dirs)? {
        let db = open_database(&db_ref.path)?;
        cleared_paths += db.clear_thumbnail_paths()?;
    }

    tracing::info!(
        "已清空缩略图缓存，清理数据库缩略图路径 {} 条",
        cleared_paths
    );

    Ok(ThumbnailCacheInfo { size_bytes: 0 })
}

#[tauri::command]
pub fn get_log_files_info(state: State<'_, AppState>) -> AppResult<LogFilesInfo> {
    Ok(LogFilesInfo {
        size_bytes: directory_size(&state.dirs.log)?,
    })
}

#[tauri::command]
pub fn clear_log_files(state: State<'_, AppState>) -> AppResult<LogFilesInfo> {
    remove_files_in_directory(&state.dirs.log)?;
    Ok(LogFilesInfo {
        size_bytes: directory_size(&state.dirs.log)?,
    })
}

#[tauri::command]
pub fn start_import_folder(
    app: AppHandle,
    folder_path: String,
    annotation_type: Option<String>,
    import_mode: Option<String>,
) -> AppResult<()> {
    let folder = std::path::PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Import folder does not exist: {folder_path}"
        )));
    }

    let dirs = app_dirs::ensure_release_dirs(&app)?;
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root);
    let thumbnail_size = thumbnail_settings::load_settings(&dirs)?.thumbnail_size;
    let source_kind = normalize_database_source_kind(import_mode)?;
    let asset_dir = dirs.datasets.join("assets");
    let database_path = app_dirs::dataset_database_path_for_kind(&dirs, &folder, &source_kind);
    let app_for_thread = app.clone();
    let root_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Dataset")
        .to_owned();
    let root_path = folder.to_string_lossy().to_string();

    tracing::info!(
        "开始后台导入数据集：{:?}，标注类型={:?}，数据模式={}",
        folder,
        annotation_type,
        source_kind
    );
    std::thread::spawn(move || {
        let emit_progress = |progress: ImportProgress| {
            let _ = app_for_thread.emit("import-progress", progress);
        };

        emit_progress(ImportProgress {
            phase: "scanning".to_owned(),
            processed: 0,
            total: 0,
            imported: 0,
            skipped: 0,
            failed: 0,
            current_path: None,
            root_name: Some(root_name.clone()),
            root_path: Some(root_path.clone()),
            done: false,
            report: None,
        });

        let mut db = match open_database(&database_path).and_then(|mut db| {
            db.set_dataset_metadata(&root_name, &root_path, &source_kind)?;
            Ok(db)
        }) {
            Ok(db) => db,
            Err(error) => {
                tracing::error!("后台导入打开数据库失败：{}", error);
                emit_progress(ImportProgress {
                    phase: "failed".to_owned(),
                    processed: 0,
                    total: 0,
                    imported: 0,
                    skipped: 0,
                    failed: 1,
                    current_path: Some(error.to_string()),
                    root_name: Some(root_name.clone()),
                    root_path: Some(root_path.clone()),
                    done: true,
                    report: Some(ImportReport {
                        root_name: Some(root_name.clone()),
                        root_path: Some(root_path.clone()),
                        success_without_annotations: 0,
                        success_with_annotations: 0,
                        failed: 1,
                        failures: vec![ImportFailure {
                            file_path: database_path.to_string_lossy().to_string(),
                            reason: error.to_string(),
                        }],
                        warnings: Vec::new(),
                    }),
                });
                return;
            }
        };
        let annotation_type = annotation_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let import_profile_id = match annotation_type.as_deref() {
            Some(import_profile_name) => match db.ensure_import_profile(import_profile_name) {
                Ok(profile_id) => Some(profile_id),
                Err(error) => {
                    tracing::warn!("创建导入标注类型失败：{:?}：{}", import_profile_name, error);
                    None
                }
            },
            None => None,
        };

        let paths = files::collect_image_paths(&folder);
        let total = paths.len();
        let mut summary = ImportSummary {
            imported: 0,
            skipped: 0,
            failed: 0,
        };
        let mut success_without_annotations = 0;
        let mut success_with_annotations = 0;
        let mut failures = Vec::new();
        let mut warnings = Vec::new();

        emit_progress(ImportProgress {
            phase: "importing".to_owned(),
            processed: 0,
            total,
            imported: 0,
            skipped: 0,
            failed: 0,
            current_path: None,
            root_name: Some(root_name.clone()),
            root_path: Some(root_path.clone()),
            done: false,
            report: None,
        });

        for (index, path) in paths.iter().enumerate() {
            let import_asset_dir = (source_kind == "asset").then_some(asset_dir.as_path());
            let dataset_path = import_relative_dataset_path(&folder, path);
            match files::import_image(
                &mut db,
                path,
                &dataset_path,
                &thumbnail_dir,
                import_asset_dir,
                import_profile_id,
                thumbnail_size,
            ) {
                Ok(result) => {
                    if let Some(warning_message) = result.format_warning {
                        warnings.push(ImportWarning {
                            file_path: path.to_string_lossy().to_string(),
                            message: warning_message,
                        });
                    }

                    summary.imported += 1;

                    if result.has_annotation {
                        success_with_annotations += 1;
                    } else {
                        success_without_annotations += 1;
                    }
                }
                Err(error) => {
                    summary.failed += 1;
                    tracing::warn!("图片导入失败：{:?}：{}", path, error);
                    failures.push(ImportFailure {
                        file_path: path.to_string_lossy().to_string(),
                        reason: error.to_string(),
                    });
                }
            }

            emit_progress(ImportProgress {
                phase: "importing".to_owned(),
                processed: index + 1,
                total,
                imported: summary.imported,
                skipped: summary.skipped,
                failed: summary.failed,
                current_path: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_owned),
                root_name: Some(root_name.clone()),
                root_path: Some(root_path.clone()),
                done: false,
                report: None,
            });
        }

        tracing::info!(
            "后台数据集导入完成：imported={}, skipped={}, failed={}",
            summary.imported,
            summary.skipped,
            summary.failed
        );

        emit_progress(ImportProgress {
            phase: "done".to_owned(),
            processed: total,
            total,
            imported: summary.imported,
            skipped: summary.skipped,
            failed: summary.failed,
            current_path: None,
            root_name: Some(root_name.clone()),
            root_path: Some(root_path.clone()),
            done: true,
            report: Some(ImportReport {
                root_name: Some(root_name),
                root_path: Some(root_path),
                success_without_annotations,
                success_with_annotations,
                failed: summary.failed,
                failures,
                warnings,
            }),
        });
    });

    Ok(())
}

#[tauri::command]
pub fn save_folder_annotation(
    state: State<'_, AppState>,
    image_path: String,
    content: String,
) -> AppResult<()> {
    folders::save_folder_annotation(&state.dirs, &image_path, &content)
}

#[tauri::command]
pub fn save_folder_instruction(
    state: State<'_, AppState>,
    image_path: String,
    instruction: String,
) -> AppResult<()> {
    folders::save_folder_instruction(&state.dirs, &image_path, &instruction)
}

#[tauri::command]
pub fn rename_dataset_image(
    state: State<'_, AppState>,
    image_id: i64,
    image_path: String,
    source_kind: Option<String>,
    new_name: String,
) -> AppResult<String> {
    if source_kind.as_deref() == Some("folder") || image_id < 0 {
        return folders::rename_folder_image(&image_path, &new_name);
    }

    let (prefix, local_image_id) = split_public_id(image_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    db.rename_image(local_image_id, &new_name)
}

#[tauri::command]
pub fn delete_dataset_image(
    state: State<'_, AppState>,
    image_id: i64,
    image_path: String,
    source_kind: Option<String>,
) -> AppResult<usize> {
    if source_kind.as_deref() == Some("folder") || image_id < 0 {
        return folders::delete_folder_image(&image_path);
    }

    let (prefix, local_image_id) = split_public_id(image_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;

    let asset_storage_path = if db.dataset_source_kind()? == "asset" {
        db.get_image_storage_path(local_image_id)?
    } else {
        None
    };

    let deleted = db.delete_image(local_image_id)?;
    drop(db);

    if let Some(storage_path) = asset_storage_path {
        cleanup_unreferenced_asset_files(&state.dirs, &[storage_path], None);
    }

    Ok(deleted)
}

#[tauri::command]
pub fn save_annotation(
    state: State<'_, AppState>,
    image_id: i64,
    profile_id: i64,
    content: String,
) -> AppResult<()> {
    let (image_prefix, local_image_id) = split_public_id(image_id)?;
    let (profile_prefix, local_profile_id) = split_public_id(profile_id)?;
    if image_prefix != profile_prefix {
        return Err(AppError::InvalidInput(
            "Image and annotation profile belong to different dataset databases".to_owned(),
        ));
    }
    let (mut db, _) = open_database_by_prefix(&state.dirs, image_prefix)?;

    tracing::info!(
        "Saving annotation for image_id={}, profile_id={}",
        image_id,
        profile_id
    );
    db.upsert_annotation(local_image_id, local_profile_id, content)
}

#[tauri::command]
pub fn save_instruction(
    state: State<'_, AppState>,
    image_id: i64,
    profile_id: i64,
    instruction: String,
) -> AppResult<()> {
    let (image_prefix, local_image_id) = split_public_id(image_id)?;
    let (profile_prefix, local_profile_id) = split_public_id(profile_id)?;
    if image_prefix != profile_prefix {
        return Err(AppError::InvalidInput(
            "Image and annotation profile belong to different dataset databases".to_owned(),
        ));
    }
    let (mut db, _) = open_database_by_prefix(&state.dirs, image_prefix)?;

    tracing::info!(
        "Saving instruction for image_id={}, profile_id={}",
        image_id,
        profile_id
    );
    db.upsert_instruction(local_image_id, local_profile_id, instruction)
}

#[tauri::command]
pub fn save_annotation_changes(
    state: State<'_, AppState>,
    changes: Vec<SaveAnnotationChange>,
) -> AppResult<()> {
    let mut changes_by_prefix = std::collections::BTreeMap::<i64, Vec<AnnotationChange>>::new();

    for change in changes {
        if change.content.is_none() && change.instruction.is_none() {
            continue;
        }

        let (image_prefix, local_image_id) = split_public_id(change.image_id)?;
        let (profile_prefix, local_profile_id) = split_public_id(change.profile_id)?;
        if image_prefix != profile_prefix {
            return Err(AppError::InvalidInput(
                "Image and annotation profile belong to different dataset databases".to_owned(),
            ));
        }

        changes_by_prefix
            .entry(image_prefix)
            .or_default()
            .push(AnnotationChange {
                image_id: local_image_id,
                profile_id: local_profile_id,
                content: change.content,
                instruction: change.instruction,
            });
    }

    for (prefix, local_changes) in changes_by_prefix {
        let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
        tracing::info!(
            "批量保存标注改动：dataset_prefix={}, changes={}",
            prefix,
            local_changes.len()
        );
        db.upsert_annotation_changes(local_changes)?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_annotation_profile(
    state: State<'_, AppState>,
    name: String,
    image_ids: Vec<i64>,
) -> AppResult<i64> {
    let Some(first_image_id) = image_ids.first().copied() else {
        return Err(AppError::InvalidInput(
            "Cannot create an annotation type without dataset images".to_owned(),
        ));
    };
    let (prefix, _) = split_public_id(first_image_id)?;
    let mut local_image_ids = Vec::with_capacity(image_ids.len());
    for image_id in image_ids {
        let (image_prefix, local_image_id) = split_public_id(image_id)?;
        if image_prefix != prefix {
            return Err(AppError::InvalidInput(
                "Annotation type creation cannot span multiple dataset databases".to_owned(),
            ));
        }
        local_image_ids.push(local_image_id);
    }
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;

    tracing::info!(
        "Creating annotation profile {:?} for {} images",
        name,
        local_image_ids.len()
    );
    db.create_dataset_annotation_profile(name, local_image_ids)
        .map(|profile_id| to_public_id(prefix, profile_id))
}

#[tauri::command]
pub fn rename_annotation_profile(
    state: State<'_, AppState>,
    profile_id: i64,
    new_name: String,
) -> AppResult<()> {
    let (prefix, local_profile_id) = split_public_id(profile_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    tracing::info!("重命名标注类型 profile_id={} 为 {:?}", profile_id, new_name);
    db.rename_annotation_profile(local_profile_id, new_name)
}

#[tauri::command]
pub fn duplicate_annotation_profile(
    state: State<'_, AppState>,
    profile_id: i64,
    new_name: String,
) -> AppResult<i64> {
    let (prefix, local_profile_id) = split_public_id(profile_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    tracing::info!("复制标注类型 profile_id={} 为 {:?}", profile_id, new_name);
    db.duplicate_annotation_profile(local_profile_id, new_name)
        .map(|new_id| to_public_id(prefix, new_id))
}

#[tauri::command]
pub fn delete_annotation_profile(state: State<'_, AppState>, profile_id: i64) -> AppResult<()> {
    let (prefix, local_profile_id) = split_public_id(profile_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    tracing::info!("删除标注类型 profile_id={}", profile_id);
    db.delete_annotation_profile(local_profile_id)
}

#[tauri::command]
pub fn clear_annotation(state: State<'_, AppState>, annotation_id: i64) -> AppResult<()> {
    let (prefix, local_annotation_id) = split_public_id(annotation_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;

    tracing::info!("Clearing annotation_id={}", annotation_id);
    db.clear_annotation(local_annotation_id)
}

#[tauri::command]
pub fn remove_training_set(state: State<'_, AppState>, dataset_id: String) -> AppResult<usize> {
    tracing::info!("移除训练集：dataset_id={}", dataset_id);
    let (source_kind, prefix_value) = if let Some(value) = dataset_id.strip_prefix("database:") {
        ("database", value)
    } else if let Some(value) = dataset_id.strip_prefix("asset:") {
        ("asset", value)
    } else {
        return Err(AppError::InvalidInput(format!(
            "不支持的训练集 ID：{dataset_id}"
        )));
    };
    let prefix = prefix_value
        .parse::<i64>()
        .map_err(|_| AppError::InvalidInput(format!("无效的训练集 ID：{dataset_id}")))?;

    let db_ref = dataset_database_refs(&state.dirs)?
        .into_iter()
        .find(|db_ref| db_ref.prefix == prefix)
        .ok_or_else(|| AppError::InvalidInput(format!("未找到训练集数据库：{dataset_id}")))?;

    let db = open_database(&db_ref.path)?;
    if db.dataset_source_kind()? != source_kind {
        return Err(AppError::InvalidInput(format!(
            "训练集类型不匹配：{dataset_id}"
        )));
    }
    let image_count = db.list_images()?.len();
    let asset_storage_paths = if source_kind == "asset" {
        db.get_all_storage_paths()?
    } else {
        Vec::new()
    };
    drop(db);

    let db_path = db_ref.path.clone();
    remove_sqlite_files(&db_ref.path)?;

    if !asset_storage_paths.is_empty() {
        let cleaned =
            cleanup_unreferenced_asset_files(&state.dirs, &asset_storage_paths, Some(&db_path));
        tracing::info!("移除训练集：清理了 {cleaned} 个资产文件");
    }

    Ok(image_count)
}

#[tauri::command]
pub fn remove_dataset_folder(
    state: State<'_, AppState>,
    folder_path: String,
    source_kind: Option<String>,
    dataset_id: Option<String>,
) -> AppResult<usize> {
    tracing::info!("移除数据库子文件夹记录：path={}", folder_path);
    let source_kind = normalize_database_source_kind(source_kind)?;
    let is_asset = source_kind == "asset";
    let mut removed = 0;
    let mut asset_storage_paths = Vec::new();

    let target_prefix = dataset_id
        .as_deref()
        .and_then(|id| id.split_once(':').map(|(_, value)| value))
        .and_then(|value| value.parse::<i64>().ok());

    for db_ref in dataset_database_refs(&state.dirs)? {
        if target_prefix.is_some_and(|prefix| prefix != db_ref.prefix) {
            continue;
        }
        let mut db = open_database(&db_ref.path)?;
        if db.dataset_source_kind()? != source_kind {
            continue;
        }

        if is_asset {
            asset_storage_paths.extend(db.get_storage_paths_under_path(&folder_path)?);
        }

        let deleted = db.delete_images_under_path(&folder_path)?;
        removed += deleted;
        if deleted > 0 && db.list_images()?.is_empty() {
            drop(db);
            remove_sqlite_files(&db_ref.path)?;
        }
    }

    if !asset_storage_paths.is_empty() {
        let cleaned = cleanup_unreferenced_asset_files(&state.dirs, &asset_storage_paths, None);
        tracing::info!("移除子文件夹：清理了 {cleaned} 个资产文件");
    }

    Ok(removed)
}

#[tauri::command]
pub fn remove_folder_dataset(state: State<'_, AppState>, folder_path: String) -> AppResult<usize> {
    tracing::info!("Unmounting folder dataset path={}", folder_path);
    folders::remove_folder_dataset(&state.dirs, &folder_path)
}

#[tauri::command]
pub fn rename_dataset_folder(
    state: State<'_, AppState>,
    folder_path: String,
    new_name: String,
    source_kind: Option<String>,
    dataset_id: Option<String>,
) -> AppResult<String> {
    let source_kind = source_kind.as_deref().unwrap_or("folder");
    if source_kind == "database" || source_kind == "asset" {
        let dataset_id = dataset_id.ok_or_else(|| {
            AppError::InvalidInput("Database folder rename requires a dataset id".to_owned())
        })?;
        let prefix = dataset_id
            .split_once(':')
            .and_then(|(_, value)| value.parse::<i64>().ok())
            .ok_or_else(|| AppError::InvalidInput(format!("Invalid dataset id: {dataset_id}")))?;
        let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
        if db.dataset_source_kind()? != source_kind {
            return Err(AppError::InvalidInput(format!(
                "Dataset type mismatch: expected {source_kind}"
            )));
        }
        let new_path = renamed_folder_path(&folder_path, &new_name)?
            .to_string_lossy()
            .to_string();
        db.rename_folder_paths(&folder_path, &new_path)?;
        return Ok(normalize_logical_dataset_path(&new_path));
    }

    let new_path = renamed_folder_path(&folder_path, &new_name)?;
    let old_path = PathBuf::from(&folder_path);
    if !old_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Folder does not exist: {folder_path}"
        )));
    }
    if new_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Target folder already exists: {}",
            new_path.to_string_lossy()
        )));
    }

    tracing::info!(
        "Renaming dataset folder from {:?} to {:?}",
        old_path,
        new_path
    );
    fs::rename(&old_path, &new_path)?;

    let new_path_string = new_path.to_string_lossy().to_string();
    for db_ref in dataset_database_refs(&state.dirs)? {
        let mut db = open_database(&db_ref.path)?;
        db.rename_source_folder_paths(&folder_path, &new_path_string)?;
    }

    Ok(new_path_string)
}

#[tauri::command]
pub fn create_dataset_subfolder(
    state: State<'_, AppState>,
    folder_path: String,
    name: String,
    source_kind: Option<String>,
    dataset_id: Option<String>,
) -> AppResult<String> {
    let source_kind = source_kind.as_deref().unwrap_or("folder");
    if source_kind == "database" || source_kind == "asset" {
        let dataset_id = dataset_id.ok_or_else(|| {
            AppError::InvalidInput("Database folder creation requires a dataset id".to_owned())
        })?;
        let prefix = dataset_id
            .split_once(':')
            .and_then(|(_, value)| value.parse::<i64>().ok())
            .ok_or_else(|| AppError::InvalidInput(format!("Invalid dataset id: {dataset_id}")))?;
        let (db, _) = open_database_by_prefix(&state.dirs, prefix)?;
        if db.dataset_source_kind()? != source_kind {
            return Err(AppError::InvalidInput(format!(
                "Dataset type mismatch: expected {source_kind}"
            )));
        }
        drop(db);
        let name = name.trim();
        if name.is_empty() || name.contains('/') || name.contains('\\') {
            return Err(AppError::InvalidInput(
                "Folder name cannot be empty or contain path separators".to_owned(),
            ));
        }
        return Ok(normalize_logical_dataset_path(
            &join_logical_dataset_path(&folder_path, name).to_string_lossy(),
        ));
    }

    let new_path = renamed_folder_path(&format!("{folder_path}/placeholder"), &name)?;
    let parent = PathBuf::from(&folder_path);
    if !parent.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "父文件夹不存在：{folder_path}"
        )));
    }
    if new_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "目标文件夹已存在：{}",
            new_path.to_string_lossy()
        )));
    }

    fs::create_dir_all(&new_path)?;
    tracing::info!("已创建数据集子文件夹：{:?}", new_path);
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn consolidate_loose_files(
    state: State<'_, AppState>,
    folder_path: String,
    folder_name: String,
    image_ids: Vec<i64>,
    image_paths: Vec<String>,
    source_kind: Option<String>,
    dataset_id: Option<String>,
) -> AppResult<usize> {
    if source_kind.as_deref() == Some("folder")
        || dataset_id
            .as_deref()
            .is_some_and(|id| id.starts_with("folder:"))
    {
        return folders::consolidate_folder_loose_files(
            &state.dirs,
            &folder_path,
            &folder_name,
            &image_paths,
        );
    }

    let source_kind = normalize_database_source_kind(source_kind)?;
    let dataset_id = dataset_id.ok_or_else(|| {
        AppError::InvalidInput("Loose file consolidation requires a dataset id".to_owned())
    })?;
    let prefix = dataset_id
        .split_once(':')
        .and_then(|(_, value)| value.parse::<i64>().ok())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid dataset id: {dataset_id}")))?;
    let local_ids = image_ids
        .into_iter()
        .map(|id| {
            let (image_prefix, local_id) = split_public_id(id)?;
            if image_prefix != prefix {
                return Err(AppError::InvalidInput(format!(
                    "Image id does not belong to dataset {dataset_id}: {id}"
                )));
            }
            Ok(local_id)
        })
        .collect::<AppResult<Vec<_>>>()?;

    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    if db.dataset_source_kind()? != source_kind {
        return Err(AppError::InvalidInput(format!(
            "Dataset type mismatch: expected {source_kind}"
        )));
    }

    db.move_images_to_child_folder(&local_ids, &folder_path, &folder_name)
}

#[tauri::command]
pub fn delete_loose_files(
    state: State<'_, AppState>,
    image_ids: Vec<i64>,
    image_paths: Vec<String>,
    source_kind: Option<String>,
    dataset_id: Option<String>,
) -> AppResult<usize> {
    if source_kind.as_deref() == Some("folder")
        || dataset_id
            .as_deref()
            .is_some_and(|id| id.starts_with("folder:"))
    {
        return folders::delete_folder_images(&image_paths);
    }

    let source_kind = normalize_database_source_kind(source_kind)?;
    let dataset_id = dataset_id.ok_or_else(|| {
        AppError::InvalidInput("Loose file deletion requires a dataset id".to_owned())
    })?;
    let prefix = dataset_id
        .split_once(':')
        .and_then(|(_, value)| value.parse::<i64>().ok())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid dataset id: {dataset_id}")))?;
    let local_ids = image_ids
        .into_iter()
        .map(|id| {
            let (image_prefix, local_id) = split_public_id(id)?;
            if image_prefix != prefix {
                return Err(AppError::InvalidInput(format!(
                    "Image id does not belong to dataset {dataset_id}: {id}"
                )));
            }
            Ok(local_id)
        })
        .collect::<AppResult<Vec<_>>>()?;

    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;
    if db.dataset_source_kind()? != source_kind {
        return Err(AppError::InvalidInput(format!(
            "Dataset type mismatch: expected {source_kind}"
        )));
    }

    let mut asset_storage_paths = Vec::new();
    if source_kind == "asset" {
        for local_id in &local_ids {
            if let Some(storage_path) = db.get_image_storage_path(*local_id)? {
                asset_storage_paths.push(storage_path);
            }
        }
    }
    let mut deleted = 0;
    for local_id in local_ids {
        deleted += db.delete_image(local_id)?;
    }
    drop(db);

    if !asset_storage_paths.is_empty() {
        cleanup_unreferenced_asset_files(&state.dirs, &asset_storage_paths, None);
    }

    Ok(deleted)
}

#[tauri::command]
pub fn delete_workspace_subfolder(
    state: State<'_, AppState>,
    folder_path: String,
) -> AppResult<()> {
    let path = PathBuf::from(&folder_path);
    if !path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "工作文件夹子目录不存在：{folder_path}"
        )));
    }

    folders::require_subfolder_of_registered(&state.dirs, &path)?;

    tracing::info!("正在删除工作文件夹子目录及其全部内容：{:?}", path);
    fs::remove_dir_all(path)?;
    Ok(())
}

#[tauri::command]
pub async fn prepare_export_dataset(
    state: State<'_, AppState>,
    request: ExportDatasetRequest,
) -> AppResult<ExportPreview> {
    let dirs = state.dirs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_export(&dirs, &request)?;
        Ok(export::estimate_export(
            &prepared.items,
            &prepared.output_dir,
        ))
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("Export preview task failed: {error}")))?
}

#[tauri::command]
pub fn start_export_dataset(app: AppHandle, request: ExportDatasetRequest) -> AppResult<()> {
    let dirs = app_dirs::ensure_release_dirs(&app)?;
    let app_for_thread = app.clone();

    std::thread::spawn(move || {
        let emit_progress = |progress: export::ExportProgress| {
            let _ = app_for_thread.emit("export-progress", progress);
        };

        let prepared = match prepare_export(&dirs, &request) {
            Ok(prepared) => prepared,
            Err(error) => {
                emit_progress(export::ExportProgress {
                    phase: "failed".to_owned(),
                    processed: 0,
                    total: 0,
                    exported: 0,
                    failed: 1,
                    current_path: None,
                    output_dir: None,
                    estimated_size_bytes: 0,
                    written_size_bytes: 0,
                    done: true,
                    error: Some(error.to_string()),
                });
                return;
            }
        };

        if let Err(error) = export::export_dataset(prepared, emit_progress) {
            emit_progress(export::ExportProgress {
                phase: "failed".to_owned(),
                processed: 0,
                total: 0,
                exported: 0,
                failed: 1,
                current_path: None,
                output_dir: None,
                estimated_size_bytes: 0,
                written_size_bytes: 0,
                done: true,
                error: Some(error.to_string()),
            });
        }
    });

    Ok(())
}

fn prepare_export(
    dirs: &app_dirs::AppDirs,
    request: &ExportDatasetRequest,
) -> AppResult<PreparedExport> {
    let image_ids = request.image_ids.iter().copied().collect::<HashSet<_>>();

    let database_source_kind = if request.dataset_id.starts_with("asset:") {
        Some("asset")
    } else if request.dataset_id.starts_with("database:") {
        Some("database")
    } else {
        None
    };

    if let Some(source_kind) = database_source_kind {
        let dataset_prefix = format!("{source_kind}:");
        let prefix_value = request
            .dataset_id
            .strip_prefix(dataset_prefix.as_str())
            .unwrap_or_default();
        let prefix = prefix_value.parse::<i64>().map_err(|_| {
            AppError::InvalidInput(format!("Invalid dataset id: {}", request.dataset_id))
        })?;
        let db_ref = dataset_database_refs(dirs)?
            .into_iter()
            .find(|db_ref| db_ref.prefix == prefix)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("Dataset database not found: {prefix}"))
            })?;
        let db = open_database(&db_ref.path)?;
        let profile_id = request.profile_id.ok_or_else(|| {
            AppError::InvalidInput("Database export requires an annotation type".to_owned())
        })?;
        let (profile_prefix, local_profile_id) = split_public_id(profile_id)?;
        if profile_prefix != prefix {
            return Err(AppError::InvalidInput(
                "Annotation type does not belong to the selected dataset".to_owned(),
            ));
        }

        let output_dir = request
            .output_dir
            .join(output_folder_name_from_path(&db_ref.path));
        let selected_images = db
            .list_images()?
            .into_iter()
            .filter(|image| {
                let public_id = to_public_id(prefix, image.id);
                image_ids.is_empty() || image_ids.contains(&public_id)
            })
            .collect::<Vec<_>>();
        let mut used_relative_paths = HashSet::new();
        let items = selected_images
            .into_iter()
            .map(|image| {
                let source_path = image
                    .storage_path
                    .as_deref()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from(&image.path));
                let annotation_content = image
                    .annotations
                    .iter()
                    .find(|annotation| annotation.profile_id == local_profile_id)
                    .map(|annotation| annotation.content.clone())
                    .unwrap_or_default();
                let relative_path = deduplicate_relative_path(
                    PathBuf::from(
                        image
                            .dataset_path
                            .as_deref()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or(&image.file_name),
                    ),
                    &mut used_relative_paths,
                );
                source_size(&source_path, image.file_size).map(|source_size_bytes| ExportItem {
                    source_path,
                    relative_path,
                    annotation_content,
                    source_size_bytes,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let estimated_size_bytes = items
            .iter()
            .map(|item| item.source_size_bytes + item.annotation_content.len() as u64)
            .sum();

        return Ok(PreparedExport {
            output_dir,
            items,
            estimated_size_bytes,
        });
    }

    if request.dataset_id.starts_with("folder:") {
        let folder_root = request
            .dataset_id
            .strip_prefix("folder:")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("Invalid folder dataset id: {}", request.dataset_id))
            })?;
        let output_dir = request
            .output_dir
            .join(output_folder_name_from_path(&folder_root));
        let items = folders::list_folder_images(dirs)?
            .into_iter()
            .filter(|image| image.dataset_id.as_deref() == Some(request.dataset_id.as_str()))
            .filter(|image| image_ids.is_empty() || image_ids.contains(&image.id))
            .map(|image| {
                let source_path = PathBuf::from(&image.path);
                let annotation_content = image
                    .annotations
                    .first()
                    .map(|annotation| annotation.content.clone())
                    .unwrap_or_default();
                let relative_path = export_relative_path(&source_path, image.root_path.as_deref());
                source_size(&source_path, image.file_size).map(|source_size_bytes| ExportItem {
                    source_path,
                    relative_path,
                    annotation_content,
                    source_size_bytes,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let estimated_size_bytes = items
            .iter()
            .map(|item| item.source_size_bytes + item.annotation_content.len() as u64)
            .sum();

        return Ok(PreparedExport {
            output_dir,
            items,
            estimated_size_bytes,
        });
    }

    Err(AppError::InvalidInput(format!(
        "Unsupported dataset id: {}",
        request.dataset_id
    )))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingCacheItem {
    pub path: String,
    pub item_type: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingCacheScanResult {
    pub folder_path: String,
    pub scanned_entries: usize,
    pub items: Vec<TrainingCacheItem>,
    pub total_size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingCacheRemoveResult {
    pub deleted: usize,
    pub failed: usize,
    pub released_size_bytes: u64,
}

fn collect_training_cache_items(
    folder: &Path,
    items: &mut Vec<TrainingCacheItem>,
    scanned_entries: &mut usize,
) -> AppResult<()> {
    let mut entries = fs::read_dir(folder)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path().to_string_lossy().to_ascii_lowercase());

    for entry in entries {
        *scanned_entries += 1;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if file_type.is_dir() {
            if file_name == "_latent_cache" {
                items.push(TrainingCacheItem {
                    path: path.to_string_lossy().to_string(),
                    item_type: "directory".to_owned(),
                    size_bytes: directory_size(&path)?,
                });
                continue;
            }

            collect_training_cache_items(&path, items, scanned_entries)?;
            continue;
        }

        if file_type.is_file() && is_training_cache_file(&path) {
            items.push(TrainingCacheItem {
                path: path.to_string_lossy().to_string(),
                item_type: "file".to_owned(),
                size_bytes: training_cache_item_size(&path)?,
            });
        }
    }

    Ok(())
}

fn is_valid_training_cache_item(path: &Path) -> bool {
    if path.is_dir() {
        return path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == "_latent_cache");
    }

    path.is_file() && is_training_cache_file(path)
}

#[tauri::command]
pub async fn scan_training_cache(folder: String) -> AppResult<TrainingCacheScanResult> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Path is not a valid folder: {folder}"
        )));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::new();
        let mut scanned_entries = 0;
        collect_training_cache_items(&folder_path, &mut items, &mut scanned_entries)?;
        let total_size_bytes = items.iter().map(|item| item.size_bytes).sum();

        Ok(TrainingCacheScanResult {
            folder_path: folder_path.to_string_lossy().to_string(),
            scanned_entries,
            items,
            total_size_bytes,
        })
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("Training cache scan task failed: {error}")))?
}

#[tauri::command]
pub async fn remove_training_cache(
    folder: String,
    items: Vec<TrainingCacheItem>,
) -> AppResult<TrainingCacheRemoveResult> {
    let folder_path = PathBuf::from(&folder);
    let canonical_folder = dunce::canonicalize(&folder_path)
        .map_err(|_| AppError::InvalidInput(format!("Could not resolve folder path: {folder}")))?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut deleted = 0;
        let mut failed = 0;
        let mut released_size_bytes = 0;

        for item in items {
            let path = PathBuf::from(&item.path);
            if !path.exists() {
                continue;
            }

            let canonical_path = match dunce::canonicalize(&path) {
                Ok(path) => path,
                Err(error) => {
                    tracing::warn!(
                        "Training cache removal skipped unresolved path {:?}: {}",
                        path,
                        error
                    );
                    failed += 1;
                    continue;
                }
            };

            if !canonical_path.starts_with(&canonical_folder)
                || !is_valid_training_cache_item(&canonical_path)
            {
                tracing::warn!(
                    "Training cache removal skipped invalid path {:?}",
                    canonical_path
                );
                failed += 1;
                continue;
            }

            let size_bytes = training_cache_item_size(&canonical_path)?;
            let remove_result = if canonical_path.is_dir() {
                fs::remove_dir_all(&canonical_path)
            } else {
                fs::remove_file(&canonical_path)
            };

            match remove_result {
                Ok(()) => {
                    deleted += 1;
                    released_size_bytes += size_bytes;
                }
                Err(error) => {
                    tracing::warn!(
                        "Training cache removal failed for {:?}: {}",
                        canonical_path,
                        error
                    );
                    failed += 1;
                }
            }
        }

        Ok(TrainingCacheRemoveResult {
            deleted,
            failed,
            released_size_bytes,
        })
    })
    .await
    .map_err(|error| {
        AppError::InvalidInput(format!("Training cache removal task failed: {error}"))
    })?
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatMismatch {
    pub file_path: String,
    pub current_extension: String,
    pub actual_format: String,
    pub correct_extension: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatMismatchScanProgress {
    pub scan_id: String,
    pub scanned: usize,
    pub total: usize,
    pub done: bool,
    pub mismatch: Option<FormatMismatch>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn start_format_mismatch_scan(
    app: AppHandle,
    scan_id: String,
    folder: String,
) -> AppResult<()> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "路径不是有效的文件夹：{folder}"
        )));
    }

    std::thread::spawn(move || {
        use image::{ImageFormat, ImageReader};

        let image_paths = files::collect_image_paths(&folder_path);
        let total = image_paths.len();
        let mut mismatch_count = 0;

        let emit_progress = |payload: FormatMismatchScanProgress| {
            if let Err(error) = app.emit("format-mismatch-scan-progress", payload) {
                tracing::warn!("格式校验进度发送失败：{}", error);
            }
        };

        emit_progress(FormatMismatchScanProgress {
            scan_id: scan_id.clone(),
            scanned: 0,
            total,
            done: false,
            mismatch: None,
            error: None,
        });

        for (index, path) in image_paths.iter().enumerate() {
            let ext_format = path
                .extension()
                .and_then(|e| e.to_str())
                .and_then(ImageFormat::from_extension);

            let detected_format =
                match ImageReader::open(path).and_then(|r| r.with_guessed_format()) {
                    Ok(reader) => reader.format(),
                    Err(error) => {
                        tracing::warn!("格式校验读取失败：{}：{}", path.display(), error);
                        continue;
                    }
                };

            if let (Some(ext_fmt), Some(det_fmt)) = (ext_format, detected_format) {
                if ext_fmt != det_fmt {
                    let correct_ext = format_to_extension(det_fmt);
                    mismatch_count += 1;
                    emit_progress(FormatMismatchScanProgress {
                        scan_id: scan_id.clone(),
                        scanned: index + 1,
                        total,
                        done: false,
                        mismatch: Some(FormatMismatch {
                            file_path: path.to_string_lossy().to_string(),
                            current_extension: path
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_owned(),
                            actual_format: format_to_display_name(det_fmt).to_owned(),
                            correct_extension: correct_ext.to_owned(),
                        }),
                        error: None,
                    });
                }
            }

            if (index + 1) % 50 == 0 {
                emit_progress(FormatMismatchScanProgress {
                    scan_id: scan_id.clone(),
                    scanned: index + 1,
                    total,
                    done: false,
                    mismatch: None,
                    error: None,
                });
            }
        }

        tracing::info!(
            "格式校验完成：扫描 {} 个文件，发现 {} 个格式不匹配",
            total,
            mismatch_count
        );

        emit_progress(FormatMismatchScanProgress {
            scan_id,
            scanned: total,
            total,
            done: true,
            mismatch: None,
            error: None,
        });
    });

    Ok(())
}

#[tauri::command]
pub fn fix_format_mismatches(folder: String, items: Vec<FormatMismatch>) -> AppResult<usize> {
    let folder_path = PathBuf::from(&folder);
    let canonical_folder = dunce::canonicalize(&folder_path)
        .map_err(|_| AppError::InvalidInput(format!("无法解析扫描文件夹路径：{folder}")))?;

    let mut fixed = 0;

    for item in &items {
        let source = PathBuf::from(&item.file_path);
        if !source.is_file() {
            tracing::warn!("格式修复跳过（文件不存在）：{}", item.file_path);
            continue;
        }

        let canonical_source = dunce::canonicalize(&source)
            .map_err(|_| AppError::InvalidInput(format!("无法解析文件路径：{}", item.file_path)))?;
        if !canonical_source.starts_with(&canonical_folder) {
            tracing::warn!("格式修复跳过（文件不在扫描文件夹内）：{}", item.file_path);
            continue;
        }

        if item.correct_extension.contains('/')
            || item.correct_extension.contains('\\')
            || item.correct_extension.contains("..")
        {
            tracing::warn!(
                "格式修复跳过（扩展名包含非法字符）：{}",
                item.correct_extension
            );
            continue;
        }

        let target = source.with_extension(&item.correct_extension);
        if target.exists() {
            tracing::warn!(
                "格式修复跳过（目标已存在）：{} → {}",
                item.file_path,
                target.display()
            );
            continue;
        }

        if let Some(annotation_path) = find_sidecar_txt(&source) {
            let new_annotation_path = target.with_extension("txt");
            if !new_annotation_path.exists() {
                if let Err(e) = fs::rename(&annotation_path, &new_annotation_path) {
                    tracing::warn!(
                        "标注文件重命名失败：{} → {}：{}",
                        annotation_path.display(),
                        new_annotation_path.display(),
                        e
                    );
                }
            }
        }

        match fs::rename(&source, &target) {
            Ok(()) => {
                fixed += 1;
                tracing::info!("格式修复：{} → {}", item.file_path, target.display());
            }
            Err(e) => {
                tracing::warn!(
                    "格式修复失败：{} → {}：{}",
                    item.file_path,
                    target.display(),
                    e
                );
            }
        }
    }

    tracing::info!("格式修复完成：成功修复 {}/{} 个文件", fixed, items.len());
    Ok(fixed)
}

fn find_sidecar_txt(image_path: &Path) -> Option<PathBuf> {
    let txt_path = image_path.with_extension("txt");
    txt_path.is_file().then_some(txt_path)
}

fn format_to_extension(fmt: image::ImageFormat) -> &'static str {
    match fmt {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::Bmp => "bmp",
        image::ImageFormat::Tiff => "tiff",
        _ => "bin",
    }
}

fn format_to_display_name(fmt: image::ImageFormat) -> &'static str {
    match fmt {
        image::ImageFormat::Png => "PNG",
        image::ImageFormat::Jpeg => "JPEG",
        image::ImageFormat::WebP => "WebP",
        image::ImageFormat::Gif => "GIF",
        image::ImageFormat::Bmp => "BMP",
        image::ImageFormat::Tiff => "TIFF",
        _ => "Unknown",
    }
}
