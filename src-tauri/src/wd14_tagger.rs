use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
    model_settings::{self, Wd14TaggerSettings},
    python_env,
};

const INFERENCE_BATCH_SIZE: usize = 1;
const CPU_INFERENCE_THREADS: usize = 2;

const INFERENCE_SCRIPT: &str = r#"
import json
import os
import sys

import numpy as np

def load_payload():
    if len(sys.argv) >= 3 and sys.argv[1] == "--payload-file":
        with open(sys.argv[2], "r", encoding="utf-8") as handle:
            return json.load(handle)
    if len(sys.argv) >= 2:
        return json.loads(sys.argv[1])
    raise RuntimeError("Missing WD14 inference payload.")

payload = load_payload()
model_dir = payload["modelDir"]
model_type = payload["modelType"]
input_paths = payload.get("inputPaths") or [payload["inputPath"]]
tag_count = int(payload["tagCount"])
batch_size = max(1, int(payload.get("batchSize", 16)))
stream = bool(payload.get("stream", False))
cpu_threads = max(1, int(payload.get("cpuThreads", 4)))

def emit_batch(start, scores, provider):
    print(json.dumps({"start": start, "scores": scores, "provider": provider}, ensure_ascii=False), flush=True)

def first_file(extensions):
    matches = []
    for root, _dirs, files in os.walk(model_dir):
        for name in files:
            if os.path.splitext(name)[1].lower() in extensions:
                matches.append(os.path.join(root, name))
    matches.sort(key=lambda value: value.lower())
    if not matches:
        return None
    return matches[0]

def as_numpy(value):
    if isinstance(value, dict):
        values = list(value.values())
        if not values:
            raise RuntimeError("model returned an empty dict")
        value = values[0]
    elif isinstance(value, (list, tuple)):
        if not value:
            raise RuntimeError("model returned an empty sequence")
        value = value[0]
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    return np.asarray(value, dtype=np.float32)

def select_score_matrix(outputs, expected_batch_size):
    best = None
    best_length = -1
    for output in outputs:
        candidate = np.asarray(output, dtype=np.float32)
        if candidate.ndim >= 2 and candidate.shape[0] == expected_batch_size and candidate.reshape(expected_batch_size, -1).shape[1] == tag_count:
            return candidate.reshape(expected_batch_size, -1)
        if candidate.size == expected_batch_size * tag_count:
            return candidate.reshape(expected_batch_size, tag_count)
        if expected_batch_size == 1 and candidate.size == tag_count:
            return candidate.reshape(1, tag_count)
        candidate = candidate.reshape(-1)
        if expected_batch_size == 1 and candidate.size == tag_count:
            return candidate.reshape(1, tag_count)
        if candidate.size > best_length:
            best = candidate
            best_length = candidate.size
    if best is None or best.size == 0:
        raise RuntimeError("model did not return a tensor output")
    return best.reshape(expected_batch_size, -1) if best.size % expected_batch_size == 0 else best.reshape(1, -1)

def fit_inside(width, height, target_width, target_height):
    if width <= 0 or height <= 0:
        return (0, 0, target_width, target_height)
    scale = min(target_width / float(width), target_height / float(height))
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    left = (target_width - resized_width) // 2
    top = (target_height - resized_height) // 2
    return (left, top, resized_width, resized_height)

def load_image_batch(paths, layout="nchw"):
    from PIL import Image

    batch = []
    for path in paths:
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

        if layout == "nhwc":
            left, top, resized_width, resized_height = fit_inside(image.width, image.height, 448, 448)
            resized = image.resize((resized_width, resized_height), Image.Resampling.BICUBIC)
            canvas = Image.new("RGB", (448, 448), (255, 255, 255))
            canvas.paste(resized, (left, top))
            array = np.asarray(canvas, dtype=np.float32)
            batch.append(array[:, :, ::-1])
        else:
            image = image.resize((448, 448), Image.Resampling.BICUBIC)
            array = np.asarray(image, dtype=np.float32) / 255.0
            array = (array - 0.5) / 0.5
            batch.append(np.transpose(array, (2, 0, 1)))
    return np.stack(batch, axis=0).astype(np.float32, copy=False)

