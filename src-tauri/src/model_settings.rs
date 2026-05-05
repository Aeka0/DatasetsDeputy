use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{app_dirs::AppDirs, errors::AppResult};

const SETTINGS_FILE: &str = "model-settings.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettings {
    #[serde(default)]
    pub wd14_tagger: Wd14TaggerSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wd14TaggerSettings {
    #[serde(default)]
    pub model_path: String,
    #[serde(default = "default_model_type")]
    pub model_type: String,
    #[serde(default = "default_true")]
    pub add_character_tags: bool,
    #[serde(default)]
    pub add_copyright_tags: bool,
    #[serde(default = "default_true")]
    pub replace_underscores_with_spaces: bool,
    #[serde(default = "default_general_threshold")]
    pub general_threshold: f64,
    #[serde(default = "default_character_threshold")]
    pub character_threshold: f64,
}

impl Default for Wd14TaggerSettings {
    fn default() -> Self {
        Self {
            model_path: String::new(),
            model_type: default_model_type(),
            add_character_tags: default_true(),
            add_copyright_tags: false,
            replace_underscores_with_spaces: default_true(),
            general_threshold: default_general_threshold(),
            character_threshold: default_character_threshold(),
        }
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<ModelSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(ModelSettings::default());
    }

    let settings: ModelSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(normalize_settings(settings))
}

pub fn save_settings(dirs: &AppDirs, settings: ModelSettings) -> AppResult<ModelSettings> {
    let settings = normalize_settings(settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn normalize_settings(mut settings: ModelSettings) -> ModelSettings {
    settings.wd14_tagger.model_path = settings.wd14_tagger.model_path.trim().to_owned();
    settings.wd14_tagger.model_type = infer_model_type(&settings.wd14_tagger.model_path);
    settings.wd14_tagger.general_threshold = settings.wd14_tagger.general_threshold.clamp(0.0, 1.0);
    settings.wd14_tagger.character_threshold =
        settings.wd14_tagger.character_threshold.clamp(0.0, 1.0);
    settings
}

pub fn infer_model_type_for_path(path: &str) -> String {
    infer_model_type(path)
}

fn infer_model_type(path: &str) -> String {
    let path = Path::new(path);
    if path.is_dir() {
        if directory_contains_extension(path, &["onnx"]) {
            return "onnx".to_owned();
        }
        if directory_contains_extension(path, &["pt", "pth", "safetensors", "bin"]) {
            return "pytorch".to_owned();
        }
        return default_model_type();
    }

    match file_extension(path).as_deref() {
        Some("onnx") => "onnx".to_owned(),
        Some("pt" | "pth" | "safetensors" | "bin") => "pytorch".to_owned(),
        _ => default_model_type(),
    }
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
}

fn directory_contains_extension(path: &Path, extensions: &[&str]) -> bool {
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let entry_path: PathBuf = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
                continue;
            }
            if file_extension(&entry_path)
                .as_deref()
                .is_some_and(|extension| extensions.contains(&extension))
            {
                return true;
            }
        }
    }
    false
}

fn default_model_type() -> String {
    "unknown".to_owned()
}

fn default_true() -> bool {
    true
}

fn default_general_threshold() -> f64 {
    0.7
}

fn default_character_threshold() -> f64 {
    0.9
}
