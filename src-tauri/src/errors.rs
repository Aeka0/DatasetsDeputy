use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database operation failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("File system operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Image processing failed: {0}")]
    Image(#[from] image::ImageError),
    #[error("Serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Zip operation failed: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Dialog was cancelled")]
    DialogCancelled,
    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "database_error",
            Self::Io(_) => "io_error",
            Self::Image(_) => "image_error",
            Self::Json(_) => "json_error",
            Self::Zip(_) => "zip_error",
            Self::DialogCancelled => "dialog_cancelled",
            Self::InvalidInput(_) => "invalid_input",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        AppErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
