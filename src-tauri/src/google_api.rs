use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use chrono::Utc;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

pub const SOURCE_AI_STUDIO: &str = "ai_studio";
pub const SOURCE_VERTEX_AI: &str = "vertex_ai";
const VERTEX_ENDPOINT_BASE: &str = "https://aiplatform.googleapis.com/v1";
const DEFAULT_VERTEX_LOCATION: &str = "global";
const CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

#[derive(Clone, Debug, Deserialize)]
pub struct ServiceAccountCredentials {
    pub client_email: String,
    pub private_key: String,
    #[serde(default = "default_token_uri")]
    pub token_uri: String,
    #[serde(default)]
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default = "default_token_lifetime")]
    expires_in: i64,
}

#[derive(Debug, Serialize)]
struct ServiceAccountClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: i64,
    iat: i64,
}

#[derive(Clone, Debug)]
pub struct VertexAuth {
    access_token: String,
}

#[derive(Clone, Debug)]
struct CachedVertexAuth {
    credential_key: String,
    expires_at: i64,
    auth: VertexAuth,
}

static VERTEX_AUTH_CACHE: OnceLock<Mutex<Option<CachedVertexAuth>>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GoogleApiSource {
    AiStudio,
    VertexAi,
}

impl GoogleApiSource {
    pub fn from_settings(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "vertex_ai" | "vertex" | "vertexai" => Self::VertexAi,
            _ => Self::AiStudio,
        }
    }

    pub fn as_settings_value(self) -> &'static str {
        match self {
            Self::AiStudio => SOURCE_AI_STUDIO,
            Self::VertexAi => SOURCE_VERTEX_AI,
        }
    }
}

pub fn normalize_source(value: &str) -> String {
    GoogleApiSource::from_settings(value)
        .as_settings_value()
        .to_owned()
}

pub fn normalize_vertex_location(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        DEFAULT_VERTEX_LOCATION.to_owned()
    } else {
        value.to_owned()
    }
}

pub fn vertex_model_path(model_name: &str, project_id: &str, location: &str) -> AppResult<String> {
    let model = model_name.trim().trim_start_matches("models/");
    let project = project_id.trim();
    if project.is_empty() {
        return Err(AppError::InvalidInput(
            "Vertex AI project id is required".to_owned(),
        ));
    }
    if model.is_empty() {
        return Err(AppError::InvalidInput(
            "Vertex AI model name is required".to_owned(),
        ));
    }
    let location = normalize_vertex_location(location);
    Ok(format!(
        "projects/{project}/locations/{location}/publishers/google/models/{model}"
    ))
}

pub fn vertex_endpoint_base() -> &'static str {
    VERTEX_ENDPOINT_BASE
}

pub fn runtime_api_path(dirs: &AppDirs, path: &str) -> PathBuf {
    let value = Path::new(path.trim());
    if value.is_absolute() {
        value.to_path_buf()
    } else {
        dirs.root.join(value)
    }
}

pub fn stored_api_path(dirs: &AppDirs, path: &Path) -> String {
    let Ok(api_dir) = dunce::canonicalize(&dirs.api_config_dir) else {
        return path.to_string_lossy().to_string();
    };
    let Ok(absolute) = dunce::canonicalize(path) else {
        return path.to_string_lossy().to_string();
    };
    if !absolute.starts_with(&api_dir) {
        return path.to_string_lossy().to_string();
    }
    absolute
        .strip_prefix(&dirs.root)
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

pub fn load_vertex_credentials(dirs: &AppDirs, path: &str) -> AppResult<ServiceAccountCredentials> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Vertex AI service account JSON is required".to_owned(),
        ));
    }
    let path = runtime_api_path(dirs, path);
    let credentials =
        serde_json::from_str::<ServiceAccountCredentials>(&fs::read_to_string(path)?)?;
    if credentials.client_email.trim().is_empty()
        || credentials.private_key.trim().is_empty()
        || credentials.project_id.trim().is_empty()
        || credentials.token_uri.trim().is_empty()
    {
        return Err(AppError::InvalidInput(
            "Vertex AI service account JSON must include client_email, private_key, project_id, and token_uri"
                .to_owned(),
        ));
    }
    Ok(credentials)
}

fn service_account_file_name(source_path: &Path) -> String {
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("vertex-service-account.json");
    let sanitized = source_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.trim().is_empty() || !sanitized.to_ascii_lowercase().ends_with(".json") {
        "vertex-service-account.json".to_owned()
    } else {
        sanitized
    }
}

