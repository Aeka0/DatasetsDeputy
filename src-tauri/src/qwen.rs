use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::AppResult,
    openai_compatible::{self, OpenAiCompatibleSettings, ThinkingControl},
    proxy_settings::ProxySettings,
    request_scheduling::{default_request_mode, default_target_rpm, normalize_request_mode},
};

const SETTINGS_FILE: &str = "qwen-settings.json";
const DEFAULT_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL: &str = "qwen3-vl-flash";
const DEFAULT_AVAILABLE_MODELS: [&str; 6] = [
    "qwen3-vl-flash",
    "qwen3-vl-plus",
    "qwen-vl-plus",
    "qwen-vl-plus-latest",
    "qwen-vl-max",
    "qwen-vl-max-latest",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QwenSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
    #[serde(default = "default_target_rpm")]
    pub target_rpm: u32,
    #[serde(default = "default_request_mode")]
    pub request_mode: String,
}

pub fn default_settings() -> QwenSettings {
    QwenSettings {
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

pub fn load_settings(dirs: &AppDirs) -> AppResult<QwenSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings());
    }

    let mut settings: QwenSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_settings(dirs: &AppDirs, mut settings: QwenSettings) -> AppResult<QwenSettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(settings: &mut QwenSettings) {
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

fn is_model_or_snapshot(model: &str, family: &str) -> bool {
    model == family
        || model
            .strip_prefix(family)
            .is_some_and(|suffix| suffix.starts_with('-'))
}

fn thinking_control_for_model(model: &str) -> ThinkingControl {
    let model = model.trim().to_ascii_lowercase();
    let known_hybrid_families = [
        "qwen3.7-plus",
        "qwen3.6",
        "qwen3.5",
        "qwen3-vl-plus",
        "qwen3-vl-flash",
        "qwen3-max",
        "qwen-plus",
        "qwen-flash",
        "qwen-turbo",
    ];
    let known_hybrid_models = [
        "qwen3.7-max",
        "qwen3.7-max-2026-05-20",
        "qwen3.7-max-2026-06-08",
        "qwen3-235b-a22b",
        "qwen3-32b",
        "qwen3-30b-a3b",
        "qwen3-14b",
        "qwen3-8b",
    ];

    if known_hybrid_families
        .iter()
        .any(|family| is_model_or_snapshot(&model, family))
        || known_hybrid_models.contains(&model.as_str())
    {
        ThinkingControl::DisableTopLevel
    } else {
        ThinkingControl::Unspecified
    }
}

fn request_settings(
    settings: &QwenSettings,
    proxy_settings: &ProxySettings,
) -> OpenAiCompatibleSettings {
    let base_url = if settings.base_url.trim().is_empty() {
        DEFAULT_BASE_URL.to_owned()
    } else {
        settings.base_url.clone()
    };
    OpenAiCompatibleSettings {
        label: "Qwen/DashScope".to_owned(),
        base_url,
        api_key: settings.api_key.clone(),
        model: settings.model.clone(),
        use_proxy: proxy_settings.use_proxy,
        proxy_port: proxy_settings.proxy_port.clone(),
        thinking_control: thinking_control_for_model(&settings.model),
    }
}

pub async fn fetch_models(
    settings: &QwenSettings,
    proxy_settings: &ProxySettings,
) -> AppResult<Vec<String>> {
    openai_compatible::fetch_models(&request_settings(settings, proxy_settings)).await
}

pub async fn generate_text(
    settings: &QwenSettings,
    proxy_settings: &ProxySettings,
    prompt: &str,
) -> AppResult<String> {
    openai_compatible::generate_text_with_settings(
        &request_settings(settings, proxy_settings),
        prompt,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disables_thinking_for_documented_hybrid_models() {
        for model in [
            "qwen3.7-plus",
            "qwen3.7-plus-2026-05-26",
            "qwen3.7-max-2026-06-08",
            "qwen3.6-plus",
            "qwen3.6-flash-2026-04-16",
            "qwen3.5-35b-a3b",
            "qwen3-vl-plus",
            "qwen3-vl-flash-latest",
            "qwen3-max-preview",
            "qwen-plus-latest",
            "qwen-flash",
            "qwen-turbo",
            "qwen3-32b",
        ] {
            assert_eq!(
                thinking_control_for_model(model),
                ThinkingControl::DisableTopLevel,
                "{model} should disable thinking"
            );
        }
    }

    #[test]
    fn leaves_thinking_only_models_untouched() {
        for model in [
            "qwen3.7-max-preview",
            "qwen3.7-max-2026-05-17",
            "qwen3-vl-235b-a22b-thinking",
            "qwen3-235b-a22b-thinking-2507",
            "qwq-plus",
        ] {
            assert_eq!(
                thinking_control_for_model(model),
                ThinkingControl::Unspecified,
                "{model} should retain its required thinking mode"
            );
        }
    }

    #[test]
    fn leaves_legacy_and_unknown_models_untouched() {
        for model in ["qwen-vl-plus", "qwen-vl-max-latest", "custom-qwen-model"] {
            assert_eq!(
                thinking_control_for_model(model),
                ThinkingControl::Unspecified,
                "{model} should not receive an unsupported parameter"
            );
        }
    }
}

pub async fn generate_annotation(
    settings: &QwenSettings,
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
