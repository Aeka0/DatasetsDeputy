use std::{
    mem::{size_of, zeroed},
    path::Path,
};

use image::{DynamicImage, ImageBuffer, Rgba};
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::SIZE,
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
        },
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
        UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
            SIIGBF_RESIZETOFIT,
        },
    },
};

struct ComGuard {
    should_uninitialize: bool,
}

impl ComGuard {
    fn initialize() -> Self {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() };
        Self {
            should_uninitialize: initialized,
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

struct BitmapGuard(HBITMAP);

impl Drop for BitmapGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.0 .0));
        }
    }
}

pub fn create_thumbnail(source: &Path, target: &Path, max_edge: u32) -> bool {
    if max_edge == 0 {
        return false;
    }

    let _com = ComGuard::initialize();
    let item = match unsafe {
        SHCreateItemFromParsingName::<_, _, IShellItemImageFactory>(
            &HSTRING::from(source.to_string_lossy().as_ref()),
            None,
        )
    } {
        Ok(item) => item,
        Err(_) => return false,
    };

    let size = SIZE {
        cx: max_edge.min(i32::MAX as u32) as i32,
        cy: max_edge.min(i32::MAX as u32) as i32,
    };
    let bitmap = match unsafe {
        item.GetImage(
            size,
            SIIGBF_BIGGERSIZEOK | SIIGBF_RESIZETOFIT,
        )
    } {
        Ok(bitmap) if !bitmap.0.is_null() => BitmapGuard(bitmap),
        _ => return false,
    };

    let Some(image) = bitmap_to_rgba(bitmap.0) else {
        return false;
    };

    if let Some(parent) = target.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return false;
        }
    }

    DynamicImage::ImageRgba8(image).save(target).is_ok()
}

fn bitmap_to_rgba(bitmap: HBITMAP) -> Option<ImageBuffer<Rgba<u8>, Vec<u8>>> {
    let mut bitmap_info: BITMAP = unsafe { zeroed() };
    let object_size = size_of::<BITMAP>() as i32;
    let got_object = unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0),
            object_size,
            Some((&mut bitmap_info as *mut BITMAP).cast()),
        )
    };
    if got_object != object_size || bitmap_info.bmWidth <= 0 || bitmap_info.bmHeight <= 0 {
        return None;
    }

    let width = bitmap_info.bmWidth as u32;
    let height = bitmap_info.bmHeight as u32;
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0_u8; width as usize * height as usize * 4];
    let hdc = unsafe { GetDC(None) };
    if hdc.0.is_null() {
        return None;
    }

    let scan_lines = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height,
            Some(bgra.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        let _ = ReleaseDC(None, hdc);
    }

    if scan_lines != height as i32 {
        return None;
    }

    let mut has_alpha = false;
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        has_alpha |= pixel[3] != 0;
    }
    if !has_alpha {
        for pixel in bgra.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }

    ImageBuffer::from_raw(width, height, bgra)
}