def onnx_input_layout(shape):
    if len(shape) == 4 and shape[-1] == 3:
        return "nhwc"
    return "nchw"

if model_type == "onnx":
    import onnxruntime as ort

    model_path = first_file({".onnx"})
    if model_path is None:
        raise FileNotFoundError("No ONNX model file was found in the WD14 model folder.")

    available = set(ort.get_available_providers())
    providers = [
        provider
        for provider in ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")
        if provider in available
    ]
    if not providers:
        providers = ["CPUExecutionProvider"]

    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = cpu_threads
    session_options.inter_op_num_threads = 1

    session = ort.InferenceSession(model_path, sess_options=session_options, providers=providers)
    input_meta = session.get_inputs()[0]
    shape = input_meta.shape
    layout = onnx_input_layout(shape)
    all_scores = []
    provider = session.get_providers()[0]
    for start in range(0, len(input_paths), batch_size):
        chunk_paths = input_paths[start:start + batch_size]
        model_input = load_image_batch(chunk_paths, layout)
        outputs = session.run(None, {input_meta.name: model_input})
        scores = select_score_matrix(outputs, len(chunk_paths)).tolist()
        if stream:
            emit_batch(start, scores, provider)
        else:
            all_scores.extend(scores)
    if not stream:
        print(json.dumps({"scores": all_scores, "provider": provider}, ensure_ascii=False))
elif model_type == "pytorch":
    import torch

    torch.set_num_threads(cpu_threads)
    torch.set_num_interop_threads(1)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cudnn.benchmark = True

    if os.path.isfile(os.path.join(model_dir, "config.json")):
        try:
            from transformers import AutoModelForImageClassification
        except Exception as exc:
            raise RuntimeError(
                "This PyTorch WD14 folder looks like a Hugging Face model, but transformers is not installed."
            ) from exc
        model = AutoModelForImageClassification.from_pretrained(model_dir).to(device)
        model.eval()
        all_scores = []
        with torch.inference_mode():
            for start in range(0, len(input_paths), batch_size):
                chunk_paths = input_paths[start:start + batch_size]
                tensor = torch.from_numpy(load_image_batch(chunk_paths)).to(device, non_blocking=True)
                output = model(pixel_values=tensor)
                scores = as_numpy(getattr(output, "logits", output)).reshape(len(chunk_paths), -1).tolist()
                if stream:
                    emit_batch(start, scores, str(device))
                else:
                    all_scores.extend(scores)
    else:
        model_path = first_file({".pt", ".pth"})
        if model_path is None:
            raise FileNotFoundError("No TorchScript .pt/.pth model file was found in the WD14 model folder.")
        try:
            model = torch.jit.load(model_path, map_location=device)
        except Exception as exc:
            raise RuntimeError(
                "PyTorch WD14 inference currently supports TorchScript .pt/.pth files or Hugging Face folders."
            ) from exc
        model.eval()
        all_scores = []
        with torch.inference_mode():
            for start in range(0, len(input_paths), batch_size):
                chunk_paths = input_paths[start:start + batch_size]
                tensor = torch.from_numpy(load_image_batch(chunk_paths)).to(device, non_blocking=True)
                scores = as_numpy(model(tensor)).reshape(len(chunk_paths), -1).tolist()
                if stream:
                    emit_batch(start, scores, str(device))
                else:
                    all_scores.extend(scores)

    if not stream:
        print(json.dumps({"scores": all_scores, "provider": str(device)}, ensure_ascii=False))
else:
    raise RuntimeError("Unknown WD14 model type. Select a folder containing ONNX or PyTorch weights.")
"#;

