use std::{fs, path::Path, time::Duration};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

const SETTINGS_FILE: &str = "gemini-settings.json";
const DEFAULT_MODEL: &str = "gemini-flash-latest";
const DEFAULT_AVAILABLE_MODELS: [&str; 2] = ["gemini-flash-latest", "gemini-pro-latest"];
const LEGACY_DEFAULT_AVAILABLE_MODELS: [&str; 2] = ["gemini-1.5-pro-002", "gemini-1.5-flash-002"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSettings {
    pub api_key: String,
    pub model: String,
    pub available_models: Vec<String>,
    pub rpm_limit: u32,
    pub use_proxy: bool,
    pub proxy_port: String,
    pub image_resize_mode: String,
    pub image_convert_format: String,
    #[serde(default = "default_annotation_mode")]
    pub annotation_mode: String,
    #[serde(default)]
    pub atmosphere: bool,
    #[serde(default)]
    pub quality: bool,
    #[serde(default)]
    pub lens_info: bool,
    #[serde(default)]
    pub ignore_text: bool,
    #[serde(default)]
    pub facial_features: bool,
    #[serde(default)]
    pub jpeg_compression: bool,
    #[serde(default)]
    pub adversarial_noise: bool,
    #[serde(default)]
    pub ai_generated: bool,
    #[serde(default)]
    pub additional_prompt_content: String,
}

#[derive(Debug, Deserialize)]
struct GeminiModelsResponse {
    models: Option<Vec<GeminiModel>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModel {
    name: String,
    supported_generation_methods: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentRequest {
    contents: Vec<GenerateContentMessage>,
}

#[derive(Debug, Serialize)]
struct GenerateContentMessage {
    parts: Vec<GenerateContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum GenerateContentPart {
    Text(String),
    InlineData(InlineData),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    candidates: Option<Vec<GenerateContentCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GenerateContentCandidate {
    content: Option<GenerateContentResponseContent>,
}

#[derive(Debug, Deserialize)]
struct GenerateContentResponseContent {
    parts: Option<Vec<GenerateContentResponsePart>>,
}

#[derive(Debug, Deserialize)]
struct GenerateContentResponsePart {
    text: Option<String>,
}

pub fn default_settings() -> GeminiSettings {
    GeminiSettings {
        api_key: String::new(),
        model: DEFAULT_MODEL.to_owned(),
        available_models: DEFAULT_AVAILABLE_MODELS
            .iter()
            .map(|model| (*model).to_owned())
            .collect(),
        rpm_limit: 0,
        use_proxy: false,
        proxy_port: "7890".to_owned(),
        image_resize_mode: "none".to_owned(),
        image_convert_format: "none".to_owned(),
        annotation_mode: default_annotation_mode(),
        atmosphere: false,
        quality: false,
        lens_info: false,
        ignore_text: false,
        facial_features: false,
        jpeg_compression: false,
        adversarial_noise: false,
        ai_generated: false,
        additional_prompt_content: String::new(),
    }
}

fn default_annotation_mode() -> String {
    "exact".to_owned()
}

fn is_legacy_default_models(models: &[String]) -> bool {
    models.len() == LEGACY_DEFAULT_AVAILABLE_MODELS.len()
        && LEGACY_DEFAULT_AVAILABLE_MODELS
            .iter()
            .all(|legacy_model| models.iter().any(|model| model == legacy_model))
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<GeminiSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: GeminiSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    if settings.available_models.is_empty() {
        settings.available_models = default_settings().available_models;
    }
    if is_legacy_default_models(&settings.available_models) {
        settings.available_models = default_settings().available_models;
        if matches!(
            settings.model.as_str(),
            "gemini-1.5-pro-002" | "gemini-1.5-flash-002"
        ) {
            settings.model = default_settings().model;
        }
    }
    if settings.model.trim().is_empty() {
        settings.model = default_settings().model;
    }
    if settings.proxy_port.trim().is_empty() {
        settings.proxy_port = default_settings().proxy_port;
    }
    if settings.image_resize_mode.trim().is_empty() {
        settings.image_resize_mode = "none".to_owned();
    }
    if settings.image_convert_format.trim().is_empty() {
        settings.image_convert_format = "none".to_owned();
    }
    if settings.annotation_mode.trim().is_empty() {
        settings.annotation_mode = default_annotation_mode();
    }
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: GeminiSettings) -> AppResult<GeminiSettings> {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.model = settings.model.trim().to_owned();
    settings.proxy_port = settings.proxy_port.trim().to_owned();
    settings.annotation_mode = settings.annotation_mode.trim().to_owned();
    if settings.model.is_empty() {
        settings.model = default_settings().model;
    }
    if settings.proxy_port.is_empty() {
        settings.proxy_port = default_settings().proxy_port;
    }
    if !matches!(
        settings.annotation_mode.as_str(),
        "exact" | "short" | "tag" | "empty"
    ) {
        settings.annotation_mode = default_annotation_mode();
    }
    if !settings
        .available_models
        .iter()
        .any(|model| model == &settings.model)
    {
        settings.available_models.push(settings.model.clone());
    }
    settings.available_models.sort();
    settings.available_models.dedup();

    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn http_client(settings: &GeminiSettings, timeout_secs: u64) -> AppResult<reqwest::Client> {
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

pub async fn fetch_models(settings: &GeminiSettings) -> AppResult<Vec<String>> {
    if settings.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Gemini API key is required".to_owned(),
        ));
    }

    let client = http_client(settings, 20)?;
    let response = client
        .get("https://generativelanguage.googleapis.com/v1beta/models")
        .query(&[("key", settings.api_key.trim())])
        .send()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Model request failed: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::InvalidInput(format!(
            "Model request failed with status {}",
            response.status()
        )));
    }

    let payload: GeminiModelsResponse = response
        .json()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Model response parse failed: {error}")))?;

    let mut models = payload
        .models
        .unwrap_or_default()
        .into_iter()
        .filter(|model| {
            model
                .supported_generation_methods
                .as_deref()
                .unwrap_or_default()
                .iter()
                .any(|method| method == "generateContent")
                && {
                    let lower = model.name.to_ascii_lowercase();
                    lower.contains("gemini") || lower.contains("vision")
                }
        })
        .map(|model| {
            model
                .name
                .split('/')
                .next_back()
                .unwrap_or(model.name.as_str())
                .to_owned()
        })
        .collect::<Vec<_>>();

    models.sort();
    models.dedup();
    Ok(models)
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

pub async fn generate_annotation(
    settings: &GeminiSettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    if settings.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Gemini API key is required".to_owned(),
        ));
    }
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let image_bytes = fs::read(image_path)?;
    let request = GenerateContentRequest {
        contents: vec![GenerateContentMessage {
            parts: vec![
                GenerateContentPart::Text(prompt.trim().to_owned()),
                GenerateContentPart::InlineData(InlineData {
                    mime_type: mime_type_for_path(image_path)?,
                    data: general_purpose::STANDARD.encode(image_bytes),
                }),
            ],
        }],
    };

    let client = http_client(settings, 120)?;
    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        settings.model.trim()
    );
    let response = client
        .post(endpoint)
        .query(&[("key", settings.api_key.trim())])
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::InvalidInput(format!("Annotation request failed: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::InvalidInput(format!(
            "Annotation request failed with status {}",
            response.status()
        )));
    }

    let payload: GenerateContentResponse = response.json().await.map_err(|error| {
        AppError::InvalidInput(format!("Annotation response parse failed: {error}"))
    })?;
    let text = payload
        .candidates
        .unwrap_or_default()
        .into_iter()
        .filter_map(|candidate| candidate.content)
        .flat_map(|content| content.parts.unwrap_or_default())
        .filter_map(|part| part.text)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned();

    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation response did not contain text".to_owned(),
        ));
    }

    Ok(text)
}
