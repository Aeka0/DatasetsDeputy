use std::{fs, path::Path, time::Duration};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

#[derive(Clone, Debug)]
pub struct OpenAiCompatibleSettings {
    pub label: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub use_proxy: bool,
    pub proxy_port: String,
    pub disable_thinking: bool,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelEntry>>,
    models: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: Option<String>,
    model: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    chat_template_kwargs: Option<ChatTemplateKwargs>,
}

#[derive(Debug, Serialize)]
struct ChatTemplateKwargs {
    enable_thinking: bool,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ChatContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChatContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: Option<ChatResponseMessage>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: Option<ChatResponseContent>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ChatResponseContent {
    Text(String),
    Parts(Vec<ChatResponsePart>),
}

#[derive(Debug, Deserialize)]
struct ChatResponsePart {
    text: Option<String>,
}

fn normalize_base_url(base_url: &str) -> String {
    let cleaned = base_url.trim().trim_end_matches('/').to_owned();
    let Some((_, rest)) = cleaned.split_once("://") else {
        return cleaned;
    };
    if rest.contains('/') {
        cleaned
    } else {
        format!("{cleaned}/v1")
    }
}

fn http_client(
    settings: &OpenAiCompatibleSettings,
    timeout_secs: u64,
) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(timeout_secs));
    if settings.use_proxy {
        let proxy_url = format!("http://127.0.0.1:{}", settings.proxy_port.trim());
        builder = builder.proxy(
            reqwest::Proxy::all(&proxy_url)
                .map_err(|error| AppError::InvalidInput(format!("Invalid proxy: {error}")))?,
        );
    }

    builder
        .build()
        .map_err(|error| AppError::InvalidInput(format!("HTTP client failed: {error}")))
}

fn mime_type_for_path(path: &Path) -> AppResult<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mime = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported image format: {}",
                path.display()
            )));
        }
    };

    Ok(mime.to_owned())
}

fn first_model_id(payload: ModelsResponse) -> Option<String> {
    payload
        .data
        .into_iter()
        .flatten()
        .chain(payload.models.into_iter().flatten())
        .find_map(|entry| entry.id.or(entry.model).or(entry.name))
        .filter(|model| !model.trim().is_empty())
}

async fn discover_model(
    client: &reqwest::Client,
    settings: &OpenAiCompatibleSettings,
) -> Option<String> {
    if !settings.model.trim().is_empty() {
        return Some(settings.model.trim().to_owned());
    }

    let mut builder = client.get(format!("{}/models", normalize_base_url(&settings.base_url)));
    if !settings.api_key.trim().is_empty() {
        builder = builder.bearer_auth(settings.api_key.trim());
    }
    let response = builder.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response
        .json::<ModelsResponse>()
        .await
        .ok()
        .and_then(first_model_id)
}

fn extract_content(payload: ChatResponse) -> String {
    payload
        .choices
        .unwrap_or_default()
        .into_iter()
        .flat_map(|choice| {
            let mut texts = Vec::new();
            if let Some(text) = choice.text {
                texts.push(text);
            }
            if let Some(message) = choice.message {
                match message.content {
                    Some(ChatResponseContent::Text(text)) => texts.push(text),
                    Some(ChatResponseContent::Parts(parts)) => texts.extend(
                        parts
                            .into_iter()
                            .filter_map(|part| part.text)
                            .collect::<Vec<_>>(),
                    ),
                    None => {}
                }
            }
            texts
        })
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned()
}

async fn generate_chat(
    settings: &OpenAiCompatibleSettings,
    client: &reqwest::Client,
    content: Vec<ChatContentPart>,
) -> AppResult<String> {
    let request = ChatRequest {
        model: discover_model(client, settings).await,
        messages: vec![ChatMessage {
            role: "user".to_owned(),
            content,
        }],
        temperature: 0.2,
        max_tokens: 1024,
        chat_template_kwargs: settings.disable_thinking.then_some(ChatTemplateKwargs {
            enable_thinking: false,
        }),
    };

    let mut builder = client
        .post(format!(
            "{}/chat/completions",
            normalize_base_url(&settings.base_url)
        ))
        .json(&request);
    if !settings.api_key.trim().is_empty() {
        builder = builder.bearer_auth(settings.api_key.trim());
    }
    let response = builder.send().await.map_err(|error| {
        AppError::InvalidInput(format!("{} request failed: {error}", settings.label))
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        return Err(AppError::InvalidInput(if detail.is_empty() {
            format!("{} request failed with status {status}", settings.label)
        } else {
            format!(
                "{} request failed with status {status}: {detail}",
                settings.label
            )
        }));
    }

    let payload: ChatResponse = response.json().await.map_err(|error| {
        AppError::InvalidInput(format!("{} response parse failed: {error}", settings.label))
    })?;
    let text = extract_content(payload);
    if text.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "{} response did not contain text",
            settings.label
        )));
    }

    Ok(text)
}

pub async fn generate_text_with_settings(
    settings: &OpenAiCompatibleSettings,
    prompt: &str,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = http_client(settings, 120)?;
    generate_chat(
        settings,
        &client,
        vec![ChatContentPart::Text {
            text: prompt.trim().to_owned(),
        }],
    )
    .await
}

pub async fn generate_annotation_with_settings(
    settings: &OpenAiCompatibleSettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = http_client(settings, 120)?;
    let image_bytes = fs::read(image_path)?;
    let mime_type = mime_type_for_path(image_path)?;
    let data_url = format!(
        "data:{mime_type};base64,{}",
        general_purpose::STANDARD.encode(image_bytes)
    );

    generate_chat(
        settings,
        &client,
        vec![
            ChatContentPart::Text {
                text: prompt.trim().to_owned(),
            },
            ChatContentPart::ImageUrl {
                image_url: ImageUrl { url: data_url },
            },
        ],
    )
    .await
}

pub async fn fetch_models(settings: &OpenAiCompatibleSettings) -> AppResult<Vec<String>> {
    if settings.base_url.trim().is_empty() {
        return Err(AppError::InvalidInput("Base URL is required".to_owned()));
    }

    let client = http_client(settings, 20)?;
    let mut builder = client.get(format!("{}/models", normalize_base_url(&settings.base_url)));
    if !settings.api_key.trim().is_empty() {
        builder = builder.bearer_auth(settings.api_key.trim());
    }
    let response = builder
        .send()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Model request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        return Err(AppError::InvalidInput(if detail.is_empty() {
            format!("Model request failed with status {status}")
        } else {
            format!("Model request failed with status {status}: {detail}")
        }));
    }

    let payload: ModelsResponse = response
        .json()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Model response parse failed: {error}")))?;
    let mut models = payload
        .data
        .into_iter()
        .flatten()
        .chain(payload.models.into_iter().flatten())
        .filter_map(|entry| entry.id.or(entry.model).or(entry.name))
        .filter(|model| !model.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    Ok(models)
}
