use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::{AppError, AppResult};

const SAFETENSORS_HEADER_LENGTH_BYTES: usize = 8;
const SAFETENSORS_MAX_HEADER_BYTES: u64 = 64 * 1024 * 1024;
pub const TRAINING_CACHE_SCAN_PROGRESS_EVENT: &str = "training-cache-scan-progress";
const SCAN_PROGRESS_INTERVAL: Duration = Duration::from_millis(160);
const SCAN_PROGRESS_ENTRY_STEP: usize = 128;
const MUSUBI_CACHE_ARCHITECTURES: &[(&str, &str)] = &[
    ("hv", "hunyuan_video"),
    ("wan", "wan"),
    ("fp", "framepack"),
    ("fk", "flux_kontext"),
    ("f2d", "flux_2_dev"),
    ("f2k4b", "flux_2_klein_4b"),
    ("f2k9b", "flux_2_klein_9b"),
    ("qi", "qwen_image"),
    ("qie", "qwen_image_edit"),
    ("qil", "qwen_image_layered"),
    ("k5", "kandinsky5"),
    ("hv15", "hunyuan_video_1_5"),
    ("zi", "z_image"),
    ("ho1", "hidream_o1_image"),
    ("i4", "ideogram4"),
    ("kr2", "krea2"),
];

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingCacheScanProgress {
    pub scan_id: Option<String>,
    pub folder_path: String,
    pub scanned_entries: usize,
    pub found_items: usize,
    pub total_size_bytes: u64,
    pub current_path: String,
    pub done: bool,
}

pub type TrainingCacheScanProgressCallback =
    dyn Fn(TrainingCacheScanProgress) + Send + Sync + 'static;

pub async fn scan_training_cache(
    folder: String,
    scan_id: Option<String>,
    on_progress: Option<Box<TrainingCacheScanProgressCallback>>,
) -> AppResult<TrainingCacheScanResult> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_training_cache_folder_with_progress(&folder, scan_id, on_progress.as_deref())
    })
    .await
    .map_err(|error| AppError::InvalidInput(format!("Training cache scan task failed: {error}")))?
}

pub async fn remove_training_cache(
    folder: String,
    items: Vec<TrainingCacheItem>,
) -> AppResult<TrainingCacheRemoveResult> {
    tauri::async_runtime::spawn_blocking(move || remove_training_cache_items(&folder, items))
        .await
        .map_err(|error| {
            AppError::InvalidInput(format!("Training cache removal task failed: {error}"))
        })?
}

pub fn scan_training_cache_folder_with_progress(
    folder: &str,
    scan_id: Option<String>,
    on_progress: Option<&TrainingCacheScanProgressCallback>,
) -> AppResult<TrainingCacheScanResult> {
    let trimmed_folder = folder.trim();
    if trimmed_folder.is_empty() {
        return Err(AppError::InvalidInput(
            "Training cache scan folder is required".to_owned(),
        ));
    }

    let folder_path = PathBuf::from(trimmed_folder);
    if !folder_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Path is not a valid folder: {folder}"
        )));
    }

    let mut items = Vec::new();
    let mut scanned_entries = 0;
    let mut total_size_bytes = 0;
    let folder_path_string = folder_path.to_string_lossy().to_string();
    let mut reporter =
        TrainingCacheScanProgressReporter::new(scan_id, folder_path_string.clone(), on_progress);
    reporter.emit("", scanned_entries, items.len(), 0, false);
    collect_training_cache_items(
        &folder_path,
        &mut items,
        &mut scanned_entries,
        &mut total_size_bytes,
        &mut reporter,
    )?;
    items.sort_by_key(|item| item.path.to_ascii_lowercase());
    reporter.emit("", scanned_entries, items.len(), total_size_bytes, true);

    Ok(TrainingCacheScanResult {
        folder_path: folder_path_string,
        scanned_entries,
        items,
        total_size_bytes,
    })
}

