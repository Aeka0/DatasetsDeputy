use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
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

payload = json.loads(sys.argv[1])
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

def load_image_batch(paths):
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

        image = image.resize((448, 448), Image.Resampling.BICUBIC)
        array = np.asarray(image, dtype=np.float32) / 255.0
        array = (array - 0.5) / 0.5
        batch.append(np.transpose(array, (2, 0, 1)))
    return np.stack(batch, axis=0).astype(np.float32, copy=False)

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
    all_scores = []
    provider = session.get_providers()[0]
    for start in range(0, len(input_paths), batch_size):
        chunk_paths = input_paths[start:start + batch_size]
        input_nchw = load_image_batch(chunk_paths)
        model_input = input_nchw
        if len(shape) == 4 and shape[-1] == 3:
            model_input = np.transpose(input_nchw, (0, 2, 3, 1))
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
    let output = Command::new(&python_path)
        .arg("-c")
        .arg(INFERENCE_SCRIPT)
        .arg(payload.to_string())
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
        AppError::InvalidInput(
            "Python runtime is not configured or available".to_owned(),
        )
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
    let mut child = Command::new(&python_path)
        .arg("-c")
        .arg(INFERENCE_SCRIPT)
        .arg(payload.to_string())
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
            "WD14 模型文件夹中未找到 selected_tags.csv".to_owned(),
        ));
    }

    let content = fs::read_to_string(csv_path)?;
    let mut tags = Vec::new();
    for line in content
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
    {
        let fields = parse_csv_line(line);
        if fields.len() < 6 {
            continue;
        }
        let index = fields[0].parse::<usize>().map_err(|error| {
            AppError::InvalidInput(format!("selected_tags.csv 标签索引解析失败：{error}"))
        })?;
        let category = fields[3].parse::<i32>().map_err(|error| {
            AppError::InvalidInput(format!("selected_tags.csv 标签分类解析失败：{error}"))
        })?;
        tags.push(TagDefinition {
            index,
            name: fields[2].clone(),
            category,
            intellectual_properties: parse_ip_tags(&fields[5]),
        });
    }

    tags.sort_by_key(|tag| tag.index);
    for (expected, tag) in tags.iter().enumerate() {
        if tag.index != expected {
            return Err(AppError::InvalidInput(
                "selected_tags.csv 标签索引必须从 0 连续排列".to_owned(),
            ));
        }
    }
    if tags.is_empty() {
        return Err(AppError::InvalidInput(
            "selected_tags.csv 中没有可用标签".to_owned(),
        ));
    }
    Ok(tags)
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
            if score >= settings.general_threshold as f32 {
                general.push((format_tag(&tag.name, settings), score));
            }
        } else if tag.category == 4 && score >= settings.character_threshold as f32 {
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
