use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use crate::{db::DatasetImage, errors::AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub output_dir: PathBuf,
    pub format: ExportFormat,
    pub profile_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    TxtPerImage,
    Jsonl,
}

pub fn export_dataset(images: &[DatasetImage], request: ExportRequest) -> AppResult<usize> {
    fs::create_dir_all(&request.output_dir)?;

    match request.format {
        ExportFormat::TxtPerImage => export_txt_per_image(images, &request.output_dir),
        ExportFormat::Jsonl => export_jsonl(images, &request.output_dir, &request.profile_ids),
    }
}

fn export_txt_per_image(images: &[DatasetImage], output_dir: &Path) -> AppResult<usize> {
    for image in images {
        let stem = Path::new(&image.file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("caption");
        let content = if image.caption.trim().is_empty() {
            image.tags.join(", ")
        } else {
            image.caption.clone()
        };
        fs::write(output_dir.join(format!("{stem}.txt")), content)?;
    }

    tracing::info!("TXT export finished: {} files written", images.len());
    Ok(images.len())
}

fn export_jsonl(
    images: &[DatasetImage],
    output_dir: &Path,
    profile_ids: &[i64],
) -> AppResult<usize> {
    let mut lines = Vec::with_capacity(images.len());

    for image in images {
        let annotations = image
            .annotations
            .iter()
            .filter(|annotation| {
                profile_ids.is_empty() || profile_ids.contains(&annotation.profile_id)
            })
            .collect::<Vec<_>>();

        lines.push(
            serde_json::json!({
                "path": image.path,
                "fileName": image.file_name,
                "tags": image.tags,
                "caption": image.caption,
                "annotations": annotations
            })
            .to_string(),
        );
    }

    fs::write(output_dir.join("dataset.jsonl"), lines.join("\n"))?;
    tracing::info!("JSONL export finished: {} rows written", images.len());
    Ok(images.len())
}