pub fn remove_training_cache_items(
    folder: &str,
    items: Vec<TrainingCacheItem>,
) -> AppResult<TrainingCacheRemoveResult> {
    let trimmed_folder = folder.trim();
    if trimmed_folder.is_empty() {
        return Err(AppError::InvalidInput(
            "Training cache removal folder is required".to_owned(),
        ));
    }

    let folder_path = PathBuf::from(trimmed_folder);
    let canonical_folder = dunce::canonicalize(&folder_path)
        .map_err(|_| AppError::InvalidInput(format!("Could not resolve folder path: {folder}")))?;

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
}

fn collect_training_cache_items(
    folder: &Path,
    items: &mut Vec<TrainingCacheItem>,
    scanned_entries: &mut usize,
    total_size_bytes: &mut u64,
    reporter: &mut TrainingCacheScanProgressReporter<'_>,
) -> AppResult<()> {
    let mut pending = vec![folder.to_path_buf()];

    while let Some(current_folder) = pending.pop() {
        for entry in fs::read_dir(&current_folder)? {
            let entry = entry?;
            *scanned_entries += 1;

            let path = entry.path();
            let path_string = path.to_string_lossy().to_string();
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                reporter.emit_throttled(
                    &path_string,
                    *scanned_entries,
                    items.len(),
                    *total_size_bytes,
                );
                continue;
            }

            if file_type.is_dir() {
                let file_name = entry.file_name();
                if file_name.to_string_lossy() == "_latent_cache" {
                    reporter.emit(
                        &path_string,
                        *scanned_entries,
                        items.len(),
                        *total_size_bytes,
                        false,
                    );
                    let size_bytes = directory_size_with_progress(
                        &path,
                        scanned_entries,
                        items.len(),
                        *total_size_bytes,
                        reporter,
                    )?;
                    *total_size_bytes += size_bytes;
                    items.push(TrainingCacheItem {
                        path: path_string.clone(),
                        item_type: "directory".to_owned(),
                        size_bytes,
                    });
                    reporter.emit(
                        &path_string,
                        *scanned_entries,
                        items.len(),
                        *total_size_bytes,
                        false,
                    );
                    continue;
                }

                pending.push(path);
                reporter.emit_throttled(
                    &path_string,
                    *scanned_entries,
                    items.len(),
                    *total_size_bytes,
                );
                continue;
            }

            if file_type.is_file() && is_training_cache_file(&path) {
                let size_bytes = training_cache_item_size(&path)?;
                *total_size_bytes += size_bytes;
                items.push(TrainingCacheItem {
                    path: path_string.clone(),
                    item_type: "file".to_owned(),
                    size_bytes,
                });
                reporter.emit(
                    &path_string,
                    *scanned_entries,
                    items.len(),
                    *total_size_bytes,
                    false,
                );
            } else {
                reporter.emit_throttled(
                    &path_string,
                    *scanned_entries,
                    items.len(),
                    *total_size_bytes,
                );
            }
        }
    }

    Ok(())
}

fn directory_size(path: &Path) -> AppResult<u64> {
    let mut scanned_entries = 0;
    let mut reporter = TrainingCacheScanProgressReporter::new(None, String::new(), None);
    directory_size_with_progress(path, &mut scanned_entries, 0, 0, &mut reporter)
}

fn directory_size_with_progress(
    path: &Path,
    scanned_entries: &mut usize,
    found_items: usize,
    base_total_size_bytes: u64,
    reporter: &mut TrainingCacheScanProgressReporter<'_>,
) -> AppResult<u64> {
    if !path.exists() {
        return Ok(0);
    }

    let mut size = 0;
    let mut pending = vec![path.to_path_buf()];

    while let Some(current_folder) = pending.pop() {
        for entry in fs::read_dir(current_folder)? {
            let entry = entry?;
            *scanned_entries += 1;
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                reporter.emit_throttled(
                    &entry_path.to_string_lossy(),
                    *scanned_entries,
                    found_items,
                    base_total_size_bytes + size,
                );
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry_path.clone());
            } else if metadata.is_file() {
                size += metadata.len();
            }
            reporter.emit_throttled(
                &entry_path.to_string_lossy(),
                *scanned_entries,
                found_items,
                base_total_size_bytes + size,
            );
        }
    }

    Ok(size)
}

