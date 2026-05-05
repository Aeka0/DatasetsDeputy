use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::errors::AppResult;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDatasetRequest {
    pub output_dir: PathBuf,
    pub dataset_id: String,
    pub image_ids: Vec<i64>,
    pub profile_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreview {
    pub output_dir: String,
    pub estimated_size_bytes: u64,
    pub image_count: usize,
    pub annotation_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub phase: String,
    pub processed: usize,
    pub total: usize,
    pub exported: usize,
    pub failed: usize,
    pub current_path: Option<String>,
    pub output_dir: Option<String>,
    pub estimated_size_bytes: u64,
    pub written_size_bytes: u64,
    pub done: bool,
    pub error: Option<String>,
}

pub struct PreparedExport {
    pub output_dir: PathBuf,
    pub items: Vec<ExportItem>,
    pub estimated_size_bytes: u64,
}

pub struct ExportItem {
    pub source_path: PathBuf,
    pub relative_path: PathBuf,
    pub annotation_content: String,
    pub source_size_bytes: u64,
}

pub fn estimate_export(items: &[ExportItem], output_dir: &Path) -> ExportPreview {
    let estimated_size_bytes = items
        .iter()
        .map(|item| item.source_size_bytes + item.annotation_content.as_bytes().len() as u64)
        .sum();
    let annotation_count = items
        .iter()
        .filter(|item| !item.annotation_content.trim().is_empty())
        .count();

    ExportPreview {
        output_dir: output_dir.to_string_lossy().to_string(),
        estimated_size_bytes,
        image_count: items.len(),
        annotation_count,
    }
}

pub fn export_dataset(
    prepared: PreparedExport,
    emit_progress: impl Fn(ExportProgress),
) -> AppResult<usize> {
    fs::create_dir_all(&prepared.output_dir)?;

    let total = prepared.items.len();
    emit_progress(ExportProgress {
        phase: "exporting".to_owned(),
        processed: 0,
        total,
        exported: 0,
        failed: 0,
        current_path: None,
        output_dir: Some(prepared.output_dir.to_string_lossy().to_string()),
        estimated_size_bytes: prepared.estimated_size_bytes,
        written_size_bytes: 0,
        done: false,
        error: None,
    });

    let mut exported = 0;
    let mut failed = 0;
    let mut written_size_bytes = 0;

    for (index, item) in prepared.items.iter().enumerate() {
        let result = export_item(&prepared.output_dir, item).map(|written| {
            written_size_bytes += written;
            exported += 1;
        });

        if let Err(error) = result {
            failed += 1;
            tracing::warn!("导出图片失败：{:?}：{}", item.source_path, error);
        }

        emit_progress(ExportProgress {
            phase: "exporting".to_owned(),
            processed: index + 1,
            total,
            exported,
            failed,
            current_path: item
                .relative_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned),
            output_dir: Some(prepared.output_dir.to_string_lossy().to_string()),
            estimated_size_bytes: prepared.estimated_size_bytes,
            written_size_bytes,
            done: false,
            error: None,
        });
    }

    emit_progress(ExportProgress {
        phase: "done".to_owned(),
        processed: total,
        total,
        exported,
        failed,
        current_path: None,
        output_dir: Some(prepared.output_dir.to_string_lossy().to_string()),
        estimated_size_bytes: prepared.estimated_size_bytes,
        written_size_bytes,
        done: true,
        error: None,
    });

    tracing::info!(
        "数据集导出完成：exported={}, failed={}, output={:?}",
        exported,
        failed,
        prepared.output_dir
    );
    Ok(exported)
}

fn export_item(output_dir: &Path, item: &ExportItem) -> AppResult<u64> {
    let target_image_path = output_dir.join(&item.relative_path);
    if let Some(parent) = target_image_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let copied_size = fs::copy(&item.source_path, &target_image_path)?;
    let annotation_path = target_image_path.with_extension("txt");
    fs::write(&annotation_path, &item.annotation_content)?;

    Ok(copied_size + item.annotation_content.as_bytes().len() as u64)
}
