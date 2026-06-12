use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::AppResult,
    openai_compatible::{self, OpenAiCompatibleSettings},
    proxy_settings::ProxySettings,
    request_scheduling::{default_request_mode, default_target_rpm, normalize_request_mode},
};

const SETTINGS_FILE: &str = "zhipu-settings.json";
const DEFAULT_BASE_URL: &str = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL: &str = "glm-4.5v";
const DEFAULT_AVAILABLE_MODELS: [&str; 6] = [
    "glm-4.5v",
    "glm-4.6v",
    "glm-4.6v-flash",
    "glm-4.7",
    "glm-4.7-flash",
    "glm-4.5-flash",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZhipuSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
    #[serde(default = "default_target_rpm")]
    pub target_rpm: u32,
    #[serde(default = "default_request_mode")]
    pub request_mode: String,
}

pub fn default_settings() -> ZhipuSettings {
    ZhipuSettings {
        api_key: String::new(),
        base_url: String::new(),
        model: DEFAULT_MODEL.to_owned(),
        available_models: DEFAULT_AVAILABLE_MODELS
            .iter()
            .map(|model| (*model).to_owned())
            .collect(),
        target_rpm: default_target_rpm(),
        request_mode: default_request_mode(),
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<ZhipuSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: ZhipuSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: ZhipuSettings) -> AppResult<ZhipuSettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(settings: &mut ZhipuSettings) {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.base_url = settings.base_url.trim().trim_end_matches('/').to_owned();
    settings.model = settings.model.trim().to_owned();
    normalize_request_mode(&mut settings.request_mode);
    if settings.base_url == DEFAULT_BASE_URL {
        settings.base_url.clear();
    }
    if settings.available_models.is_empty() {
        settings.available_models = default_settings().available_models;
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
    settings: &ZhipuSettings,
    proxy_settings: &ProxySettings,
) -> OpenAiCompatibleSettings {
    let base_url = if settings.base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_owned()
    } else {
        settings.base_url.clone()
    };
    OpenAiCompatibleSettings {
        label: "Zhipu/BigModel".to_owned(),
        base_url,
        api_key: settings.api_key.clone(),
        model: settings.model.clone(),
        use_proxy: proxy_settings.use_proxy,
        proxy_port: proxy_settings.proxy_port.clone(),
        disable_thinking: false,
    }
}

pub async fn fetch_models(
    settings: &ZhipuSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<Vec<String>> {
    openai_compatible::fetch_models(&request_settings(settings, proxy_settings)).await
}

pub async fn generate_text(
    settings: &ZhipuSettings,
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
    settings: &ZhipuSettings,
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
