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
pub fn prepare_import_folder(app: AppHandle) -> AppResult<ImportPreview> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Err(AppError::DialogCancelled);
    };
    let folder = folder
        .into_path()
        .map_err(|_| AppError::InvalidInput("Selected folder is not a local path".to_owned()))?;

    Ok(files::scan_import_preview(&folder))
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
        });

        let db = match crate::db::Database::open(&database_path).and_then(|db| {
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
                });
                return;
            }
        };

        let paths = files::collect_image_paths(&folder);
        let total = paths.len();
        let mut summary = ImportSummary {
            imported: 0,
            skipped: 0,
            failed: 0,
        };

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
        });

        for (index, path) in paths.iter().enumerate() {
            match files::import_image(&db, path, &thumbnail_dir) {
                Ok(true) => summary.imported += 1,
                Ok(false) => summary.skipped += 1,
                Err(error) => {
                    summary.failed += 1;
                    tracing::warn!("Image import failed for {:?}: {}", path, error);
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
            root_name: Some(root_name),
            root_path: Some(root_path),
            done: true,
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
