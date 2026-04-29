use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_dirs,
    db::{AnnotationProfile, DatasetImage},
    errors::{AppError, AppResult},
    export::{self, ExportRequest},
    files::{self, ImportPreview, ImportSummary},
    AppState,
};

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

#[tauri::command]
pub fn list_images(state: State<'_, AppState>) -> AppResult<Vec<DatasetImage>> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;
    db.list_images()
}

#[tauri::command]
pub fn list_annotation_profiles(state: State<'_, AppState>) -> AppResult<Vec<AnnotationProfile>> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;
    db.list_annotation_profiles()
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
    let database_path = dirs.database_path.clone();
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

        let mut db = match crate::db::Database::open(&database_path).and_then(|db| {
            db.migrate()?;
            db.ensure_default_profiles()?;
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
        let import_profile_name = annotation_type.as_deref().unwrap_or("Imported tags");
        let import_profile_id = match db.ensure_import_profile(import_profile_name) {
            Ok(profile_id) => Some(profile_id),
            Err(error) => {
                tracing::warn!(
                    "Failed to create import annotation profile {:?}: {}",
                    import_profile_name,
                    error
                );
                None
            }
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
pub fn save_manual_annotations(
    state: State<'_, AppState>,
    image_id: i64,
    tags: Vec<String>,
    caption: String,
) -> AppResult<()> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;

    tracing::info!("Saving manual annotations for image_id={}", image_id);
    db.save_manual_annotations(image_id, tags, caption)
}

#[tauri::command]
pub fn save_annotation(
    state: State<'_, AppState>,
    image_id: i64,
    profile_id: i64,
    content: String,
) -> AppResult<()> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;

    tracing::info!(
        "Saving annotation for image_id={}, profile_id={}",
        image_id,
        profile_id
    );
    db.upsert_annotation(image_id, profile_id, content)
}

#[tauri::command]
pub fn create_annotation_profile(
    state: State<'_, AppState>,
    name: String,
    image_ids: Vec<i64>,
) -> AppResult<i64> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;

    tracing::info!(
        "Creating annotation profile {:?} for {} images",
        name,
        image_ids.len()
    );
    db.create_dataset_annotation_profile(name, image_ids)
}

#[tauri::command]
pub fn clear_annotation(state: State<'_, AppState>, annotation_id: i64) -> AppResult<()> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;

    tracing::info!("Clearing annotation_id={}", annotation_id);
    db.clear_annotation(annotation_id)
}

#[tauri::command]
pub fn remove_dataset_folder(state: State<'_, AppState>, folder_path: String) -> AppResult<usize> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;

    tracing::info!("Removing dataset folder records for path={}", folder_path);
    db.delete_images_under_path(&folder_path)
}

#[tauri::command]
pub fn export_dataset(state: State<'_, AppState>, request: ExportRequest) -> AppResult<usize> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::InvalidInput("Database lock is poisoned".to_owned()))?;
    let images = db.list_images()?;
    export::export_dataset(&images, request)
}
