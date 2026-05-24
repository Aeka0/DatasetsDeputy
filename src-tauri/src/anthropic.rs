use std::{fs, path::Path};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
    proxy_settings::{self, ProxySettings},
};

const SETTINGS_FILE: &str = "anthropic-settings.json";
const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const DEFAULT_MODEL: &str = "claude-sonnet-4-6";
const DEFAULT_AVAILABLE_MODELS: [&str; 3] = [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
];
const LEGACY_DEFAULT_AVAILABLE_MODELS: [&str; 1] = ["claude-sonnet-4-20250514"];
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnthropicSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
    #[serde(default)]
    pub rpm_limit: u32,
}

#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: Vec<ContentBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlock {
    Text { text: String },
    Image { source: ImageSource },
}

#[derive(Debug, Serialize)]
struct ImageSource {
    #[serde(rename = "type")]
    source_type: String,
    media_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    content: Option<Vec<ResponseContentBlock>>,
}

#[derive(Debug, Deserialize)]
struct ResponseContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: Option<String>,
}

pub fn default_settings() -> AnthropicSettings {
    AnthropicSettings {
        api_key: String::new(),
        base_url: String::new(),
        model: DEFAULT_MODEL.to_owned(),
        available_models: DEFAULT_AVAILABLE_MODELS
            .iter()
            .map(|model| (*model).to_owned())
            .collect(),
        rpm_limit: 0,
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<AnthropicSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: AnthropicSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_settings(
    dirs: &AppDirs,
    mut settings: AnthropicSettings,
) -> AppResult<AnthropicSettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(settings: &mut AnthropicSettings) {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.base_url = normalize_base_url(&settings.base_url);
    settings.model = settings.model.trim().to_owned();
    if settings.available_models.is_empty()
        || is_legacy_default_models(&settings.available_models)
    {
        settings.available_models = default_settings().available_models;
        if LEGACY_DEFAULT_AVAILABLE_MODELS.contains(&settings.model.as_str()) {
            settings.model = default_settings().model;
        }
    }
    if settings.model.is_empty() {
        settings.model = default_settings().model;
    }
    if !settings
        .available_models
        .iter()
        .any(|model| model == &settings.model)
    {
        settings.available_models.push(settings.model.clone());
    }
    dedup_models(&mut settings.available_models);
}

fn is_legacy_default_models(models: &[String]) -> bool {
    models.len() == LEGACY_DEFAULT_AVAILABLE_MODELS.len()
        && LEGACY_DEFAULT_AVAILABLE_MODELS
            .iter()
            .all(|legacy_model| models.iter().any(|model| model == legacy_model))
}

fn dedup_models(models: &mut Vec<String>) {
    let mut deduped = Vec::with_capacity(models.len());
    for model in models.drain(..) {
        if !deduped.contains(&model) {
            deduped.push(model);
        }
    }
    *models = deduped;
}

fn normalize_base_url(base_url: &str) -> String {
    let mut value = base_url.trim().trim_end_matches('/').to_owned();
    for suffix in ["/v1/messages", "/v1/models", "/v1"] {
        if value.ends_with(suffix) {
            let next_len = value.len() - suffix.len();
            value.truncate(next_len);
            break;
        }
    }
    if value == DEFAULT_BASE_URL {
        return String::new();
    }
    value
}

fn effective_base_url(base_url: &str) -> String {
    let value = normalize_base_url(base_url);
    if value.is_empty() {
        DEFAULT_BASE_URL.to_owned()
    } else {
        value
    }
}

fn endpoint(settings: &AnthropicSettings, path: &str) -> String {
    format!("{}/v1/{path}", effective_base_url(&settings.base_url))
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
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported image format: {}",
                path.display()
            )));
        }
    };

    Ok(mime.to_owned())
}

fn require_api_key(settings: &AnthropicSettings) -> AppResult<()> {
    if settings.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Anthropic API key is required".to_owned(),
        ));
    }
    Ok(())
}

async fn generate(
    settings: &AnthropicSettings,
    proxy_settings: &ProxySettings,
    content: Vec<ContentBlock>,
) -> AppResult<String> {
    require_api_key(settings)?;
    if content.is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let client = proxy_settings::http_client(proxy_settings, 120)?;
    let request = MessagesRequest {
        model: settings.model.trim().to_owned(),
        max_tokens: 1024,
        messages: vec![Message {
            role: "user".to_owned(),
            content,
        }],
    };
    let response = client
        .post(endpoint(settings, "messages"))
        .header("x-api-key", settings.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Anthropic request failed: {error}")))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        return Err(AppError::InvalidInput(if detail.is_empty() {
            format!("Anthropic request failed with status {status}")
        } else {
            format!("Anthropic request failed with status {status}: {detail}")
        }));
    }

    let payload: MessagesResponse = response.json().await.map_err(|error| {
        AppError::InvalidInput(format!("Anthropic response parse failed: {error}"))
    })?;
    let text = payload
        .content
        .unwrap_or_default()
        .into_iter()
        .filter(|block| block.block_type.as_deref() == Some("text"))
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "Anthropic response did not contain text".to_owned(),
        ));
    }
    Ok(text)
}

pub async fn fetch_models(
    settings: &AnthropicSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<Vec<String>> {
    require_api_key(settings)?;
    let client = proxy_settings::http_client(proxy_settings, 20)?;
    let response = client
        .get(endpoint(settings, "models"))
        .header("x-api-key", settings.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
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
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| entry.id)
        .filter(|model| !model.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn generate_text(
    settings: &AnthropicSettings,
    proxy_settings: &ProxySettings,
    prompt: &str,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }
    generate(
        settings,
        proxy_settings,
        vec![ContentBlock::Text {
            text: prompt.trim().to_owned(),
        }],
    )
    .await
}

pub async fn generate_annotation(
    settings: &AnthropicSettings,
    proxy_settings: &ProxySettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }
    let image_bytes = fs::read(image_path)?;
    generate(
        settings,
        proxy_settings,
        vec![
            ContentBlock::Image {
                source: ImageSource {
                    source_type: "base64".to_owned(),
                    media_type: mime_type_for_path(image_path)?,
                    data: general_purpose::STANDARD.encode(image_bytes),
                },
            },
            ContentBlock::Text {
                text: prompt.trim().to_owned(),
            },
        ],
    )
    .await
}
