use std::{
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU8, Ordering}, Arc},
    time::{Duration, Instant},
};

use fast_image_resize::{images::Image as FirImage, IntoImageView, Resizer};
use image::{DynamicImage, ImageFormat, ImageReader, RgbaImage};

use crate::errors::{AppError, AppResult};

const THUMBNAIL_SOURCE_SIZE_LIMIT: u64 = 100_000_000;
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(15);
const THUMBNAIL_MAX_PIXELS: u64 = 100_000_000;

#[cfg(target_os = "windows")]
mod windows_shell;

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

fn simd_resize(image: &DynamicImage, max_edge: u32) -> AppResult<DynamicImage> {
    let src_w = image.width();
    let src_h = image.height();
    if src_w <= max_edge && src_h <= max_edge {
        return Ok(image.clone());
    }
    let scale = (max_edge as f64 / src_w as f64).min(max_edge as f64 / src_h as f64);
    let dst_w = ((src_w as f64 * scale).round() as u32).max(1);
    let dst_h = ((src_h as f64 * scale).round() as u32).max(1);

    let src_rgba = image.to_rgba8();
    let pixel_type = src_rgba
        .pixel_type()
        .ok_or_else(|| AppError::InvalidInput("不支持的像素类型".into()))?;
    let mut dst_image = FirImage::new(dst_w, dst_h, pixel_type);
    let mut resizer = Resizer::new();
    resizer
        .resize(&src_rgba, &mut dst_image, None)
        .map_err(|e| AppError::InvalidInput(format!("SIMD缩放失败：{e}")))?;

    let buf = RgbaImage::from_raw(dst_w, dst_h, dst_image.into_vec())
        .ok_or_else(|| AppError::InvalidInput("SIMD缩放结果缓冲区大小不匹配".into()))?;
    Ok(DynamicImage::ImageRgba8(buf))
}

pub fn is_valid_thumbnail(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|metadata| metadata.len() > 100)
            .unwrap_or(false)
}

pub fn thumbnail_path(target_dir: &Path, hash: &str, max_edge: u32) -> PathBuf {
    target_dir.join(format!("{hash}-{}.webp", max_edge.max(1)))
}

const STEP_INIT: u8 = 0;
const STEP_DIMENSIONS: u8 = 1;
const STEP_WINDOWS_SHELL: u8 = 2;

const STEP_FULL_DECODE: u8 = 5;
const STEP_SIMD_RESIZE: u8 = 6;
const STEP_SAVE: u8 = 7;

fn step_name(step: u8) -> &'static str {
    match step {
        STEP_INIT => "初始化",
        STEP_DIMENSIONS => "读取图片尺寸",
        STEP_WINDOWS_SHELL => "Windows Shell缩略图",
        STEP_FULL_DECODE => "完整解码图片",
        STEP_SIMD_RESIZE => "SIMD缩放",
        STEP_SAVE => "保存缩略图",
        _ => "未知步骤",
    }
}

fn create_thumbnail_inner(
    source: &Path,
    target_dir: &Path,
    hash: &str,
    max_edge: u32,
    progress: &AtomicU8,
) -> AppResult<ThumbnailResult> {
    std::fs::create_dir_all(target_dir)?;
    let max_edge = max_edge.max(1);
    let target = thumbnail_path(target_dir, hash, max_edge);
    let file_size = std::fs::metadata(source)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if file_size > THUMBNAIL_SOURCE_SIZE_LIMIT {
        return Err(AppError::InvalidInput(format!(
            "图片文件过大（{:.0} MB），跳过缩略图生成",
            file_size as f64 / 1_000_000.0,
        )));
    }

    if target.is_file() {
        if !is_valid_thumbnail(&target) {
            let _ = std::fs::remove_file(&target);
        } else {
            return Ok(ThumbnailResult {
                path: target,
                width: 0,
                height: 0,
                format_warning: None,
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        progress.store(STEP_WINDOWS_SHELL, Ordering::Relaxed);
        if windows_shell::create_thumbnail(source, &target, max_edge)
            && is_valid_thumbnail(&target)
        {
            progress.store(STEP_DIMENSIONS, Ordering::Relaxed);
            let ((width, height), format_warning) = dimensions_with_fallback(source)?;
            return Ok(ThumbnailResult {
                path: target,
                width,
                height,
                format_warning,
            });
        }
    }

    progress.store(STEP_DIMENSIONS, Ordering::Relaxed);
    let ((width, height), format_warning) = dimensions_with_fallback(source)?;

    if width as u64 * height as u64 > THUMBNAIL_MAX_PIXELS {
        return Err(AppError::InvalidInput(format!(
            "图片像素过大（{}x{}），跳过缩略图生成",
            width, height,
        )));
    }

    progress.store(STEP_FULL_DECODE, Ordering::Relaxed);
    let (image, fallback_warning) = open_with_fallback(source)?;
    let format_warning = fallback_warning.or(format_warning);
    progress.store(STEP_SIMD_RESIZE, Ordering::Relaxed);
    let thumbnail = simd_resize(&image, max_edge)?;
    progress.store(STEP_SAVE, Ordering::Relaxed);
    thumbnail.save(&target)?;

    Ok(ThumbnailResult {
        path: target,
        width,
        height,
        format_warning,
    })
}

pub fn create_thumbnail(
    source: &Path,
    target_dir: &Path,
    hash: &str,
    max_edge: u32,
) -> AppResult<ThumbnailResult> {
    let progress = AtomicU8::new(STEP_INIT);
    create_thumbnail_inner(source, target_dir, hash, max_edge, &progress)
}

pub fn create_thumbnail_with_timeout(
    source: &Path,
    target_dir: &Path,
    hash: &str,
    max_edge: u32,
) -> AppResult<ThumbnailResult> {
    let source_owned = source.to_path_buf();
    let target_dir_owned = target_dir.to_path_buf();
    let hash_owned = hash.to_owned();
    let progress = Arc::new(AtomicU8::new(STEP_INIT));
    let progress_clone = Arc::clone(&progress);

    let handle = std::thread::spawn(move || {
        create_thumbnail_inner(
            &source_owned,
            &target_dir_owned,
            &hash_owned,
            max_edge,
            &progress_clone,
        )
    });

    let file_size = std::fs::metadata(source)
        .map(|m| m.len())
        .unwrap_or(0);

    let start = Instant::now();
    loop {
        if handle.is_finished() {
            return match handle.join() {
                Ok(result) => result,
                Err(_) => Err(AppError::InvalidInput(format!(
                    "缩略图生成线程崩溃：{}",
                    source.to_string_lossy()
                ))),
            };
        }
        if start.elapsed() > THUMBNAIL_TIMEOUT {
            let current_step = progress.load(Ordering::Relaxed);
            return Err(AppError::InvalidInput(format!(
                "缩略图生成超时（{:.0}s），卡在「{}」阶段（文件 {:.1} MB）",
                start.elapsed().as_secs_f64(),
                step_name(current_step),
                file_size as f64 / 1_000_000.0,
            )));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

