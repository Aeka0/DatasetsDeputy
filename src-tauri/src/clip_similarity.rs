use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
    files, model_settings, python_env, AppState,
};

const EMBEDDING_BATCH_GPU: usize = 32;
const EMBEDDING_BATCH_CPU: usize = 8;
const COMPARE_BLOCK_SIZE: usize = 512;
const MAX_SOURCE_SIZE_BYTES: u64 = 512 * 1024 * 1024;

const CLIP_EMBEDDING_SCRIPT: &str = r#"
import json
import os
import sys
import traceback

payload_path = sys.argv[1]
with open(payload_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

model_dir = payload["modelDir"]
input_paths = payload["inputPaths"]
batch_size = max(1, int(payload.get("batchSize", 8)))

import numpy as np
from PIL import Image
import torch
from transformers import AutoModel, AutoProcessor

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
processor = AutoProcessor.from_pretrained(model_dir, local_files_only=True)
model = AutoModel.from_pretrained(model_dir, local_files_only=True).to(device)
model.eval()

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

def load_image(path):
    image = Image.open(path)
    if image.mode == "RGBA":
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        image = background
    elif image.mode == "P":
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        image = background
    else:
        image = image.convert("RGB")
    return image

def image_features(images):
    inputs = processor(images=images, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items() if hasattr(value, "to")}
    with torch.inference_mode():
        if hasattr(model, "get_image_features"):
            features = model.get_image_features(**inputs)
        else:
            outputs = model(**inputs)
            features = getattr(outputs, "image_embeds", None)
            if features is None:
                features = getattr(outputs, "pooler_output", None)
            if features is None:
                raise RuntimeError("CLIP model did not expose image features")
    features = features.detach().float().cpu().numpy()
    norms = np.linalg.norm(features, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (features / norms).astype(np.float32, copy=False)

def process_range(indices, paths):
    images = []
    valid_indices = []
    warnings = []
    for index, path in zip(indices, paths):
        try:
            images.append(load_image(path))
            valid_indices.append(index)
        except Exception as exc:
            warnings.append({"filePath": path, "message": f"{type(exc).__name__}: {exc}"})

    if not images:
        emit({"entries": [], "warnings": warnings, "provider": str(device)})
        return

    try:
        vectors = image_features(images)
    except Exception as exc:
        if len(images) > 1:
            midpoint = len(images) // 2
            process_range(valid_indices[:midpoint], [paths[indices.index(i)] for i in valid_indices[:midpoint]])
            process_range(valid_indices[midpoint:], [paths[indices.index(i)] for i in valid_indices[midpoint:]])
            if warnings:
                emit({"entries": [], "warnings": warnings, "provider": str(device)})
            return
        warnings.append({"filePath": paths[0], "message": f"{type(exc).__name__}: {exc}"})
        emit({"entries": [], "warnings": warnings, "provider": str(device)})
        return

    entries = [
        {"index": int(index), "embedding": vector.tolist()}
        for index, vector in zip(valid_indices, vectors)
    ]
    emit({"entries": entries, "warnings": warnings, "provider": str(device)})

for start in range(0, len(input_paths), batch_size):
    chunk_paths = input_paths[start:start + batch_size]
    chunk_indices = list(range(start, start + len(chunk_paths)))
    process_range(chunk_indices, chunk_paths)
"#;

const CLIP_COMPARE_SCRIPT: &str = r#"
import json
import sys

import numpy as np

payload_path = sys.argv[1]
with open(payload_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

count = int(payload["count"])
dim = int(payload["dim"])
threshold = float(payload["threshold"])
block_size = max(1, int(payload.get("blockSize", 512)))
embedding_path = payload["embeddingPath"]

embeddings = np.memmap(embedding_path, dtype=np.float32, mode="r", shape=(count, dim))
parent = np.arange(count, dtype=np.int32)
rank = np.zeros(count, dtype=np.int8)
pairs = []
max_pairs = 200000

def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return int(x)

def union(a, b):
    ra = find(int(a))
    rb = find(int(b))
    if ra == rb:
        return
    if rank[ra] < rank[rb]:
        parent[ra] = rb
    elif rank[ra] > rank[rb]:
        parent[rb] = ra
    else:
        parent[rb] = ra
        rank[ra] += 1

for left_start in range(0, count, block_size):
    left_end = min(count, left_start + block_size)
    left = embeddings[left_start:left_end]
    for right_start in range(left_start, count, block_size):
        right_end = min(count, right_start + block_size)
        right = embeddings[right_start:right_end]
        scores = left @ right.T
        hits = np.argwhere(scores >= threshold)
        for left_local, right_local in hits:
            left_index = left_start + int(left_local)
            right_index = right_start + int(right_local)
            if right_index <= left_index:
                continue
            score = float(scores[left_local, right_local])
            union(left_index, right_index)
            if len(pairs) < max_pairs:
                pairs.append((left_index, right_index, score))

groups = {}
for index in range(count):
    groups.setdefault(find(index), []).append(index)

stats = {}
for left, right, score in pairs:
    root = find(left)
    item = stats.setdefault(root, {"min": score, "max": score, "pairs": 0})
    item["min"] = min(item["min"], score)
    item["max"] = max(item["max"], score)
    item["pairs"] += 1

result_groups = []
for root, members in groups.items():
    if len(members) < 2:
        continue
    item = stats.get(root, {"min": threshold, "max": threshold, "pairs": 0})
    result_groups.append({
        "memberIndices": members,
        "minScore": item["min"],
        "maxScore": item["max"],
        "pairCount": item["pairs"],
    })

result_groups.sort(key=lambda group: (-len(group["memberIndices"]), -group["maxScore"]))
print(json.dumps({"groups": result_groups}, ensure_ascii=False))
"#;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityScanOptions {
    pub threshold: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityScanProgress {
    pub scan_id: String,
    pub phase: String,
    pub processed: usize,
    pub total: usize,
    pub current_path: Option<String>,
    pub warning: Option<SimilarityWarning>,
    pub done: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityWarning {
    pub file_path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityImageResult {
    pub file_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_millis: i64,
    pub exact_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityGroupResult {
    pub id: String,
    pub group_kind: String,
    pub min_score: f32,
    pub max_score: f32,
    pub pair_count: usize,
    pub images: Vec<SimilarityImageResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityScanComplete {
    pub scan_id: String,
    pub folder_path: String,
    pub threshold: f32,
    pub scanned: usize,
    pub cache_hits: usize,
    pub embedded: usize,
    pub skipped: usize,
    pub elapsed_seconds: f64,
    pub groups: Vec<SimilarityGroupResult>,
    pub warnings: Vec<SimilarityWarning>,
}

#[derive(Clone)]
struct SourceImage {
    path: PathBuf,
    normalized_path: String,
    file_name: String,
    size_bytes: u64,
    modified_millis: i64,
    exact_hash: Option<String>,
}

struct ImageEmbedding {
    image_index: usize,
    vector: Vec<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingPayload {
    entries: Vec<EmbeddingEntryPayload>,
    #[serde(default)]
    warnings: Vec<SimilarityWarning>,
    provider: Option<String>,
}

#[derive(Deserialize)]
struct EmbeddingEntryPayload {
    index: usize,
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComparePayload {
    groups: Vec<CompareGroupPayload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompareGroupPayload {
    member_indices: Vec<usize>,
    min_score: f32,
    max_score: f32,
    pair_count: usize,
}

pub fn start_scan(
    app: AppHandle,
    dirs: AppDirs,
    scan_id: String,
    folder: String,
    options: SimilarityScanOptions,
    cancel: Arc<AtomicBool>,
) {
    let scan_id_for_thread = scan_id.clone();
    let app_for_thread = app.clone();
    thread::spawn(move || {
        let start = Instant::now();
        let result = run_scan(
            &app_for_thread,
            &dirs,
            &scan_id_for_thread,
            &folder,
            options,
            &cancel,
            start,
        );
        if let Err(error) = result {
            let _ = app_for_thread.emit(
                "similarity-scan-progress",
                SimilarityScanProgress {
                    scan_id: scan_id_for_thread.clone(),
                    phase: "failed".to_owned(),
                    processed: 0,
                    total: 0,
                    current_path: None,
                    warning: Some(SimilarityWarning {
                        file_path: folder.clone(),
                        message: error.to_string(),
                    }),
                    done: true,
                },
            );
        }

        if let Some(state) = app_for_thread.try_state::<AppState>() {
            if let Ok(mut scans) = state.similarity_scans.lock() {
                scans.remove(&scan_id_for_thread);
            }
        }
    });
}

fn run_scan(
    app: &AppHandle,
    dirs: &AppDirs,
    scan_id: &str,
    folder: &str,
    options: SimilarityScanOptions,
    cancel: &AtomicBool,
    start: Instant,
) -> AppResult<()> {
    let folder_path = PathBuf::from(folder);
    if !folder_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Path is not a valid folder: {folder}"
        )));
    }

    let threshold = options.threshold.unwrap_or(0.96).clamp(0.80, 0.99);
    emit_progress(app, scan_id, "scanning", 0, 0, None, None, false);
    let (mut images, mut warnings) = collect_source_images(&folder_path, cancel)?;
    images.sort_by_key(|image| image.normalized_path.to_ascii_lowercase());
    emit_progress(app, scan_id, "scanning", images.len(), images.len(), None, None, false);
    check_cancel(cancel)?;

    mark_exact_hashes(app, scan_id, &mut images, &mut warnings, cancel)?;
    check_cancel(cancel)?;

    let settings = model_settings::load_settings(dirs)?;
    let model_dir = resolve_clip_model_dir(&settings.clip_similarity.model_path)?;
    let model_fingerprint = model_fingerprint(&model_dir)?;
    let mut cache = SimilarityCache::open(&dirs.temp.join("similarity-cache.sqlite"))?;

    let mut embeddings = Vec::<Option<Vec<f32>>>::new();
    embeddings.resize_with(images.len(), || None);
    let mut missing = Vec::<usize>::new();
    let mut cache_hits = 0;
    for (index, image) in images.iter().enumerate() {
        if let Some(vector) = cache.get(image, &model_fingerprint)? {
            embeddings[index] = Some(vector);
            cache_hits += 1;
        } else {
            missing.push(index);
        }
    }

    emit_progress(
        app,
        scan_id,
        "embedding",
        cache_hits,
        images.len(),
        None,
        None,
        false,
    );
    let embedded = if missing.is_empty() {
        0
    } else {
        embed_missing_images(
            app,
            dirs,
            scan_id,
            &model_dir,
            &images,
            &missing,
            &model_fingerprint,
            &mut cache,
            &mut embeddings,
            &mut warnings,
            cancel,
        )?
    };
    check_cancel(cancel)?;

    let available = embeddings
        .into_iter()
        .enumerate()
        .filter_map(|(image_index, vector)| vector.map(|vector| ImageEmbedding { image_index, vector }))
        .collect::<Vec<_>>();

    emit_progress(
        app,
        scan_id,
        "comparing",
        0,
        available.len(),
        None,
        None,
        false,
    );
    let mut groups = exact_duplicate_groups(&images);
    groups.extend(compare_embeddings(
        dirs,
        scan_id,
        &images,
        &available,
        threshold,
        cancel,
    )?);
    groups.sort_by(|left, right| {
        right
            .images
            .len()
            .cmp(&left.images.len())
            .then_with(|| right.max_score.total_cmp(&left.max_score))
    });

    let complete = SimilarityScanComplete {
        scan_id: scan_id.to_owned(),
        folder_path: folder_path.to_string_lossy().to_string(),
        threshold,
        scanned: images.len(),
        cache_hits,
        embedded,
        skipped: warnings.len(),
        elapsed_seconds: start.elapsed().as_secs_f64(),
        groups,
        warnings,
    };
    let _ = app.emit("similarity-scan-complete", complete);
    emit_progress(
        app,
        scan_id,
        "done",
        images.len(),
        images.len(),
        None,
        None,
        true,
    );
    Ok(())
}

fn collect_source_images(
    folder: &Path,
    cancel: &AtomicBool,
) -> AppResult<(Vec<SourceImage>, Vec<SimilarityWarning>)> {
    let mut images = Vec::new();
    let mut warnings = Vec::new();
    for path in files::collect_image_paths(folder) {
        check_cancel(cancel)?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(SimilarityWarning {
                    file_path: path.to_string_lossy().to_string(),
                    message: error.to_string(),
                });
                continue;
            }
        };
        if metadata.len() > MAX_SOURCE_SIZE_BYTES {
            warnings.push(SimilarityWarning {
                file_path: path.to_string_lossy().to_string(),
                message: format!(
                    "Skipped image larger than {:.0} MB",
                    MAX_SOURCE_SIZE_BYTES as f64 / 1_000_000.0
                ),
            });
            continue;
        }
        if let Err(error) = image::image_dimensions(&path) {
            warnings.push(SimilarityWarning {
                file_path: path.to_string_lossy().to_string(),
                message: error.to_string(),
            });
            continue;
        }
        images.push(SourceImage {
            normalized_path: normalize_path(&path),
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_owned(),
            size_bytes: metadata.len(),
            modified_millis: modified_millis(&metadata),
            exact_hash: None,
            path,
        });
    }
    Ok((images, warnings))
}

fn mark_exact_hashes(
    app: &AppHandle,
    scan_id: &str,
    images: &mut [SourceImage],
    warnings: &mut Vec<SimilarityWarning>,
    cancel: &AtomicBool,
) -> AppResult<()> {
    let mut by_size = HashMap::<u64, Vec<usize>>::new();
    for (index, image) in images.iter().enumerate() {
        by_size.entry(image.size_bytes).or_default().push(index);
    }
    let candidate_total = by_size.values().filter(|items| items.len() > 1).map(Vec::len).sum();
    let mut processed = 0;
    for indexes in by_size.values().filter(|items| items.len() > 1) {
        for index in indexes {
            check_cancel(cancel)?;
            let image = &mut images[*index];
            match files::hash_file(&image.path) {
                Ok(hash) => image.exact_hash = Some(hash),
                Err(error) => warnings.push(SimilarityWarning {
                    file_path: image.normalized_path.clone(),
                    message: error.to_string(),
                }),
            }
            processed += 1;
            if processed % 25 == 0 || processed == candidate_total {
                emit_progress(
                    app,
                    scan_id,
                    "hashing",
                    processed,
                    candidate_total,
                    Some(image.normalized_path.clone()),
                    None,
                    false,
                );
            }
        }
    }
    Ok(())
}

fn embed_missing_images(
    app: &AppHandle,
    dirs: &AppDirs,
    scan_id: &str,
    model_dir: &Path,
    images: &[SourceImage],
    missing: &[usize],
    model_fingerprint: &str,
    cache: &mut SimilarityCache,
    embeddings: &mut [Option<Vec<f32>>],
    warnings: &mut Vec<SimilarityWarning>,
    cancel: &AtomicBool,
) -> AppResult<usize> {
    let python_path = python_env::resolve_configured_python_path(dirs)?.ok_or_else(|| {
        AppError::InvalidInput("Python runtime is not configured or available".to_owned())
    })?;
    let batch_size = if python_env::probe_environment(dirs, None)
        .map(|report| report.cuda_available)
        .unwrap_or(false)
    {
        EMBEDDING_BATCH_GPU
    } else {
        EMBEDDING_BATCH_CPU
    };

    let request_path = temp_json_path(dirs, scan_id, "clip-embedding-request");
    let input_paths = missing
        .iter()
        .map(|index| images[*index].normalized_path.clone())
        .collect::<Vec<_>>();
    fs::write(
        &request_path,
        serde_json::to_string(&serde_json::json!({
            "modelDir": model_dir,
            "inputPaths": input_paths,
            "batchSize": batch_size,
        }))?,
    )?;

    let mut child = Command::new(python_path)
        .arg("-c")
        .arg(CLIP_EMBEDDING_SCRIPT)
        .arg(&request_path)
        .env("PYTHONIOENCODING", "utf-8")
        .env("OMP_NUM_THREADS", "2")
        .env("MKL_NUM_THREADS", "2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stderr = child.stderr.take();
    let stderr_reader = thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    });

    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::InvalidInput("CLIP process did not expose stdout".to_owned())
    })?;
    let mut embedded = 0;
    let mut provider = String::new();
    for line in BufReader::new(stdout).lines() {
        check_cancel(cancel)?;
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let batch = serde_json::from_str::<EmbeddingPayload>(line).map_err(|error| {
            AppError::InvalidInput(format!("CLIP embedding parse failed: {error}; line={line}"))
        })?;
        if let Some(next_provider) = batch.provider {
            provider = next_provider;
        }
        for warning in batch.warnings {
            emit_progress(
                app,
                scan_id,
                "embedding",
                embedded,
                missing.len(),
                None,
                Some(warning.clone()),
                false,
            );
            warnings.push(warning);
        }
        for entry in batch.entries {
            let Some(&image_index) = missing.get(entry.index) else {
                continue;
            };
            let vector = normalize_vector(entry.embedding);
            cache.put(&images[image_index], model_fingerprint, &vector)?;
            embeddings[image_index] = Some(vector);
            embedded += 1;
        }
        emit_progress(
            app,
            scan_id,
            "embedding",
            embedded,
            missing.len(),
            None,
            None,
            false,
        );
    }

    if cancel.load(Ordering::Relaxed) {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let stderr = stderr_reader.join().unwrap_or_default().trim().to_owned();
    let _ = fs::remove_file(request_path);
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::InvalidInput("Similarity scan cancelled".to_owned()));
    }
    if !status.success() {
        return Err(AppError::InvalidInput(if stderr.is_empty() {
            "CLIP embedding failed".to_owned()
        } else {
            stderr
        }));
    }
    if !provider.is_empty() {
        tracing::info!("CLIP similarity provider: {provider}");
    }
    Ok(embedded)
}

