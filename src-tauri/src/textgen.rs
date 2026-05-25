use std::path::Path;

use crate::{
    errors::AppResult,
    llm_loader_settings::{self, LlmLoaderSettings},
    openai_compatible::{self, OpenAiCompatibleSettings},
};

fn request_settings(settings: &LlmLoaderSettings) -> OpenAiCompatibleSettings {
    OpenAiCompatibleSettings {
        label: "Textgen".to_owned(),
        base_url: llm_loader_settings::textgen_base_url(settings),
        api_key: String::new(),
        model: String::new(),
        use_proxy: false,
        proxy_port: String::new(),
        disable_thinking: true,
    }
}

pub async fn generate_text(settings: &LlmLoaderSettings, prompt: &str) -> AppResult<String> {
    openai_compatible::generate_text_with_settings(&request_settings(settings), prompt).await
}

pub async fn generate_annotation(
    settings: &LlmLoaderSettings,
    image_path: &Path,
    prompt: &str,
) -> AppResult<String> {
    openai_compatible::generate_annotation_with_settings(
        &request_settings(settings),
        image_path,
        prompt,
    )
    .await
}
