use std::{fs, path::Path, time::Duration};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

#[derive(Clone, Copy)]
pub struct OpenAiCompatibleBackend {
    pub label: &'static str,
    pub base_url: &'static str,
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

fn http_client(timeout_secs: u64) -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
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
    backend: OpenAiCompatibleBackend,
) -> Option<String> {
    let response = client
        .get(format!("{}/v1/models", backend.base_url))
        .send()
        .await
        .ok()?;
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
    backend: OpenAiCompatibleBackend,
    client: &reqwest::Client,
    content: Vec<ChatContentPart>,
) -> AppResult<String> {
    let request = ChatRequest {
        model: discover_model(client, backend).await,
        messages: vec![ChatMessage {
            role: "user".to_owned(),
            content,
        }],
        temperature: 0.2,
        max_tokens: 1024,
        chat_template_kwargs: backend.disable_thinking.then_some(ChatTemplateKwargs {
            enable_thinking: false,
        }),
    };

    let response = client
        .post(format!("{}/v1/chat/completions", backend.base_url))
        .json(&request)
        .send()
        .await
        .map_err(|error| {
            AppError::InvalidInput(format!("{} request failed: {error}", backend.label))
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        return Err(AppError::InvalidInput(if detail.is_empty() {
            format!("{} request failed with status {status}", backend.label)
        } else {
            format!(
                "{} request failed with status {status}: {detail}",
                backend.label
            )
        }));
    }

    let payload: ChatResponse = response.json().await.map_err(|error| {
        AppError::InvalidInput(format!("{} response parse failed: {error}", backend.label))
    })?;
    let text = extract_content(payload);
    if text.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "{} response did not contain text",
            backend.label
        )));
    }

    Ok(text)
}

pub async fn generate_text(backend: OpenAiCompatibleBackend, prompt: &str) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = http_client(120)?;
    generate_chat(
        backend,
        &client,
        vec![ChatContentPart::Text {
            text: prompt.trim().to_owned(),
        }],
    )
    .await
}

pub async fn generate_annotation(
    backend: OpenAiCompatibleBackend,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = http_client(120)?;
    let image_bytes = fs::read(image_path)?;
    let mime_type = mime_type_for_path(image_path)?;
    let data_url = format!(
        "data:{mime_type};base64,{}",
        general_purpose::STANDARD.encode(image_bytes)
    );

    generate_chat(
        backend,
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
