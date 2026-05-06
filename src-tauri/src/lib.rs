mod app_dirs;
mod commands;
mod db;
mod errors;
mod export;
mod files;
mod folders;
mod gemini;
mod model_settings;
mod python_env;
mod thumbnail;
mod wd14_tagger;
#[cfg(target_os = "windows")]
mod window_region;
mod window_rendering;

use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "windows")]
use tauri::{PhysicalSize, Size};

const STARTUP_FALLBACK_SECONDS: u64 = 10;
const MIN_SPLASH_MILLISECONDS: u64 = 1800;
const MAIN_PAGE_READY_DELAY_MILLISECONDS: u64 = 250;

pub struct AppState {
    pub dirs: app_dirs::AppDirs,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if window.label() == "main" {
                match event {
                    WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                        window_region::sync_maximized_region(window);
                    }
                    _ => {}
                }
            }
        })
        .on_page_load(|webview, _payload| {
            if webview.label() != "main" {
                return;
            }

            let app_handle = webview.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(
                    MAIN_PAGE_READY_DELAY_MILLISECONDS,
                ));
                tracing::info!("主窗口页面已加载，执行启动窗口切换。");
                if let Err(error) = commands::finish_startup_windows(app_handle) {
                    tracing::error!("主窗口页面加载后的启动切换失败：{error}");
                }
            });
        })
        .setup(|app| {
            let dirs = app_dirs::ensure_release_dirs(app.handle())?;
            app_dirs::init_logging(&dirs)?;
            tracing::info!("应用目录初始化完成。");

            app.manage(AppState { dirs: dirs.clone() });

            #[cfg(target_os = "windows")]
            {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.set_size(Size::Physical(PhysicalSize::new(1344, 768)));
                    let _ = splash.center();
                    let _ = splash.set_shadow(false);
                    window_region::sync_rounded_region(&splash, 14);
                    let _ = splash.show();
                }
            }

            let app_handle = app.handle().clone();
            let window_rendering_settings = window_rendering::load_settings(&dirs);
            tracing::info!(
                "启动窗口渲染模式：{}",
                window_rendering_settings.mode.as_str()
            );
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(MIN_SPLASH_MILLISECONDS));

                if app_handle.get_webview_window("main").is_some() {
                    return;
                }

                let Some(main_window_config) = main_window_config else {
                    tracing::error!("启动失败：未找到主窗口配置。");
                    return;
                };

                let main_window_config = window_rendering::apply_to_main_window_config(
                    main_window_config,
                    &window_rendering_settings,
                );

                tracing::info!("创建主窗口。");
                match WebviewWindowBuilder::from_config(&app_handle, &main_window_config)
                    .and_then(|builder| builder.build())
                {
                    Ok(main_window) => {
                        #[cfg(target_os = "windows")]
                        {
                            let _ = main_window.set_shadow(false);
                            window_region::sync_rounded_region(&main_window, 8);
                        }
                    }
                    Err(error) => {
                        tracing::error!("创建主窗口失败：{error}");
                    }
                }
            });

            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(STARTUP_FALLBACK_SECONDS));
                if app_handle.get_webview_window("splash").is_some() {
                    tracing::warn!("启动超时，强制显示主窗口并关闭 Splash。");
                    if let Err(error) = commands::finish_startup_windows(app_handle) {
                        tracing::error!("启动超时兜底失败：{error}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::finish_startup,
            commands::list_images,
            commands::list_annotation_profiles,
            commands::check_problem_items,
            commands::get_gemini_settings,
            commands::save_gemini_settings,
            commands::fetch_gemini_models,
            commands::test_gemini_connection,
            commands::generate_gemini_annotation,
            commands::generate_wd14_annotation,
            commands::generate_wd14_annotations,
            commands::get_python_env_settings,
            commands::save_python_env_settings,
            commands::get_model_settings,
            commands::save_model_settings,
            commands::get_window_rendering_settings,
            commands::save_window_rendering_settings,
            commands::pick_wd14_model_path,
            commands::pick_python_env_path,
            commands::probe_python_env,
            commands::install_managed_python_deps,
            commands::install_managed_onnx_deps,
            commands::prepare_import_folder,
            commands::start_import_folder,
            commands::mount_folder_dataset,
            commands::prepare_folder_image_import,
            commands::import_images_to_folder,
            commands::get_thumbnail_cache_info,
            commands::clear_thumbnail_cache,
            commands::get_log_files_info,
            commands::clear_log_files,
            commands::save_annotation,
            commands::save_instruction,
            commands::save_annotation_changes,
            commands::save_folder_annotation,
            commands::save_folder_instruction,
            commands::rename_dataset_image,
            commands::delete_dataset_image,
            commands::create_annotation_profile,
            commands::clear_annotation,
            commands::remove_training_set,
            commands::remove_dataset_folder,
            commands::remove_folder_dataset,
            commands::rename_dataset_folder,
            commands::create_dataset_subfolder,
            commands::delete_workspace_subfolder,
            commands::prepare_export_dataset,
            commands::start_export_dataset
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Datasets Deputy");
}
