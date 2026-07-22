use std::{fs, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

const SETTINGS_FILE: &str = "proxy-settings.json";
const LEGACY_GEMINI_SETTINGS_FILE: &str = "gemini-settings.json";
pub const MODE_SYSTEM: &str = "system";
pub const MODE_DIRECT: &str = "direct";
pub const MODE_MANUAL: &str = "manual";
const DEFAULT_MANUAL_PROXY_URL: &str = "http://127.0.0.1:7890";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    #[serde(default = "default_proxy_mode")]
    pub proxy_mode: String,
    #[serde(default = "default_proxy_url")]
    pub proxy_url: String,
}

impl ProxySettings {
    pub fn direct() -> Self {
        Self {
            proxy_mode: MODE_DIRECT.to_owned(),
            proxy_url: default_proxy_url(),
        }
    }
}

pub fn default_settings() -> ProxySettings {
    ProxySettings {
        proxy_mode: default_proxy_mode(),
        proxy_url: default_proxy_url(),
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<ProxySettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if path.exists() {
        let value = serde_json::from_str::<Value>(&fs::read_to_string(path)?)?;
        return settings_from_value(&value);
    }

    let legacy_path = dirs.config.join(LEGACY_GEMINI_SETTINGS_FILE);
    if legacy_path.exists() {
        let value = serde_json::from_str::<Value>(&fs::read_to_string(legacy_path)?)?;
        return settings_from_value(&value);
    }

    Ok(default_settings())
}

pub fn save_settings(dirs: &AppDirs, mut settings: ProxySettings) -> AppResult<ProxySettings> {
    normalize_settings(&mut settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

pub fn http_client(settings: &ProxySettings, timeout_secs: u64) -> AppResult<reqwest::Client> {
    let builder = reqwest::Client::builder().timeout(Duration::from_secs(timeout_secs));
    let builder =
        match normalized_mode(&settings.proxy_mode) {
            MODE_DIRECT => builder.no_proxy(),
            MODE_MANUAL => {
                let proxy_url = normalized_proxy_url(&settings.proxy_url);
                builder.proxy(reqwest::Proxy::all(&proxy_url).map_err(|error| {
                    AppError::InvalidInput(format!("Invalid proxy URL: {error}"))
                })?)
            }
            _ => builder,
        };

    builder
        .build()
        .map_err(|error| AppError::InvalidInput(format!("HTTP client failed: {error}")))
}

fn settings_from_value(value: &Value) -> AppResult<ProxySettings> {
    if value.get("proxyMode").is_some() || value.get("proxyUrl").is_some() {
        let mut settings = serde_json::from_value::<ProxySettings>(value.clone())?;
        normalize_settings(&mut settings);
        return Ok(settings);
    }

    let use_proxy = value
        .get("useProxy")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let proxy_port = value
        .get("proxyPort")
        .and_then(Value::as_str)
        .unwrap_or("7890")
        .trim();
    let mut settings = ProxySettings {
        proxy_mode: if use_proxy { MODE_MANUAL } else { MODE_SYSTEM }.to_owned(),
        proxy_url: format!("http://127.0.0.1:{proxy_port}"),
    };
    normalize_settings(&mut settings);
    Ok(settings)
}

fn normalize_settings(settings: &mut ProxySettings) {
    settings.proxy_mode = normalized_mode(&settings.proxy_mode).to_owned();
    settings.proxy_url = normalized_proxy_url(&settings.proxy_url);
}

fn normalized_mode(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        MODE_DIRECT => MODE_DIRECT,
        MODE_MANUAL => MODE_MANUAL,
        _ => MODE_SYSTEM,
    }
}

fn normalized_proxy_url(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return default_proxy_url();
    }
    if value.contains("://") {
        value.trim_end_matches('/').to_owned()
    } else {
        format!("http://{}", value.trim_end_matches('/'))
    }
}

fn default_proxy_mode() -> String {
    MODE_SYSTEM.to_owned()
}

fn default_proxy_url() -> String {
    DEFAULT_MANUAL_PROXY_URL.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_system_proxy() {
        let settings = default_settings();
        assert_eq!(settings.proxy_mode, MODE_SYSTEM);
    }

    #[test]
    fn migrates_legacy_proxy_settings() {
        let manual = settings_from_value(&serde_json::json!({
            "useProxy": true,
            "proxyPort": "10808"
        }))
        .unwrap();
        assert_eq!(manual.proxy_mode, MODE_MANUAL);
        assert_eq!(manual.proxy_url, "http://127.0.0.1:10808");

        let system = settings_from_value(&serde_json::json!({
            "useProxy": false,
            "proxyPort": "7890"
        }))
        .unwrap();
        assert_eq!(system.proxy_mode, MODE_SYSTEM);
    }

    #[test]
    fn normalizes_manual_proxy_urls() {
        assert_eq!(
            normalized_proxy_url("127.0.0.1:10808"),
            "http://127.0.0.1:10808"
        );
        assert_eq!(
            normalized_proxy_url("socks5://127.0.0.1:10808/"),
            "socks5://127.0.0.1:10808"
        );
    }
}
