use std::{fs, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

const SETTINGS_FILE: &str = "gemini-settings.json";

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

pub fn default_settings() -> GeminiSettings {
    GeminiSettings {
        api_key: String::new(),
        model: "gemini-1.5-pro-002".to_owned(),
        available_models: vec![
            "gemini-1.5-pro-002".to_owned(),
            "gemini-1.5-flash-002".to_owned(),
        ],
        rpm_limit: 0,
        use_proxy: false,
        proxy_port: "7890".to_owned(),
        image_resize_mode: "none".to_owned(),
        image_convert_format: "none".to_owned(),
    }
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
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: GeminiSettings) -> AppResult<GeminiSettings> {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.model = settings.model.trim().to_owned();
    settings.proxy_port = settings.proxy_port.trim().to_owned();
    if settings.model.is_empty() {
        settings.model = default_settings().model;
    }
    if settings.proxy_port.is_empty() {
        settings.proxy_port = default_settings().proxy_port;
    }
    if !settings.available_models.iter().any(|model| model == &settings.model) {
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
        return Err(AppError::InvalidInput("Gemini API key is required".to_owned()));
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