fn compare_embeddings(
    dirs: &AppDirs,
    scan_id: &str,
    images: &[SourceImage],
    embeddings: &[ImageEmbedding],
    threshold: f32,
    cancel: &AtomicBool,
) -> AppResult<Vec<SimilarityGroupResult>> {
    if embeddings.len() < 2 {
        return Ok(Vec::new());
    }
    let dim = embeddings[0].vector.len();
    if dim == 0 || embeddings.iter().any(|item| item.vector.len() != dim) {
        return Err(AppError::InvalidInput(
            "CLIP embeddings have inconsistent dimensions".to_owned(),
        ));
    }

    let embedding_path = temp_json_path(dirs, scan_id, "clip-embeddings").with_extension("bin");
    let request_path = temp_json_path(dirs, scan_id, "clip-compare-request");
    let mut bytes = Vec::with_capacity(embeddings.len() * dim * 4);
    for item in embeddings {
        for value in &item.vector {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    fs::write(&embedding_path, bytes)?;
    fs::write(
        &request_path,
        serde_json::to_string(&serde_json::json!({
            "embeddingPath": embedding_path,
            "count": embeddings.len(),
            "dim": dim,
            "threshold": threshold,
            "blockSize": COMPARE_BLOCK_SIZE,
        }))?,
    )?;

    let python_path = python_env::resolve_configured_python_path(dirs)?.ok_or_else(|| {
        AppError::InvalidInput("Python runtime is not configured or available".to_owned())
    })?;
    let output = Command::new(python_path)
        .arg("-c")
        .arg(CLIP_COMPARE_SCRIPT)
        .arg(&request_path)
        .env("PYTHONIOENCODING", "utf-8")
        .output()?;
    let _ = fs::remove_file(&request_path);
    let _ = fs::remove_file(&embedding_path);
    check_cancel(cancel)?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        return Err(AppError::InvalidInput(if stderr.is_empty() {
            "CLIP similarity comparison failed".to_owned()
        } else {
            stderr
        }));
    }
    let payload: ComparePayload = serde_json::from_str(&stdout).map_err(|error| {
        AppError::InvalidInput(format!("CLIP comparison result parse failed: {error}"))
    })?;

    let mut exact_sets = HashSet::<String>::new();
    for group in exact_duplicate_groups(images) {
        let key = group
            .images
            .iter()
            .map(|image| image.file_path.clone())
            .collect::<Vec<_>>()
            .join("\n");
        exact_sets.insert(key);
    }

    let mut groups = Vec::new();
    for (group_index, group) in payload.groups.into_iter().enumerate() {
        let mut image_indexes = group
            .member_indices
            .into_iter()
            .filter_map(|embedding_index| embeddings.get(embedding_index).map(|item| item.image_index))
            .collect::<Vec<_>>();
        image_indexes.sort_unstable();
        image_indexes.dedup();
        if image_indexes.len() < 2 {
            continue;
        }
        let result_images = image_indexes
            .iter()
            .map(|index| image_result(&images[*index]))
            .collect::<Vec<_>>();
        let exact_key = result_images
            .iter()
            .map(|image| image.file_path.clone())
            .collect::<Vec<_>>()
            .join("\n");
        if exact_sets.contains(&exact_key) {
            continue;
        }
        groups.push(SimilarityGroupResult {
            id: format!("similar-{group_index}"),
            group_kind: "similar".to_owned(),
            min_score: group.min_score,
            max_score: group.max_score,
            pair_count: group.pair_count,
            images: result_images,
        });
    }
    Ok(groups)
}

fn exact_duplicate_groups(images: &[SourceImage]) -> Vec<SimilarityGroupResult> {
    let mut by_hash = HashMap::<String, Vec<usize>>::new();
    for (index, image) in images.iter().enumerate() {
        if let Some(hash) = &image.exact_hash {
            by_hash.entry(hash.clone()).or_default().push(index);
        }
    }

    by_hash
        .into_iter()
        .filter(|(_, indexes)| indexes.len() > 1)
        .enumerate()
        .map(|(group_index, (_, indexes))| {
            let pair_count = indexes.len().saturating_mul(indexes.len().saturating_sub(1)) / 2;
            SimilarityGroupResult {
                id: format!("exact-{group_index}"),
                group_kind: "exact".to_owned(),
                min_score: 1.0,
                max_score: 1.0,
                pair_count,
                images: indexes.into_iter().map(|index| image_result(&images[index])).collect(),
            }
        })
        .collect()
}

fn image_result(image: &SourceImage) -> SimilarityImageResult {
    SimilarityImageResult {
        file_path: image.normalized_path.clone(),
        file_name: image.file_name.clone(),
        size_bytes: image.size_bytes,
        modified_millis: image.modified_millis,
        exact_hash: image.exact_hash.clone(),
    }
}

struct SimilarityCache {
    conn: Connection,
}

impl SimilarityCache {
    fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS clip_embeddings (
              path TEXT NOT NULL,
              file_size INTEGER NOT NULL,
              file_mtime INTEGER NOT NULL,
              model_fingerprint TEXT NOT NULL,
              dim INTEGER NOT NULL,
              embedding BLOB NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(path, model_fingerprint)
            );
            "#,
        )?;
        Ok(Self { conn })
    }

    fn get(&self, image: &SourceImage, model_fingerprint: &str) -> AppResult<Option<Vec<f32>>> {
        let row: Option<(i64, i64, Vec<u8>)> = self
            .conn
            .query_row(
                "SELECT file_size, file_mtime, embedding
                 FROM clip_embeddings
                 WHERE path = ?1 AND model_fingerprint = ?2",
                params![image.normalized_path, model_fingerprint],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((size, mtime, bytes)) = row else {
            return Ok(None);
        };
        if size as u64 != image.size_bytes || mtime != image.modified_millis {
            return Ok(None);
        }
        Ok(decode_embedding(&bytes).map(normalize_vector))
    }

    fn put(
        &mut self,
        image: &SourceImage,
        model_fingerprint: &str,
        vector: &[f32],
    ) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO clip_embeddings
             (path, file_size, file_mtime, model_fingerprint, dim, embedding, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path, model_fingerprint)
             DO UPDATE SET
               file_size = excluded.file_size,
               file_mtime = excluded.file_mtime,
               dim = excluded.dim,
               embedding = excluded.embedding,
               updated_at = excluded.updated_at",
            params![
                image.normalized_path,
                image.size_bytes as i64,
                image.modified_millis,
                model_fingerprint,
                vector.len() as i64,
                encode_embedding(vector),
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }
}

