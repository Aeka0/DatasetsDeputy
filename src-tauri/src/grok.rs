use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::AppResult,
    openai_compatible::{self, OpenAiCompatibleSettings},
    proxy_settings::ProxySettings,
};

const SETTINGS_FILE: &str = "grok-settings.json";
const DEFAULT_BASE_URL: &str = "https://api.x.ai/v1";
const DEFAULT_MODEL: &str = "grok-4.3";
const DEFAULT_AVAILABLE_MODELS: [&str; 10] = [
    "grok-4.3",
    "grok-4.3-latest",
    "grok-4.20",
    "grok-4.20-reasoning",
    "grok-4.20-reasoning-latest",
    "grok-4.20-0309",
    "grok-4.20-0309-reasoning",
    "grok-4.20-non-reasoning",
    "grok-4.20-non-reasoning-latest",
    "grok-4.20-0309-non-reasoning",
];
const LEGACY_DEFAULT_AVAILABLE_MODELS: [&str; 1] = ["grok-4"];
const PREVIOUS_DEFAULT_EXTRA_MODEL_COUNT: usize = 3;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
    #[serde(default)]
    pub rpm_limit: u32,
}

pub fn default_settings() -> GrokSettings {
    GrokSettings {
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

pub fn load_settings(dirs: &AppDirs) -> AppResult<GrokSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: GrokSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: GrokSettings) -> AppResult<GrokSettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(settings: &mut GrokSettings) {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.base_url = settings.base_url.trim().trim_end_matches('/').to_owned();
    settings.model = settings.model.trim().to_owned();
    if settings.base_url == DEFAULT_BASE_URL {
        settings.base_url.clear();
    }
    if settings.available_models.is_empty()
        || is_legacy_default_models(&settings.available_models)
        || is_previous_default_models(&settings.available_models)
    {
        settings.available_models = default_settings().available_models;
        if !settings
            .available_models
            .iter()
            .any(|model| model == &settings.model)
            || LEGACY_DEFAULT_AVAILABLE_MODELS.contains(&settings.model.as_str())
        {
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

fn is_previous_default_models(models: &[String]) -> bool {
    models.len() == DEFAULT_AVAILABLE_MODELS.len() + PREVIOUS_DEFAULT_EXTRA_MODEL_COUNT
        && DEFAULT_AVAILABLE_MODELS
            .iter()
            .all(|previous_model| models.iter().any(|model| model == previous_model))
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

fn request_settings(
    settings: &GrokSettings,
    proxy_settings: &ProxySettings,
) -> OpenAiCompatibleSettings {
    let base_url = if settings.base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_owned()
    } else {
        settings.base_url.clone()
    };
    OpenAiCompatibleSettings {
        label: "Grok/xAI".to_owned(),
        base_url,
        api_key: settings.api_key.clone(),
        model: settings.model.clone(),
        use_proxy: proxy_settings.use_proxy,
        proxy_port: proxy_settings.proxy_port.clone(),
        disable_thinking: false,
    }
}

pub async fn fetch_models(
    settings: &GrokSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<Vec<String>> {
    openai_compatible::fetch_models(&request_settings(settings, proxy_settings)).await
}

pub async fn generate_text(
    settings: &GrokSettings,
    proxy_settings: &ProxySettings,
    prompt: &str,
) -> AppResult<String> {
    openai_compatible::generate_text_with_settings(
        &request_settings(settings, proxy_settings),
        prompt,
    )
    .await
}

pub async fn generate_annotation(
    settings: &GrokSettings,
    proxy_settings: &ProxySettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    openai_compatible::generate_annotation_with_settings(
        &request_settings(settings, proxy_settings),
        image_path,
        prompt,
    )
    .await
}