struct TrainingCacheScanProgressReporter<'a> {
    scan_id: Option<String>,
    folder_path: String,
    on_progress: Option<&'a TrainingCacheScanProgressCallback>,
    last_emit: Option<Instant>,
    last_scanned_entries: usize,
}

impl<'a> TrainingCacheScanProgressReporter<'a> {
    fn new(
        scan_id: Option<String>,
        folder_path: String,
        on_progress: Option<&'a TrainingCacheScanProgressCallback>,
    ) -> Self {
        Self {
            scan_id,
            folder_path,
            on_progress,
            last_emit: None,
            last_scanned_entries: 0,
        }
    }

    fn emit_throttled(
        &mut self,
        current_path: &str,
        scanned_entries: usize,
        found_items: usize,
        total_size_bytes: u64,
    ) {
        let should_emit = self.last_emit.is_none_or(|last_emit| {
            last_emit.elapsed() >= SCAN_PROGRESS_INTERVAL
                || scanned_entries.saturating_sub(self.last_scanned_entries)
                    >= SCAN_PROGRESS_ENTRY_STEP
        });
        if should_emit {
            self.emit(
                current_path,
                scanned_entries,
                found_items,
                total_size_bytes,
                false,
            );
        }
    }

    fn emit(
        &mut self,
        current_path: &str,
        scanned_entries: usize,
        found_items: usize,
        total_size_bytes: u64,
        done: bool,
    ) {
        let Some(on_progress) = self.on_progress else {
            return;
        };
        self.last_emit = Some(Instant::now());
        self.last_scanned_entries = scanned_entries;
        on_progress(TrainingCacheScanProgress {
            scan_id: self.scan_id.clone(),
            folder_path: self.folder_path.clone(),
            scanned_entries,
            found_items,
            total_size_bytes,
            current_path: current_path.to_owned(),
            done,
        });
    }
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
        || is_musubi_safetensors_cache_file(path)
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

fn is_musubi_safetensors_cache_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(expected_architecture) = expected_musubi_cache_architecture(file_name) else {
        return false;
    };

    safetensors_metadata_value(path, "architecture")
        .is_ok_and(|architecture| architecture == expected_architecture)
}

fn expected_musubi_cache_architecture(file_name: &str) -> Option<&'static str> {
    let file_stem = file_name.strip_suffix(".safetensors")?;
    let (stem, architecture) = file_stem.rsplit_once('_')?;
    if architecture == "te" {
        let (_, architecture) = stem.rsplit_once('_')?;
        return musubi_cache_architecture_full_name(architecture);
    }

    let (_, dimensions) = stem.rsplit_once('_')?;
    if !looks_like_musubi_cache_dimensions(dimensions) {
        return None;
    }

    musubi_cache_architecture_full_name(architecture)
}

fn musubi_cache_architecture_full_name(short_name: &str) -> Option<&'static str> {
    MUSUBI_CACHE_ARCHITECTURES
        .iter()
        .find_map(|(short, full)| (*short == short_name).then_some(*full))
}

fn looks_like_musubi_cache_dimensions(value: &str) -> bool {
    let Some((width, height)) = value.split_once('x') else {
        return false;
    };

    is_ascii_digits_with_len(width, 4) && is_ascii_digits_with_len(height, 4)
}