#[derive(Debug)]
struct TagDefinition {
    index: usize,
    name: String,
    category: i32,
    intellectual_properties: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct InferencePayload {
    scores: Vec<Vec<f32>>,
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InferenceBatchPayload {
    start: usize,
    scores: Vec<Vec<f32>>,
    provider: Option<String>,
}

struct TempPayloadFile {
    path: PathBuf,
}

impl TempPayloadFile {
    fn write(dirs: &AppDirs, payload: &serde_json::Value) -> AppResult<Self> {
        fs::create_dir_all(&dirs.temp)?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = dirs.temp.join(format!(
            "wd14-inference-request-{}-{nonce}.json",
            std::process::id()
        ));
        fs::write(&path, serde_json::to_vec(payload)?)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempPayloadFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wd14TaggerResult {
    pub positive_prompt: String,
    pub execution_provider: String,
}

pub fn generate_annotation(dirs: &AppDirs, image_path: &Path) -> AppResult<Wd14TaggerResult> {
    generate_annotations(dirs, &[image_path.to_path_buf()])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::InvalidInput("WD14 did not return an annotation".to_owned()))
}

pub fn generate_annotations(
    dirs: &AppDirs,
    image_paths: &[PathBuf],
) -> AppResult<Vec<Wd14TaggerResult>> {
    if image_paths.is_empty() {
        return Ok(Vec::new());
    }

    let model_settings = model_settings::load_settings(dirs)?;
    let tagger_settings = model_settings.wd14_tagger;
    let model_dir = resolve_model_dir(&tagger_settings)?;
    let tags = load_tag_definitions(&model_dir)?;
    let payload =
        run_python_inference(dirs, &tagger_settings, &model_dir, image_paths, tags.len())?;
    let all_scores = payload.scores;
    if all_scores.len() != image_paths.len() {
        return Err(AppError::InvalidInput(format!(
            "WD14 returned {} results for {} images",
            all_scores.len(),
            image_paths.len()
        )));
    }
    let execution_provider = payload
        .provider
        .unwrap_or_else(|| tagger_settings.model_type.clone());
    all_scores
        .iter()
        .map(|scores| {
            let positive_prompt = build_prompt(scores, &tags, &tagger_settings)?;
            Ok(Wd14TaggerResult {
                positive_prompt,
                execution_provider: execution_provider.clone(),
            })
        })
        .collect()
}

pub fn generate_annotations_streaming<F>(
    dirs: &AppDirs,
    image_paths: &[PathBuf],
    mut on_batch: F,
) -> AppResult<Vec<Wd14TaggerResult>>
where
    F: FnMut(usize, &[Wd14TaggerResult]) -> AppResult<()>,
{
    if image_paths.is_empty() {
        return Ok(Vec::new());
    }

    let model_settings = model_settings::load_settings(dirs)?;
    let tagger_settings = model_settings.wd14_tagger;
    let model_dir = resolve_model_dir(&tagger_settings)?;
    let tags = load_tag_definitions(&model_dir)?;
    let mut results = Vec::<Option<Wd14TaggerResult>>::with_capacity(image_paths.len());
    results.resize_with(image_paths.len(), || None);

    run_python_inference_streaming(
        dirs,
        &tagger_settings,
        &model_dir,
        image_paths,
        tags.len(),
        |batch| {
            if batch.start + batch.scores.len() > image_paths.len() {
                return Err(AppError::InvalidInput(format!(
                    "WD14 returned a batch outside the target list: {} + {} / {}",
                    batch.start,
                    batch.scores.len(),
                    image_paths.len()
                )));
            }

            let execution_provider = batch
                .provider
                .unwrap_or_else(|| tagger_settings.model_type.clone());
            let batch_results = batch
                .scores
                .iter()
                .map(|scores| {
                    build_prompt(scores, &tags, &tagger_settings).map(|positive_prompt| {
                        Wd14TaggerResult {
                            positive_prompt,
                            execution_provider: execution_provider.clone(),
                        }
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;

            for (offset, result) in batch_results.iter().cloned().enumerate() {
                results[batch.start + offset] = Some(result);
            }
            on_batch(batch.start, &batch_results)
        },
    )?;

    results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.ok_or_else(|| {
                AppError::InvalidInput(format!("WD14 did not return a result for image {index}"))
            })
        })
        .collect()
}

fn resolve_model_dir(settings: &Wd14TaggerSettings) -> AppResult<PathBuf> {
    if settings.model_path.trim().is_empty() {
        return Err(AppError::InvalidInput("WD14 模型文件夹尚未设置".to_owned()));
    }

    let path = PathBuf::from(settings.model_path.trim());
    if path.is_dir() {
        return Ok(path);
    }
    if path.is_file() {
        return path.parent().map(Path::to_path_buf).ok_or_else(|| {
            AppError::InvalidInput("无法从 WD14 模型文件解析模型文件夹".to_owned())
        });
    }
    Err(AppError::InvalidInput(format!(
        "WD14 模型文件夹不存在：{}",
        settings.model_path
    )))
}

fn run_python_inference(
    dirs: &AppDirs,
    settings: &Wd14TaggerSettings,
    model_dir: &Path,
    input_paths: &[PathBuf],
    tag_count: usize,
) -> AppResult<InferencePayload> {
    let python_path = python_env::resolve_configured_python_path(dirs)?.ok_or_else(|| {
        AppError::InvalidInput(
            "未找到可用 Python 运行时，请先在本地文件/环境中配置或安装运行时".to_owned(),
        )
    })?;
    let payload = serde_json::json!({
        "modelDir": model_dir,
        "modelType": settings.model_type,
        "inputPaths": input_paths,
        "batchSize": INFERENCE_BATCH_SIZE,
        "cpuThreads": CPU_INFERENCE_THREADS,
        "tagCount": tag_count,
    });
    let payload_file = TempPayloadFile::write(dirs, &payload)?;
    let output = Command::new(&python_path)
        .arg("-c")
        .arg(INFERENCE_SCRIPT)
        .arg("--payload-file")
        .arg(payload_file.path())
        .env("PYTHONIOENCODING", "utf-8")
        .output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        return Err(AppError::InvalidInput(if stderr.is_empty() {
            "WD14 推理执行失败".to_owned()
        } else {
            stderr
        }));
    }
    serde_json::from_str(&stdout)
        .map_err(|error| AppError::InvalidInput(format!("WD14 推理结果解析失败：{error}")))
}

fn run_python_inference_streaming<F>(
    dirs: &AppDirs,
    settings: &Wd14TaggerSettings,
    model_dir: &Path,
    input_paths: &[PathBuf],
    tag_count: usize,
    mut on_batch: F,
) -> AppResult<()>
where
    F: FnMut(InferenceBatchPayload) -> AppResult<()>,
{
    let python_path = python_env::resolve_configured_python_path(dirs)?.ok_or_else(|| {
        AppError::InvalidInput("Python runtime is not configured or available".to_owned())
    })?;
    let payload = serde_json::json!({
        "modelDir": model_dir,
        "modelType": settings.model_type,
        "inputPaths": input_paths,
        "batchSize": INFERENCE_BATCH_SIZE,
        "cpuThreads": CPU_INFERENCE_THREADS,
        "tagCount": tag_count,
        "stream": true,
    });
    let payload_file = TempPayloadFile::write(dirs, &payload)?;
    let mut child = Command::new(&python_path)
        .arg("-c")
        .arg(INFERENCE_SCRIPT)
        .arg("--payload-file")
        .arg(payload_file.path())
        .env("PYTHONIOENCODING", "utf-8")
        .env("OMP_NUM_THREADS", CPU_INFERENCE_THREADS.to_string())
        .env("MKL_NUM_THREADS", CPU_INFERENCE_THREADS.to_string())
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
        AppError::InvalidInput("WD14 inference process did not expose stdout".to_owned())
    })?;
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let batch = serde_json::from_str::<InferenceBatchPayload>(line).map_err(|error| {
            AppError::InvalidInput(format!(
                "WD14 streaming result parse failed: {error}; line={line}"
            ))
        })?;
        on_batch(batch)?;
    }

    let status = child.wait()?;
    let stderr = stderr_reader.join().unwrap_or_default().trim().to_owned();
    if !status.success() {
        return Err(AppError::InvalidInput(if stderr.is_empty() {
            "WD14 inference failed".to_owned()
        } else {
            stderr
        }));
    }

    Ok(())
}

fn load_tag_definitions(model_dir: &Path) -> AppResult<Vec<TagDefinition>> {
    let csv_path = model_dir.join("selected_tags.csv");
    if !csv_path.is_file() {
        return Err(AppError::InvalidInput(
            "WD14 model folder does not contain selected_tags.csv".to_owned(),
        ));
    }

    let content = fs::read_to_string(csv_path)?;
    let mut lines = content.lines();
    let header = lines
        .next()
        .map(parse_csv_line)
        .unwrap_or_default()
        .into_iter()
        .map(|field| normalize_csv_header(&field))
        .collect::<Vec<_>>();
    let layout = TagCsvLayout::from_header(&header);
    let mut tags = Vec::new();

    for line in lines.filter(|line| !line.trim().is_empty()) {
        let fields = parse_csv_line(line);
        let Some(tag) = layout.read_tag(&fields, tags.len())? else {
            continue;
        };
        tags.push(tag);
    }

    tags.sort_by_key(|tag| tag.index);
    if !has_contiguous_indexes(&tags) {
        if !layout.uses_explicit_model_index() {
            return Err(AppError::InvalidInput(
                "selected_tags.csv tag indexes must be contiguous from 0".to_owned(),
            ));
        }
        for (index, tag) in tags.iter_mut().enumerate() {
            tag.index = index;
        }
    }
    if tags.is_empty() {
        return Err(AppError::InvalidInput(
            "selected_tags.csv did not contain usable tag definitions".to_owned(),
        ));
    }
    Ok(tags)
}

fn has_contiguous_indexes(tags: &[TagDefinition]) -> bool {
    tags.iter()
        .enumerate()
        .all(|(expected, tag)| tag.index == expected)
}

fn normalize_csv_header(field: &str) -> String {
    field.trim().trim_start_matches('\u{feff}').to_ascii_lowercase()
}

struct TagCsvLayout {
    model_index_column: Option<usize>,
    name_column: usize,
    category_column: usize,
    intellectual_properties_column: Option<usize>,
}

impl TagCsvLayout {
    fn from_header(header: &[String]) -> Self {
        let is_classic_wd14 = header.get(0).is_some_and(|field| field == "tag_id")
            && header.get(1).is_some_and(|field| field == "name")
            && header.get(2).is_some_and(|field| field == "category");
        if is_classic_wd14 {
            return Self {
                model_index_column: None,
                name_column: 1,
                category_column: 2,
                intellectual_properties_column: None,
            };
        }

        Self {
            model_index_column: find_header_column(
                header,
                &["id", "index", "tag_index", "model_index", "output_index"],
            )
            .or(Some(0)),
            name_column: find_header_column(header, &["name", "tag", "tag_name"])
                .unwrap_or(if header.len() >= 3 { 2 } else { 1 }),
            category_column: find_header_column(header, &["category", "tag_category"])
                .unwrap_or(if header.len() >= 4 { 3 } else { 2 }),
            intellectual_properties_column: find_header_column(
                header,
                &[
                    "intellectual_properties",
                    "intellectual_property",
                    "copyrights",
                    "copyright_tags",
                    "ips",
                ],
            )
            .or(if header.len() >= 6 { Some(5) } else { None }),
        }
    }

