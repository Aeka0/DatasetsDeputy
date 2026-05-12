use std::fs;

use serde::{Deserialize, Serialize};

use crate::{app_dirs::AppDirs, errors::AppResult};

const SETTINGS_FILE: &str = "thumbnail-settings.json";
const DEFAULT_THUMBNAIL_SIZE: u32 = 256;
const ALLOWED_THUMBNAIL_SIZES: [u32; 5] = [128, 192, 256, 384, 512];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailSettings {
    #[serde(default = "default_thumbnail_size")]
    pub thumbnail_size: u32,
}

impl Default for ThumbnailSettings {
    fn default() -> Self {
        Self {
            thumbnail_size: default_thumbnail_size(),
        }
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<ThumbnailSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(ThumbnailSettings::default());
    }

    let settings: ThumbnailSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(normalize_settings(settings))
}

pub fn save_settings(dirs: &AppDirs, settings: ThumbnailSettings) -> AppResult<ThumbnailSettings> {
    let settings = normalize_settings(settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(mut settings: ThumbnailSettings) -> ThumbnailSettings {
    if !ALLOWED_THUMBNAIL_SIZES.contains(&settings.thumbnail_size) {
        settings.thumbnail_size = default_thumbnail_size();
    }
    settings
}

fn default_thumbnail_size() -> u32 {
    DEFAULT_THUMBNAIL_SIZE
}
