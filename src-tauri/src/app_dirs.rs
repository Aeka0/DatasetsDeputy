use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use sha2::{Digest, Sha256};
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, EnvFilter};

use crate::errors::AppResult;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct AppDirs {
    pub root: PathBuf,
    pub model: PathBuf,
    pub config: PathBuf,
    pub datasets: PathBuf,
    pub runtime: PathBuf,
    pub app: PathBuf,
    pub log: PathBuf,
    pub temp: PathBuf,
    pub dataset_databases: PathBuf,
}

pub fn ensure_release_dirs<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<AppDirs> {
    let root = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
        });

    let dirs = AppDirs {
        model: root.join("model"),
        config: root.join("config"),
        datasets: root.join("datasets"),
        runtime: root.join("runtime"),
        app: root.join("app"),
        log: root.join("log"),
        temp: root.join("temp"),
        dataset_databases: root.join("runtime").join("datasets"),
        root,
    };

    for dir in [
        &dirs.model,
        &dirs.config,
        &dirs.datasets,
        &dirs.runtime,
        &dirs.app,
        &dirs.log,
        &dirs.temp,
        &dirs.dataset_databases,
    ] {
        fs::create_dir_all(dir)?;
    }

    fs::create_dir_all(dirs.temp.join("thumbnails"))?;

    Ok(dirs)
}

pub fn dataset_database_path(dirs: &AppDirs, dataset_path: &Path) -> PathBuf {
    let normalized = dataset_path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let stem = dataset_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_file_stem)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "dataset".to_owned());

    dirs.dataset_databases
        .join(format!("{stem}-{}.sqlite", &hash[..16]))
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

#[allow(dead_code)]
pub fn dataset_thumbnail_dir(root: &Path, project_name: &str) -> PathBuf {
    root.join("datasets")
        .join(project_name)
        .join("cache")
        .join("thumbnails")
}

pub fn init_logging(dirs: &AppDirs) -> AppResult<()> {
    let file_appender = tracing_appender::rolling::daily(&dirs.log, "datasets-deputy.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_ansi(false)
        .try_init()
        .ok();

    tracing::info!("Logging initialized");
    Ok(())
}