pub fn import_vertex_service_account(
    dirs: &AppDirs,
    source_path: &Path,
) -> AppResult<(String, String)> {
    let source = dunce::canonicalize(source_path)?;
    let credentials =
        serde_json::from_str::<ServiceAccountCredentials>(&fs::read_to_string(&source)?)?;
    if credentials.client_email.trim().is_empty()
        || credentials.private_key.trim().is_empty()
        || credentials.project_id.trim().is_empty()
        || credentials.token_uri.trim().is_empty()
    {
        return Err(AppError::InvalidInput(
            "Vertex AI service account JSON must include client_email, private_key, project_id, and token_uri"
                .to_owned(),
        ));
    }

    fs::create_dir_all(&dirs.api_config_dir)?;
    let destination = dirs.api_config_dir.join(service_account_file_name(&source));
    let same_path = dunce::canonicalize(&destination)
        .map(|destination| destination == source)
        .unwrap_or(false);
    if !same_path {
        fs::copy(&source, &destination)?;
    }

    tracing::info!(
        "Imported Vertex AI service account for project {}",
        credentials.project_id
    );
    Ok((stored_api_path(dirs, &destination), credentials.project_id))
}

pub async fn authorize_vertex(
    client: &Client,
    credentials: &ServiceAccountCredentials,
) -> AppResult<VertexAuth> {
    let credential_key = credential_cache_key(credentials);
    let cache = VERTEX_AUTH_CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache.lock().await;
    let now = Utc::now().timestamp();
    if let Some(entry) = cached.as_ref() {
        if entry.credential_key == credential_key && entry.expires_at > now + 300 {
            return Ok(entry.auth.clone());
        }
    }

    let claims = ServiceAccountClaims {
        iss: credentials.client_email.trim(),
        scope: CLOUD_PLATFORM_SCOPE,
        aud: credentials.token_uri.trim(),
        iat: now,
        exp: now + 3600,
    };
    let assertion = encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &EncodingKey::from_rsa_pem(credentials.private_key.as_bytes()).map_err(|error| {
            AppError::InvalidInput(format!("Vertex AI private key parse failed: {error}"))
        })?,
    )
    .map_err(|error| AppError::InvalidInput(format!("Vertex AI JWT creation failed: {error}")))?;

    let response = client
        .post(credentials.token_uri.trim())
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", assertion.as_str()),
        ])
        .send()
        .await
        .map_err(|error| {
            AppError::InvalidInput(format!("Vertex AI OAuth token request failed: {error}"))
        })?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|error| {
        AppError::InvalidInput(format!("Vertex AI OAuth response parse failed: {error}"))
    })?;
    if !status.is_success() {
        let message = value
            .get("error_description")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("OAuth token request failed");
        return Err(AppError::InvalidInput(format!(
            "Vertex AI OAuth token request failed with HTTP {status}: {message}"
        )));
    }
    let token = serde_json::from_value::<TokenResponse>(value)?;
    if token.access_token.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Vertex AI OAuth response did not include an access token".to_owned(),
        ));
    }

    let auth = VertexAuth {
        access_token: token.access_token,
    };
    *cached = Some(CachedVertexAuth {
        credential_key,
        expires_at: now + token.expires_in.max(60),
        auth: auth.clone(),
    });
    Ok(auth)
}

pub fn apply_vertex_auth(request: RequestBuilder, auth: &VertexAuth) -> RequestBuilder {
    request.bearer_auth(auth.access_token.trim())
}

fn credential_cache_key(credentials: &ServiceAccountCredentials) -> String {
    let mut hasher = Sha256::new();
    hasher.update(credentials.client_email.trim().as_bytes());
    hasher.update(b"\0");
    hasher.update(credentials.private_key.as_bytes());
    hasher.update(b"\0");
    hasher.update(credentials.token_uri.trim().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_owned()
}

fn default_token_lifetime() -> i64 {
    3600
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_google_source_and_vertex_location() {
        assert_eq!(normalize_source("vertex"), SOURCE_VERTEX_AI);
        assert_eq!(normalize_source("unexpected"), SOURCE_AI_STUDIO);
        assert_eq!(normalize_vertex_location(""), "global");
    }

    #[test]
    fn builds_vertex_publisher_model_path() {
        assert_eq!(
            vertex_model_path("models/gemini-2.5-flash", "sample-project", "us-central1")
                .unwrap(),
            "projects/sample-project/locations/us-central1/publishers/google/models/gemini-2.5-flash"
        );
    }
}