    fn uses_explicit_model_index(&self) -> bool {
        self.model_index_column.is_some()
    }

    fn read_tag(
        &self,
        fields: &[String],
        ordinal_index: usize,
    ) -> AppResult<Option<TagDefinition>> {
        let required_column = self.name_column.max(self.category_column);
        if fields.len() <= required_column {
            return Ok(None);
        }

        let index = if let Some(column) = self.model_index_column {
            fields
                .get(column)
                .ok_or_else(|| {
                    AppError::InvalidInput("selected_tags.csv tag index column is missing".to_owned())
                })?
                .parse::<usize>()
                .map_err(|error| {
                    AppError::InvalidInput(format!(
                        "selected_tags.csv tag index parse failed: {error}"
                    ))
                })?
        } else {
            ordinal_index
        };
        let category = fields[self.category_column]
            .parse::<i32>()
            .map_err(|error| {
                AppError::InvalidInput(format!(
                    "selected_tags.csv tag category parse failed: {error}"
                ))
            })?;
        let intellectual_properties = self
            .intellectual_properties_column
            .and_then(|column| fields.get(column))
            .map(|raw| parse_ip_tags(raw))
            .unwrap_or_default();

        Ok(Some(TagDefinition {
            index,
            name: fields[self.name_column].clone(),
            category,
            intellectual_properties,
        }))
    }
}

fn find_header_column(header: &[String], names: &[&str]) -> Option<usize> {
    header
        .iter()
        .position(|field| names.iter().any(|name| field.eq_ignore_ascii_case(name)))
}

fn build_prompt(
    scores: &[f32],
    tags: &[TagDefinition],
    settings: &Wd14TaggerSettings,
) -> AppResult<String> {
    if scores.len() < tags.len() {
        return Err(AppError::InvalidInput(format!(
            "WD14 输出标签数量不足：{} / {}",
            scores.len(),
            tags.len()
        )));
    }

    let probabilities = if scores.iter().all(|value| (0.0..=1.0).contains(value)) {
        scores.to_vec()
    } else {
        scores
            .iter()
            .map(|value| 1.0 / (1.0 + (-value).exp()))
            .collect::<Vec<_>>()
    };

    let mut general = Vec::new();
    let mut character = Vec::new();
    let mut copyright = Vec::<(String, f32)>::new();

    for tag in tags {
        let score = probabilities[tag.index];
        if tag.category == 0 {
            if score >= settings.general_threshold as f32 && !tag.name.trim().is_empty() {
                general.push((format_tag(&tag.name, settings), score));
            }
        } else if tag.category == 4
            && score >= settings.character_threshold as f32
            && !tag.name.trim().is_empty()
        {
            character.push((format_tag(&tag.name, settings), score));
            for ip in &tag.intellectual_properties {
                upsert_max_score(&mut copyright, format_tag(ip, settings), score);
            }
        }
    }

    general.sort_by(|left, right| right.1.total_cmp(&left.1));
    character.sort_by(|left, right| right.1.total_cmp(&left.1));
    copyright.sort_by(|left, right| right.1.total_cmp(&left.1));

    let mut prompt_parts = Vec::new();
    if settings.add_character_tags {
        prompt_parts.extend(character.into_iter().map(|tag| tag.0));
    }
    if settings.add_copyright_tags {
        prompt_parts.extend(copyright.into_iter().map(|tag| tag.0));
    }
    prompt_parts.extend(general.into_iter().map(|tag| tag.0));

    let mut unique_parts = Vec::new();
    for part in prompt_parts {
        if !unique_parts
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&part))
        {
            unique_parts.push(part);
        }
    }

    if unique_parts.is_empty() {
        return Err(AppError::InvalidInput(
            "WD14 没有输出超过当前阈值的标签".to_owned(),
        ));
    }
    Ok(unique_parts.join(", "))
}

fn upsert_max_score(items: &mut Vec<(String, f32)>, name: String, score: f32) {
    if let Some((_, current_score)) = items
        .iter_mut()
        .find(|(existing, _)| existing.eq_ignore_ascii_case(&name))
    {
        *current_score = current_score.max(score);
        return;
    }
    items.push((name, score));
}

fn format_tag(raw: &str, settings: &Wd14TaggerSettings) -> String {
    if settings.replace_underscores_with_spaces {
        raw.replace('_', " ")
    } else {
        raw.to_owned()
    }
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(character) = chars.next() {
        if character == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                field.push('"');
                let _ = chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if character == ',' && !in_quotes {
            fields.push(field);
            field = String::new();
        } else {
            field.push(character);
        }
    }
    fields.push(field);
    fields
}

fn parse_ip_tags(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}
