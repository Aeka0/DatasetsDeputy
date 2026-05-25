use std::fs;

use serde::{Deserialize, Serialize};

use crate::{app_dirs::AppDirs, errors::AppResult};

const SETTINGS_FILE: &str = "llm-loader-settings.json";

pub const LM_STUDIO_DEFAULT_PORT: &str = "1234";
pub const TEXTGEN_DEFAULT_PORT: &str = "5005";
pub const OLLAMA_DEFAULT_PORT: &str = "11434";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmLoaderEndpointSettings {
    #[serde(default)]
    pub base_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmLoaderSettings {
    #[serde(default)]
    pub lm_studio: LlmLoaderEndpointSettings,
    #[serde(default)]
    pub textgen: LlmLoaderEndpointSettings,
    #[serde(default)]
    pub ollama: LlmLoaderEndpointSettings,
}

impl Default for LlmLoaderSettings {
    fn default() -> Self {
        Self {
            lm_studio: LlmLoaderEndpointSettings::default(),
            textgen: LlmLoaderEndpointSettings::default(),
            ollama: LlmLoaderEndpointSettings::default(),
        }
    }
}

pub fn default_settings() -> LlmLoaderSettings {
    LlmLoaderSettings::default()
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<LlmLoaderSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: LlmLoaderSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_settings(
    dirs: &AppDirs,
    mut settings: LlmLoaderSettings,
) -> AppResult<LlmLoaderSettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

pub fn lm_studio_base_url(settings: &LlmLoaderSettings) -> String {
    resolved_base_url(&settings.lm_studio, LM_STUDIO_DEFAULT_PORT)
}

pub fn textgen_base_url(settings: &LlmLoaderSettings) -> String {
    resolved_base_url(&settings.textgen, TEXTGEN_DEFAULT_PORT)
}

pub fn ollama_base_url(settings: &LlmLoaderSettings) -> String {
    resolved_base_url(&settings.ollama, OLLAMA_DEFAULT_PORT)
}

fn normalize_settings(settings: &mut LlmLoaderSettings) {
    normalize_endpoint(&mut settings.lm_studio, LM_STUDIO_DEFAULT_PORT);
    normalize_endpoint(&mut settings.textgen, TEXTGEN_DEFAULT_PORT);
    normalize_endpoint(&mut settings.ollama, OLLAMA_DEFAULT_PORT);
}

fn normalize_endpoint(settings: &mut LlmLoaderEndpointSettings, default_port: &str) {
    settings.base_url = settings.base_url.trim().trim_end_matches('/').to_owned();

    if !settings.base_url.is_empty() && !settings.base_url.contains("://") {
        settings.base_url = format!("http://{}", settings.base_url);
    }

    let default_url = localhost_base_url(default_port);
    if settings.base_url == default_url {
        settings.base_url.clear();
    }
}

fn resolved_base_url(settings: &LlmLoaderEndpointSettings, default_port: &str) -> String {
    let base_url = settings.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return localhost_base_url(default_port);
    }
    base_url.to_owned()
}

fn localhost_base_url(port: &str) -> String {
    format!("http://127.0.0.1:{port}")
}
