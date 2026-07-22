use std::{fs, path::Path};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
    google_api::{self, GoogleApiSource},
    proxy_settings::{self, ProxySettings},
    request_scheduling::{default_request_mode, default_target_rpm, normalize_request_mode},
};

const SETTINGS_FILE: &str = "gemini-settings.json";
const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL: &str = "gemini-flash-latest";
const DEFAULT_AVAILABLE_MODELS: [&str; 2] = ["gemini-flash-latest", "gemini-pro-latest"];
const LEGACY_DEFAULT_AVAILABLE_MODELS: [&str; 2] = ["gemini-1.5-pro-002", "gemini-1.5-flash-002"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSettings {
    pub api_key: String,
    #[serde(default = "default_google_api_source")]
    pub google_api_source: String,
    #[serde(default)]
    pub google_vertex_service_account_path: String,
    #[serde(default)]
    pub google_vertex_project_id: String,
    #[serde(default = "default_google_vertex_location")]
    pub google_vertex_location: String,
    #[serde(default)]
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
    #[serde(default = "default_target_rpm")]
    pub target_rpm: u32,
    #[serde(default = "default_request_mode")]
    pub request_mode: String,
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
        google_api_source: default_google_api_source(),
        google_vertex_service_account_path: String::new(),
        google_vertex_project_id: String::new(),
        google_vertex_location: default_google_vertex_location(),
        base_url: String::new(),
        model: DEFAULT_MODEL.to_owned(),
        available_models: DEFAULT_AVAILABLE_MODELS
            .iter()
            .map(|model| (*model).to_owned())
            .collect(),
        target_rpm: default_target_rpm(),
        request_mode: default_request_mode(),
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

fn default_google_api_source() -> String {
    google_api::SOURCE_AI_STUDIO.to_owned()
}

fn default_google_vertex_location() -> String {
    "global".to_owned()
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_owned()
}

fn normalize_base_url(base_url: &str) -> String {
    let mut value = base_url.trim().trim_end_matches('/').to_owned();
    if value.is_empty() {
        return String::new();
    }
    if value.ends_with("/models") {
        let next_len = value.len() - "/models".len();
        value.truncate(next_len);
    }
    if value == "https://generativelanguage.googleapis.com" || value == DEFAULT_BASE_URL {
        return String::new();
    }
    value
}

fn effective_base_url(base_url: &str) -> String {
    let value = normalize_base_url(base_url);
    if value.is_empty() {
        default_base_url()
    } else {
        value
    }
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
    normalize_google_settings(&mut settings);
    if settings.available_models.is_empty() {
        settings.available_models = default_settings().available_models;
    }
    settings.base_url = normalize_base_url(&settings.base_url);
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
    if settings.image_resize_mode.trim().is_empty() {
        settings.image_resize_mode = "none".to_owned();
    }
    if settings.image_convert_format.trim().is_empty() {
        settings.image_convert_format = "none".to_owned();
    }
    if settings.annotation_mode.trim().is_empty() {
        settings.annotation_mode = default_annotation_mode();
    }
    normalize_request_mode(&mut settings.request_mode);
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: GeminiSettings) -> AppResult<GeminiSettings> {
    settings.api_key = settings.api_key.trim().to_owned();
    normalize_google_settings(&mut settings);
    settings.base_url = normalize_base_url(&settings.base_url);
    settings.model = settings.model.trim().to_owned();
    settings.annotation_mode = settings.annotation_mode.trim().to_owned();
    normalize_request_mode(&mut settings.request_mode);
    if settings.model.is_empty() {
        settings.model = default_settings().model;
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

fn normalize_google_settings(settings: &mut GeminiSettings) {
    settings.google_api_source = google_api::normalize_source(&settings.google_api_source);
    settings.google_vertex_service_account_path = settings
        .google_vertex_service_account_path
        .trim()
        .to_owned();
    settings.google_vertex_project_id = settings.google_vertex_project_id.trim().to_owned();
    settings.google_vertex_location =
        google_api::normalize_vertex_location(&settings.google_vertex_location);
}

pub async fn fetch_models(
    settings: &GeminiSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<Vec<String>> {
    if GoogleApiSource::from_settings(&settings.google_api_source) == GoogleApiSource::VertexAi {
        return Err(AppError::InvalidInput(
            "Vertex AI does not provide the AI Studio model discovery endpoint".to_owned(),
        ));
    }
    if settings.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Gemini API key is required".to_owned(),
        ));
    }

    let client = proxy_settings::http_client(proxy_settings, 20)?;
    let base_url = effective_base_url(&settings.base_url);
    let response = client
        .get(format!("{}/models", base_url))
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

async fn generate_content(
    dirs: &AppDirs,
    settings: &GeminiSettings,
    proxy_settings: &ProxySettings,
    request: GenerateContentRequest,
) -> AppResult<String> {
    let client = proxy_settings::http_client(proxy_settings, 120)?;
    let source = GoogleApiSource::from_settings(&settings.google_api_source);
    let request_builder = if source == GoogleApiSource::VertexAi {
        let credentials = google_api::load_vertex_credentials(
            dirs,
            &settings.google_vertex_service_account_path,
        )?;
        let project_id = if settings.google_vertex_project_id.trim().is_empty() {
            credentials.project_id.trim()
        } else {
            settings.google_vertex_project_id.trim()
        };
        let model_path = google_api::vertex_model_path(
            &settings.model,
            project_id,
            &settings.google_vertex_location,
        )?;
        let auth = google_api::authorize_vertex(&client, &credentials).await?;
        google_api::apply_vertex_auth(
            client.post(format!(
                "{}/{model_path}:generateContent",
                google_api::vertex_endpoint_base()
            )),
            &auth,
        )
    } else {
        let endpoint = format!(
            "{}/models/{}:generateContent",
            effective_base_url(&settings.base_url),
            settings.model.trim()
        );
        client
            .post(endpoint)
            .query(&[("key", settings.api_key.trim())])
    };
    let response = request_builder
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

pub async fn generate_text(
    dirs: &AppDirs,
    settings: &GeminiSettings,
    proxy_settings: &ProxySettings,
    prompt: &str,
) -> AppResult<String> {
    validate_auth_settings(settings)?;
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Annotation prompt is empty".to_owned(),
        ));
    }

    let request = GenerateContentRequest {
        contents: vec![GenerateContentMessage {
            parts: vec![GenerateContentPart::Text(prompt.trim().to_owned())],
        }],
    };

    generate_content(dirs, settings, proxy_settings, request).await
}

pub async fn generate_annotation(
    dirs: &AppDirs,
    settings: &GeminiSettings,
    proxy_settings: &ProxySettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    validate_auth_settings(settings)?;
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

    generate_content(dirs, settings, proxy_settings, request).await
}

fn validate_auth_settings(settings: &GeminiSettings) -> AppResult<()> {
    if GoogleApiSource::from_settings(&settings.google_api_source) == GoogleApiSource::VertexAi {
        if settings
            .google_vertex_service_account_path
            .trim()
            .is_empty()
        {
            return Err(AppError::InvalidInput(
                "Vertex AI service account JSON is required".to_owned(),
            ));
        }
    } else if settings.api_key.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Gemini API key is required".to_owned(),
        ));
    }
    Ok(())
}