fn encode_embedding(values: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_embedding(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect(),
    )
}

fn normalize_vector(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn resolve_clip_model_dir(model_path: &str) -> AppResult<PathBuf> {
    if model_path.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "CLIP similarity model path is not configured".to_owned(),
        ));
    }
    let path = PathBuf::from(model_path.trim());
    if path.is_dir() {
        return Ok(path);
    }
    Err(AppError::InvalidInput(format!(
        "CLIP similarity model folder does not exist: {model_path}"
    )))
}

fn model_fingerprint(model_dir: &Path) -> AppResult<String> {
    let canonical = dunce::canonicalize(model_dir)?;
    let mut newest = 0_i64;
    let mut count = 0_u64;
    for entry in walkdir::WalkDir::new(&canonical).max_depth(3).into_iter().filter_map(Result::ok) {
        if !entry.path().is_file() {
            continue;
        }
        count += 1;
        if let Ok(metadata) = entry.metadata() {
            newest = newest.max(modified_millis(&metadata));
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(normalize_path(&canonical).as_bytes());
    hasher.update(count.to_le_bytes());
    hasher.update(newest.to_le_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

fn modified_millis(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn normalize_path(path: &Path) -> String {
    dunce::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned()
}

fn temp_json_path(dirs: &AppDirs, scan_id: &str, label: &str) -> PathBuf {
    let safe_scan_id = scan_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    dirs.temp
        .join(format!("{label}-{safe_scan_id}-{nonce}.json"))
}

fn emit_progress(
    app: &AppHandle,
    scan_id: &str,
    phase: &str,
    processed: usize,
    total: usize,
    current_path: Option<String>,
    warning: Option<SimilarityWarning>,
    done: bool,
) {
    let _ = app.emit(
        "similarity-scan-progress",
        SimilarityScanProgress {
            scan_id: scan_id.to_owned(),
            phase: phase.to_owned(),
            processed,
            total,
            current_path,
            warning,
            done,
        },
    );
}

fn check_cancel(cancel: &AtomicBool) -> AppResult<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::InvalidInput("Similarity scan cancelled".to_owned()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_vectors() {
        let vector = normalize_vector(vec![3.0, 4.0]);
        assert!((vector[0] - 0.6).abs() < 0.0001);
        assert!((vector[1] - 0.8).abs() < 0.0001);
    }

    #[test]
    fn encodes_and_decodes_embeddings() {
        let vector = vec![0.1, -0.2, 0.3];
        let decoded = decode_embedding(&encode_embedding(&vector)).unwrap();
        assert_eq!(decoded, vector);
    }
}
