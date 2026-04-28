use tauri::WebviewWindow;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};

pub fn sync_rounded_region(window: &WebviewWindow, _radius: i32) {
    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("Failed to get window handle for rounded region");
        return;
    };

    // On Windows 11, setting DWMWCP_ROUND politely asks DWM to round the window corners
    // and correctly clip any native blur/mica effects to the rounded borders.
    // On Windows 10, this API call silently does nothing and leaves the corners square,
    // which is the proper native behavior for frameless blurred windows on Win10.
    unsafe {
        let preference = DWMWCP_ROUND;
        let result = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );

        if let Err(e) = result {
            // It's normal to fail on Windows 10 since the attribute is unsupported there
            tracing::debug!("DwmSetWindowAttribute failed (expected on Win10): {}", e);
        }
    }
}