pub async fn test_connection(
    dirs: &AppDirs,
    settings: &GeminiSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<usize> {
    if GoogleApiSource::from_settings(&settings.google_api_source) == GoogleApiSource::AiStudio {
        return Ok(fetch_models(settings, proxy_settings).await?.len());
    }

    validate_auth_settings(settings)?;
    let client = proxy_settings::http_client(proxy_settings, 20)?;
    let credentials =
        google_api::load_vertex_credentials(dirs, &settings.google_vertex_service_account_path)?;
    let project_id = if settings.google_vertex_project_id.trim().is_empty() {
        credentials.project_id.trim()
    } else {
        settings.google_vertex_project_id.trim()
    };
    let model_path = google_api::vertex_model_path(
        &settings.model,
        project_id,
        &settings.google_vertex_location,
    )?;
    let auth = google_api::authorize_vertex(&client, &credentials).await?;
    let response = google_api::apply_vertex_auth(
        client
            .post(format!(
                "{}/{model_path}:countTokens",
                google_api::vertex_endpoint_base()
            ))
            .json(&serde_json::json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": "ping" }]
                }]
            })),
        &auth,
    )
    .send()
    .await
    .map_err(|error| {
        AppError::InvalidInput(format!("Vertex AI connection request failed: {error}"))
    })?;
    if !response.status().is_success() {
        return Err(AppError::InvalidInput(format!(
            "Vertex AI connection request failed with status {}",
            response.status()
        )));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| {
            AppError::InvalidInput(format!("Vertex AI response parse failed: {error}"))
        })?;
    Ok(payload
        .get("totalTokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_settings_receive_google_source_defaults() {
        let mut value = serde_json::to_value(default_settings()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("googleApiSource");
        object.remove("googleVertexServiceAccountPath");
        object.remove("googleVertexProjectId");
        object.remove("googleVertexLocation");

        let settings = serde_json::from_value::<GeminiSettings>(value).unwrap();
        assert_eq!(settings.google_api_source, google_api::SOURCE_AI_STUDIO);
        assert_eq!(settings.google_vertex_location, "global");
        assert!(settings.google_vertex_service_account_path.is_empty());
    }

    #[test]
    fn validates_credentials_for_selected_google_source() {
        let mut settings = default_settings();
        assert!(validate_auth_settings(&settings).is_err());

        settings.api_key = "ai-studio-key".to_owned();
        assert!(validate_auth_settings(&settings).is_ok());

        settings.google_api_source = google_api::SOURCE_VERTEX_AI.to_owned();
        assert!(validate_auth_settings(&settings).is_err());

        settings.google_vertex_service_account_path = "config/api/service-account.json".to_owned();
        assert!(validate_auth_settings(&settings).is_ok());
    }
}
