use std::path::Path;

use crate::{
    errors::AppResult,
    openai_compatible::{self, OpenAiCompatibleBackend},
};

const BACKEND: OpenAiCompatibleBackend = OpenAiCompatibleBackend {
    label: "LM Studio",
    base_url: "http://127.0.0.1:1234",
    disable_thinking: false,
};

pub async fn generate_text(prompt: &str) -> AppResult<String> {
    openai_compatible::generate_text(BACKEND, prompt).await
}

pub async fn generate_annotation(image_path: &Path, prompt: &str) -> AppResult<String> {
    openai_compatible::generate_annotation(BACKEND, image_path, prompt).await
}
