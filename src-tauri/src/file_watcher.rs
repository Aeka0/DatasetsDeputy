use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::{
    app_dirs::AppDirs,
    db::Database,
    errors::{AppError, AppResult},
    files, folders, ID_NAMESPACE_SIZE,
};

const DEBOUNCE_DELAY: Duration = Duration::from_millis(500);

pub struct ThumbnailWatcher {
    _watcher: RecommendedWatcher,
    _worker: thread::JoinHandle<()>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailInvalidationEvent {
    pub image_ids: Vec<i64>,
    pub paths: Vec<String>,
}

struct DatasetDatabaseRef {
    prefix: i64,
    path: PathBuf,
}

pub fn start(app: AppHandle, dirs: AppDirs) -> AppResult<(ThumbnailWatcher, usize)> {
    let roots = collect_watch_roots(&dirs)?;
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                if is_relevant_event(&event) {
                    let _ = tx.send(event.paths);
                }
            }
        },
        Config::default(),
    )
    .map_err(|error| AppError::InvalidInput(format!("文件监听初始化失败：{error}")))?;

    for root in &roots {
        if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
            tracing::warn!("缩略图文件监听目录注册失败：{:?}：{}", root, error);
        }
    }

    let worker_dirs = dirs.clone();
    let worker = thread::spawn(move || debounce_worker(app, worker_dirs, rx));
    Ok((
        ThumbnailWatcher {
            _watcher: watcher,
            _worker: worker,
        },
        roots.len(),
    ))
}

fn debounce_worker(app: AppHandle, dirs: AppDirs, rx: mpsc::Receiver<Vec<PathBuf>>) {
    while let Ok(paths) = rx.recv() {
        let mut pending = paths.into_iter().collect::<HashSet<_>>();
        loop {
            match rx.recv_timeout(DEBOUNCE_DELAY) {
                Ok(paths) => pending.extend(paths),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            };
        }

        if let Err(error) = invalidate_changed_paths(&app, &dirs, pending) {
            tracing::warn!("缩略图文件变更处理失败：{}", error);
        }
    }
}

fn is_relevant_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

fn collect_watch_roots(dirs: &AppDirs) -> AppResult<Vec<PathBuf>> {
    let mut roots = Vec::new();
    if dirs.datasets.is_dir() {
        roots.push(dirs.datasets.clone());
    }

    for db_ref in dataset_database_refs(dirs)? {
        let db = open_database(&db_ref.path)?;
        for image in db.list_images()? {
            let source_path = image.storage_path.as_deref().unwrap_or(&image.path);
            if let Some(parent) = Path::new(source_path).parent() {
                roots.push(parent.to_path_buf());
            }
        }
    }

    roots.extend(
        folders::registered_folder_roots(dirs)?
            .into_iter()
            .filter(|root| root.is_dir()),
    );
    Ok(reduce_watch_roots(roots))
}

fn reduce_watch_roots(mut roots: Vec<PathBuf>) -> Vec<PathBuf> {
    roots.sort_by_key(|path| normalize_path(path));
    let mut reduced: Vec<PathBuf> = Vec::new();
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let normalized = normalize_path(&root);
        if reduced
            .iter()
            .any(|existing| path_is_within(&normalized, &normalize_path(existing)))
        {
            continue;
        }
        reduced.push(root);
    }
    reduced
}

fn invalidate_changed_paths(
    app: &AppHandle,
    dirs: &AppDirs,
    paths: HashSet<PathBuf>,
) -> AppResult<()> {
    let mut image_ids = Vec::new();
    let mut changed_paths = Vec::new();
    let normalized_paths = paths
        .into_iter()
        .filter(|path| files::is_supported_image(path))
        .map(|path| (normalize_path(&path), path))
        .collect::<Vec<_>>();
    if normalized_paths.is_empty() {
        return Ok(());
    }

    for db_ref in dataset_database_refs(dirs)? {
        let mut db = open_database(&db_ref.path)?;
        for image in db.list_images()? {
            let source_path = image.storage_path.as_deref().unwrap_or(&image.path);
            let normalized_source = normalize_string_path(source_path);
            let Some((_, changed_path)) = normalized_paths
                .iter()
                .find(|(normalized_path, _)| *normalized_path == normalized_source)
            else {
                continue;
            };

            let metadata =
                files::quick_file_metadata(changed_path).unwrap_or(files::QuickFileMetadata {
                    size: 0,
                    modified_millis: 0,
                });
            if image.thumbnail_path.is_none()
                && image.file_size == Some(metadata.size)
                && image.file_mtime == Some(metadata.modified_millis)
            {
                continue;
            }
            let updated_at =
                db.invalidate_image_thumbnail(image.id, metadata.size, metadata.modified_millis)?;
            image_ids.push(db_ref.prefix * ID_NAMESPACE_SIZE + image.id);
            changed_paths.push(changed_path.to_string_lossy().to_string());
            tracing::info!(
                "源图片已变化，缩略图缓存已失效：{} ({updated_at})",
                source_path
            );
        }
    }

    for root in folders::registered_folder_roots(dirs)? {
        let normalized_root = normalize_path(&root);
        for (normalized_path, changed_path) in &normalized_paths {
            if !path_is_within(normalized_path, &normalized_root) {
                continue;
            }
            let _ = folders::refresh_registered_folder_for_path(dirs, changed_path);
            image_ids.push(folders::folder_image_public_id(&root, changed_path));
            changed_paths.push(changed_path.to_string_lossy().to_string());
        }
    }

    image_ids.sort_unstable();
    image_ids.dedup();
    changed_paths.sort();
    changed_paths.dedup();
    if !image_ids.is_empty() || !changed_paths.is_empty() {
        let _ = app.emit(
            "thumbnail-invalidated",
            ThumbnailInvalidationEvent {
                image_ids,
                paths: changed_paths,
            },
        );
    }
    Ok(())
}

fn dataset_database_refs(dirs: &AppDirs) -> AppResult<Vec<DatasetDatabaseRef>> {
    let mut paths = fs::read_dir(&dirs.dataset_databases)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sqlite"))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    let mut used_prefixes = HashSet::new();
    Ok(paths
        .into_iter()
        .map(|path| {
            let mut prefix = database_prefix(&path);
            while used_prefixes.contains(&prefix) {
                prefix += 1;
            }
            used_prefixes.insert(prefix);
            DatasetDatabaseRef { prefix, path }
        })
        .collect())
}

fn database_prefix(path: &Path) -> i64 {
    let normalized = path.to_string_lossy().to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    10_000 + (u64::from_le_bytes(bytes) % 9_000_000) as i64
}

fn open_database(path: &Path) -> AppResult<Database> {
    let db = Database::open(path)?;
    db.migrate()?;
    Ok(db)
}

fn normalize_path(path: &Path) -> String {
    normalize_string_path(&path.to_string_lossy())
}

fn normalize_string_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn path_is_within(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}
