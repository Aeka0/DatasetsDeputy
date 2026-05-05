use std::path::{Path, PathBuf};

use image::{GenericImageView, ImageFormat, ImageReader};

use crate::errors::AppResult;

pub struct ThumbnailResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub format_warning: Option<String>,
}

fn format_display_name(fmt: ImageFormat) -> &'static str {
    match fmt {
        ImageFormat::Png => "PNG",
        ImageFormat::Jpeg => "JPEG",
        ImageFormat::WebP => "WebP",
        ImageFormat::Gif => "GIF",
        ImageFormat::Bmp => "BMP",
        ImageFormat::Tiff => "TIFF",
        _ => "Unknown",
    }
}

fn build_format_warning(source: &Path, actual: ImageFormat) -> Option<String> {
    let ext_format = source
        .extension()
        .and_then(|e| e.to_str())
        .and_then(ImageFormat::from_extension);

    match ext_format {
        Some(ext_fmt) if ext_fmt != actual => {
            let ext_name = format_display_name(ext_fmt);
            let det_name = format_display_name(actual);
            Some(format!(
                "扩展名为 {ext_name}，实际格式为 {det_name}（已正常导入）"
            ))
        }
        _ => None,
    }
}

/// Try `image::open` (fast, extension-based). On format error, retry with
/// magic-byte detection and return a warning describing the mismatch.
fn open_with_fallback(source: &Path) -> AppResult<(image::DynamicImage, Option<String>)> {
    match image::open(source) {
        Ok(img) => Ok((img, None)),
        Err(original_err) if is_format_error(&original_err) => {
            let reader = ImageReader::open(source)?.with_guessed_format()?;
            let detected = reader.format();
            let img = reader.decode()?;
            let warning = detected.and_then(|fmt| build_format_warning(source, fmt));
            Ok((img, warning))
        }
        Err(e) => Err(e.into()),
    }
}

/// Try `image::image_dimensions` (fast, extension-based). On format error,
/// retry with magic-byte detection.
fn dimensions_with_fallback(source: &Path) -> AppResult<((u32, u32), Option<String>)> {
    match image::image_dimensions(source) {
        Ok(dims) => Ok((dims, None)),
        Err(original_err) if is_format_error(&original_err) => {
            let reader = ImageReader::open(source)?.with_guessed_format()?;
            let detected = reader.format();
            let dims = reader.into_dimensions()?;
            let warning = detected.and_then(|fmt| build_format_warning(source, fmt));
            Ok((dims, warning))
        }
        Err(e) => Err(e.into()),
    }
}

fn is_format_error(err: &image::ImageError) -> bool {
    matches!(
        err,
        image::ImageError::Decoding(_) | image::ImageError::Unsupported(_)
    )
}

pub fn create_thumbnail(
    source: &Path,
    target_dir: &Path,
    hash: &str,
) -> AppResult<ThumbnailResult> {
    std::fs::create_dir_all(target_dir)?;
    let target = target_dir.join(format!("{hash}.webp"));

    if target.is_file() {
        let ((width, height), format_warning) = dimensions_with_fallback(source)?;
        return Ok(ThumbnailResult {
            path: target,
            width,
            height,
            format_warning,
        });
    }

    let (image, format_warning) = open_with_fallback(source)?;
    let (width, height) = image.dimensions();
    let thumbnail = image.thumbnail(256, 256);
    thumbnail.save(&target)?;

    Ok(ThumbnailResult {
        path: target,
        width,
        height,
        format_warning,
    })
}
