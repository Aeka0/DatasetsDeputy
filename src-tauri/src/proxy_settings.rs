use std::{fs, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

const SETTINGS_FILE: &str = "proxy-settings.json";
const LEGACY_GEMINI_SETTINGS_FILE: &str = "gemini-settings.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub use_proxy: bool,
    pub proxy_port: String,
}

pub fn default_settings() -> ProxySettings {
    ProxySettings {
        use_proxy: false,
        proxy_port: "7890".to_owned(),
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<ProxySettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if path.exists() {
        let mut settings: ProxySettings = serde_json::from_str(&fs::read_to_string(path)?)?;
        normalize_settings(&mut settings);
        return Ok(settings);
    }

    let legacy_path = dirs.config.join(LEGACY_GEMINI_SETTINGS_FILE);
    if legacy_path.exists() {
        if let Ok(payload) =
            serde_json::from_str::<serde_json::Value>(&fs::read_to_string(legacy_path)?)
        {
            let mut settings = ProxySettings {
                use_proxy: payload
                    .get("useProxy")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                proxy_port: payload
                    .get("proxyPort")
                    .and_then(|value| value.as_str())
                    .unwrap_or("7890")
                    .to_owned(),
            };
            normalize_settings(&mut settings);
            return Ok(settings);
        }
    }

    Ok(default_settings())
}

pub fn save_settings(dirs: &AppDirs, mut settings: ProxySettings) -> AppResult<ProxySettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(settings: &mut ProxySettings) {
    settings.proxy_port = settings.proxy_port.trim().to_owned();
    if settings.proxy_port.is_empty() {
        settings.proxy_port = default_settings().proxy_port;
    }
}

pub fn http_client(settings: &ProxySettings, timeout_secs: u64) -> AppResult<reqwest::Client> {
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
