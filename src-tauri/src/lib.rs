mod app_dirs;
mod commands;
mod db;
mod errors;
mod export;
mod files;
mod thumbnail;
#[cfg(target_os = "windows")]
mod window_region;

use std::sync::Mutex;

use db::Database;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Database>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dirs = app_dirs::ensure_release_dirs(app.handle())?;
            app_dirs::init_logging(&dirs)?;
            tracing::info!("Application directories initialized");

            let database = Database::open(&dirs.database_path)?;
            database.migrate()?;
            database.ensure_default_profiles()?;

            app.manage(AppState {
                db: Mutex::new(database),
            });

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                window_region::sync_rounded_region(&window, 8);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_images,
            commands::list_annotation_profiles,
            commands::prepare_import_folder,
            commands::start_import_folder,
            commands::save_manual_annotations,
            commands::save_annotation,
            commands::create_annotation_profile,
            commands::clear_annotation,
            commands::remove_dataset_folder,
            commands::export_dataset
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Datasets Deputy");
}