fn is_ascii_digits_with_len(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn safetensors_metadata_value(path: &Path, key: &str) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let file_size_bytes = file.metadata()?.len();
    if file_size_bytes < SAFETENSORS_HEADER_LENGTH_BYTES as u64 {
        return Err(AppError::InvalidInput(
            "Safetensors file is too small to contain a header length".to_owned(),
        ));
    }

    let mut length_bytes = [0u8; SAFETENSORS_HEADER_LENGTH_BYTES];
    file.read_exact(&mut length_bytes)?;
    let header_size_bytes = u64::from_le_bytes(length_bytes);
    if header_size_bytes == 0 || header_size_bytes > SAFETENSORS_MAX_HEADER_BYTES {
        return Err(AppError::InvalidInput(
            "Safetensors header length is invalid".to_owned(),
        ));
    }
    if SAFETENSORS_HEADER_LENGTH_BYTES as u64 + header_size_bytes > file_size_bytes {
        return Err(AppError::InvalidInput(
            "Safetensors header length extends past the end of the file".to_owned(),
        ));
    }

    let mut header_bytes = vec![0u8; header_size_bytes as usize];
    file.read_exact(&mut header_bytes)?;
    let header: Value = serde_json::from_slice(&header_bytes)?;
    header
        .get("__metadata__")
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get(key))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| AppError::InvalidInput(format!("Safetensors metadata is missing {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn collects_known_training_cache_items() {
        let root = temp_dir("collect");
        fs::create_dir_all(root.join("nested").join("_latent_cache")).unwrap();
        fs::write(root.join("sample.npz"), b"npz").unwrap();
        fs::write(root.join("nested").join(".aitk_size.json"), b"{}").unwrap();
        write_safetensors_like(
            &root.join("nested").join("sample_0832x1216_kr2.safetensors"),
            "krea2",
        );
        write_safetensors_like(
            &root.join("nested").join("sample_kr2_te.safetensors"),
            "krea2",
        );
        write_safetensors_like(
            &root.join("nested").join("model_0832x1216_kr2.safetensors"),
            "not_a_cache",
        );
        write_safetensors_like(
            &root.join("nested").join("qwen3vl_4b_bf16.safetensors"),
            "krea2",
        );
        fs::write(
            root.join("nested").join("_latent_cache").join("latent.bin"),
            b"latent",
        )
        .unwrap();
        fs::write(root.join("nested").join("caption.txt"), b"keep").unwrap();

        let mut items = Vec::new();
        let mut scanned_entries = 0;
        let mut total_size_bytes = 0;
        let mut reporter = TrainingCacheScanProgressReporter::new(None, String::new(), None);
        collect_training_cache_items(
            &root,
            &mut items,
            &mut scanned_entries,
            &mut total_size_bytes,
            &mut reporter,
        )
        .unwrap();

        assert_eq!(items.len(), 5);
        assert!(items.iter().any(|item| item.path.ends_with("sample.npz")));
        assert!(items
            .iter()
            .any(|item| item.path.ends_with(".aitk_size.json")));
        assert!(items
            .iter()
            .any(|item| item.path.ends_with("sample_0832x1216_kr2.safetensors")));
        assert!(items
            .iter()
            .any(|item| item.path.ends_with("sample_kr2_te.safetensors")));
        assert!(!items
            .iter()
            .any(|item| item.path.ends_with("model_0832x1216_kr2.safetensors")));
        assert!(!items
            .iter()
            .any(|item| item.path.ends_with("qwen3vl_4b_bf16.safetensors")));
        assert!(items
            .iter()
            .any(|item| item.path.ends_with("_latent_cache") && item.item_type == "directory"));
        assert!(scanned_entries >= 5);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn emits_training_cache_scan_progress() {
        let root = temp_dir("progress");
        fs::create_dir_all(root.join("_latent_cache")).unwrap();
        fs::write(root.join("_latent_cache").join("latent.bin"), b"latent").unwrap();
        fs::write(root.join("sample.npz"), b"npz").unwrap();

        let progress_events = Arc::new(Mutex::new(Vec::new()));
        let captured_events = Arc::clone(&progress_events);
        let scan_id = "scan-progress-test".to_owned();
        let on_progress = move |progress| {
            captured_events.lock().unwrap().push(progress);
        };
        let result = scan_training_cache_folder_with_progress(
            root.to_str().unwrap(),
            Some(scan_id.clone()),
            Some(&on_progress),
        )
        .unwrap();

        assert_eq!(result.items.len(), 2);
        let progress_events = progress_events.lock().unwrap();
        assert!(progress_events.len() >= 2);
        assert!(progress_events.iter().any(|progress| progress.done));
        assert!(progress_events
            .iter()
            .all(|progress| progress.scan_id.as_deref() == Some(scan_id.as_str())));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_only_supported_training_cache_paths() {
        let root = temp_dir("valid");
        fs::create_dir_all(root.join("_latent_cache")).unwrap();
        fs::write(root.join("cache.npz"), b"npz").unwrap();
        fs::write(root.join(".aitk_size.json"), b"{}").unwrap();
        write_safetensors_like(&root.join("sample_0832x1216_kr2.safetensors"), "krea2");
        write_safetensors_like(&root.join("sample_kr2_te.safetensors"), "krea2");
        write_safetensors_like(&root.join("model_0832x1216_kr2.safetensors"), "not_a_cache");
        write_safetensors_like(&root.join("qwen3vl_4b_bf16.safetensors"), "krea2");
        fs::write(root.join("keep.txt"), b"keep").unwrap();

        assert!(is_valid_training_cache_item(&root.join("_latent_cache")));
        assert!(is_valid_training_cache_item(&root.join("cache.npz")));
        assert!(is_valid_training_cache_item(&root.join(".aitk_size.json")));
        assert!(is_valid_training_cache_item(
            &root.join("sample_0832x1216_kr2.safetensors")
        ));
        assert!(is_valid_training_cache_item(
            &root.join("sample_kr2_te.safetensors")
        ));
        assert!(!is_valid_training_cache_item(
            &root.join("model_0832x1216_kr2.safetensors")
        ));
        assert!(!is_valid_training_cache_item(
            &root.join("qwen3vl_4b_bf16.safetensors")
        ));
        assert!(!is_valid_training_cache_item(&root.join("keep.txt")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removes_only_supported_safetensors_cache_items() {
        let root = temp_dir("remove-safetensors");
        fs::create_dir_all(&root).unwrap();
        let cache_path = root.join("sample_0832x1216_kr2.safetensors");
        let model_path = root.join("model_0832x1216_kr2.safetensors");
        write_safetensors_like(&cache_path, "krea2");
        write_safetensors_like(&model_path, "not_a_cache");

        let result = remove_training_cache_items(
            root.to_str().unwrap(),
            vec![
                TrainingCacheItem {
                    path: cache_path.to_string_lossy().to_string(),
                    item_type: "file".to_owned(),
                    size_bytes: 0,
                },
                TrainingCacheItem {
                    path: model_path.to_string_lossy().to_string(),
                    item_type: "file".to_owned(),
                    size_bytes: 0,
                },
            ],
        )
        .unwrap();

        assert_eq!(result.deleted, 1);
        assert_eq!(result.failed, 1);
        assert!(!cache_path.exists());
        assert!(model_path.exists());

        let _ = fs::remove_dir_all(root);
    }

    fn write_safetensors_like(path: &Path, architecture: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let header = serde_json::to_vec(&json!({
            "__metadata__": {
                "architecture": architecture,
                "format_version": "1.0.1"
            },
            "tensor": {
                "dtype": "F32",
                "shape": [1],
                "data_offsets": [0, 4]
            }
        }))
        .expect("header should serialize");
        let mut contents = Vec::new();
        contents.extend_from_slice(&(header.len() as u64).to_le_bytes());
        contents.extend_from_slice(&header);
        contents.extend_from_slice(&[0u8; 16]);
        fs::write(path, contents).expect("safetensors should write");
    }

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("datasets-deputy-cache-{label}-{unique}"));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }
}
