use std::path::{Path, PathBuf};

use image::GenericImageView;

use crate::errors::AppResult;

pub struct ThumbnailResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
}

pub fn create_thumbnail(
    source: &Path,
    target_dir: &Path,
    hash: &str,
) -> AppResult<ThumbnailResult> {
    std::fs::create_dir_all(target_dir)?;

    let image = image::open(source)?;
    let (width, height) = image.dimensions();
    let thumbnail = image.thumbnail(256, 256);
    let target = target_dir.join(format!("{hash}.webp"));
    thumbnail.save(&target)?;

    Ok(ThumbnailResult {
        path: target,
        width,
        height,
    })
}
