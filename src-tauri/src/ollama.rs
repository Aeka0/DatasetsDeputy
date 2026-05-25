use std::{fs, path::Path, time::Duration};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::{
    errors::{AppError, AppResult},
    llm_loader_settings::{self, LlmLoaderSettings},
};

const DEFAULT_MODEL: &str = "gemma3";

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    name: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    think: bool,
    options: ChatOptions,
}

#[derive(Debug, Serialize)]
struct ChatOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    images: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: Option<ChatResponseMessage>,
    response: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: Option<String>,
}

fn http_client(timeout_secs: u64) -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| AppError::InvalidInput(format!("HTTP client failed: {error}")))
}

fn mime_type_for_path(path: &Path) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" => Ok(()),
        _ => Err(AppError::InvalidInput(format!(
            "Unsupported image format: {}",
            path.display()
        ))),
    }
}

fn first_model_id(payload: TagsResponse) -> Option<String> {
    payload
        .models
        .into_iter()
        .flatten()
        .find_map(|entry| entry.model.or(entry.name))
        .filter(|model| !model.trim().is_empty())
}

async fn discover_model(client: &reqwest::Client, base_url: &str) -> Option<String> {
    let response = client
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response
        .json::<TagsResponse>()
        .await
        .ok()
        .and_then(first_model_id)
}

pub async fn generate_annotation(
    settings: &LlmLoaderSettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    generate(settings, prompt, Some(image_path)).await
}

pub async fn generate_text(settings: &LlmLoaderSettings, prompt: &str) -> AppResult<String> {
    generate(settings, prompt, None).await
}

async fn generate(
    settings: &LlmLoaderSettings,
    prompt: &str,
    image_path: Option<&Path>,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = http_client(120)?;
    let base_url = llm_loader_settings::ollama_base_url(settings);
    let images = match image_path {
        Some(image_path) => {
            mime_type_for_path(image_path)?;
            vec![general_purpose::STANDARD.encode(fs::read(image_path)?)]
        }
        None => Vec::new(),
    };
    let request = ChatRequest {
        model: discover_model(&client, &base_url)
            .await
            .unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
        messages: vec![ChatMessage {
            role: "user".to_owned(),
            content: prompt.trim().to_owned(),
            images,
        }],
        stream: false,
        think: false,
        options: ChatOptions {
            temperature: 0.2,
            num_predict: 1024,
        },
    };

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Ollama request failed: {error}")))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        return Err(AppError::InvalidInput(if detail.is_empty() {
            format!("Ollama request failed with status {status}")
        } else {
            format!("Ollama request failed with status {status}: {detail}")
        }));
    }

    let payload: ChatResponse = response.json().await.map_err(|error| {
        AppError::InvalidInput(format!("Ollama response parse failed: {error}"))
    })?;
    let text = payload
        .message
        .and_then(|message| message.content)
        .or(payload.response)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "Ollama response did not contain text".to_owned(),
        ));
    }

    Ok(text)
}
