use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_dirs,
    db::{AnnotationProfile, Database, DatasetImage},
    errors::{AppError, AppResult},
    export::{self, ExportRequest},
    files::{self, ImportPreview, ImportSummary},
    folders,
    gemini::{self, GeminiSettings},
    AppState,
};

const ID_NAMESPACE_SIZE: i64 = 1_000_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub file_path: String,
    pub reason: String,
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

struct DatasetDatabaseRef {
    prefix: i64,
    path: PathBuf,
}

fn dataset_database_refs(dirs: &app_dirs::AppDirs) -> AppResult<Vec<DatasetDatabaseRef>> {
    let mut paths = fs::read_dir(&dirs.dataset_databases)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sqlite"))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    Ok(paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| DatasetDatabaseRef {
            prefix: index as i64 + 1,
            path,
        })
        .collect())
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

fn namespace_profile(mut profile: AnnotationProfile, prefix: i64) -> AnnotationProfile {
    profile.id = to_public_id(prefix, profile.id);
    profile.source_kind = Some("database".to_owned());
    profile.dataset_id = Some(format!("database:{prefix}"));
    profile
}

fn namespace_image(mut image: DatasetImage, prefix: i64, root_path: Option<String>) -> DatasetImage {
    image.id = to_public_id(prefix, image.id);
    for annotation in &mut image.annotations {
        annotation.id = to_public_id(prefix, annotation.id);
        annotation.image_id = to_public_id(prefix, annotation.image_id);
        annotation.profile_id = to_public_id(prefix, annotation.profile_id);
    }
    image.source_kind = Some("database".to_owned());
    image.dataset_id = Some(format!("database:{prefix}"));
    image.root_path = root_path;
    image
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/").trim_end_matches('/').to_owned()
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

fn list_images_for_dirs(dirs: &app_dirs::AppDirs) -> AppResult<Vec<DatasetImage>> {
    let mut images = Vec::new();
    for db_ref in dataset_database_refs(dirs)? {
        let db = open_database(&db_ref.path)?;
        let root_path = db.dataset_root_path()?;
        for image in db.list_images()? {
            images.push(namespace_image(image, db_ref.prefix, root_path.clone()));
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
        for profile in db.list_annotation_profiles()? {
            profiles.push(namespace_profile(profile, db_ref.prefix));
        }
    }
    profiles.extend(folders::list_folder_profiles(dirs)?);
    Ok(profiles)
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
        .map_err(|error| {
            AppError::InvalidInput(format!("Profile listing task failed: {error}"))
        })?
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
    gemini::fetch_models(&settings).await.map(|models| models.len())
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
pub fn start_import_folder(
    app: AppHandle,
    folder_path: String,
    annotation_type: Option<String>,
) -> AppResult<()> {
    let folder = std::path::PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Import folder does not exist: {folder_path}"
        )));
    }

    let dirs = app_dirs::ensure_release_dirs(&app)?;
    let thumbnail_dir = files::default_thumbnail_dir(&dirs.root);
    let database_path = app_dirs::dataset_database_path(&dirs, &folder);
    let app_for_thread = app.clone();
    let root_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Dataset")
        .to_owned();
    let root_path = folder.to_string_lossy().to_string();

    tracing::info!(
        "Starting background folder import: {:?}, annotation_type={:?}",
        folder,
        annotation_type
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
            db.set_dataset_metadata(&root_name, &root_path)?;
            Ok(db)
        }) {
            Ok(db) => db,
            Err(error) => {
                tracing::error!("Background import failed to open database: {}", error);
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
                    tracing::warn!(
                        "Failed to create import annotation profile {:?}: {}",
                        import_profile_name,
                        error
                    );
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
            match files::import_image(&mut db, path, &thumbnail_dir, import_profile_id) {
                Ok(result) => {
                    if result.inserted {
                        summary.imported += 1;
                    } else {
                        summary.skipped += 1;
                    }

                    if result.has_annotation {
                        success_with_annotations += 1;
                    } else {
                        success_without_annotations += 1;
                    }
                }
                Err(error) => {
                    summary.failed += 1;
                    tracing::warn!("Image import failed for {:?}: {}", path, error);
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
            "Background folder import finished: imported={}, skipped={}, failed={}",
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
            }),
        });
    });

    Ok(())
}

#[tauri::command]
pub fn save_folder_annotation(image_path: String, content: String) -> AppResult<()> {
    folders::save_folder_annotation(&image_path, &content)
}

#[tauri::command]
pub fn save_folder_instruction(image_path: String, instruction: String) -> AppResult<()> {
    folders::save_folder_instruction(&image_path, &instruction)
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
pub fn clear_annotation(state: State<'_, AppState>, annotation_id: i64) -> AppResult<()> {
    let (prefix, local_annotation_id) = split_public_id(annotation_id)?;
    let (mut db, _) = open_database_by_prefix(&state.dirs, prefix)?;

    tracing::info!("Clearing annotation_id={}", annotation_id);
    db.clear_annotation(local_annotation_id)
}

#[tauri::command]
pub fn remove_dataset_folder(state: State<'_, AppState>, folder_path: String) -> AppResult<usize> {
    tracing::info!("Removing dataset folder records for path={}", folder_path);
    let normalized_folder = normalize_path(&folder_path);
    let mut removed = 0;

    for db_ref in dataset_database_refs(&state.dirs)? {
        let mut db = open_database(&db_ref.path)?;
        let root_path = db.dataset_root_path()?.map(|value| normalize_path(&value));
        let image_count = db.list_images()?.len();

        if root_path.as_deref() == Some(normalized_folder.as_str()) {
            drop(db);
            remove_sqlite_files(&db_ref.path)?;
            removed += image_count;
            continue;
        }

        let deleted = db.delete_images_under_path(&folder_path)?;
        removed += deleted;
        if deleted > 0 && db.list_images()?.is_empty() {
            drop(db);
            remove_sqlite_files(&db_ref.path)?;
        }
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
) -> AppResult<String> {
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
        db.rename_folder_paths(&folder_path, &new_path_string)?;
    }

    Ok(new_path_string)
}

#[tauri::command]
pub fn export_dataset(state: State<'_, AppState>, request: ExportRequest) -> AppResult<usize> {
    let mut images = Vec::new();
    for db_ref in dataset_database_refs(&state.dirs)? {
        let db = open_database(&db_ref.path)?;
        let root_path = db.dataset_root_path()?;
        for image in db.list_images()? {
            images.push(namespace_image(image, db_ref.prefix, root_path.clone()));
        }
    }
    images.extend(folders::list_folder_images(&state.dirs)?);
    export::export_dataset(&images, request)
}
