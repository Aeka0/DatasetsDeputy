mod app_dirs;
mod commands;
mod db;
mod errors;
mod export;
mod files;
mod folders;
mod gemini;
mod python_env;
mod thumbnail;
#[cfg(target_os = "windows")]
mod window_region;

use tauri::Manager;

pub struct AppState {
    pub dirs: app_dirs::AppDirs,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dirs = app_dirs::ensure_release_dirs(app.handle())?;
            app_dirs::init_logging(&dirs)?;
            tracing::info!("Application directories initialized");

            app.manage(AppState { dirs });

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
            commands::get_gemini_settings,
            commands::save_gemini_settings,
            commands::fetch_gemini_models,
            commands::test_gemini_connection,
            commands::generate_gemini_annotation,
            commands::get_python_env_settings,
            commands::save_python_env_settings,
            commands::pick_python_env_path,
            commands::probe_python_env,
            commands::create_managed_python_env,
            commands::install_managed_python_deps,
            commands::prepare_import_folder,
            commands::start_import_folder,
            commands::mount_folder_dataset,
            commands::get_thumbnail_cache_info,
            commands::clear_thumbnail_cache,
            commands::save_annotation,
            commands::save_instruction,
            commands::save_folder_annotation,
            commands::save_folder_instruction,
            commands::create_annotation_profile,
            commands::clear_annotation,
            commands::remove_dataset_folder,
            commands::remove_folder_dataset,
            commands::rename_dataset_folder,
            commands::export_dataset
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Datasets Deputy");
}
