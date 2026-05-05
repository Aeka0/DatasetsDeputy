use tauri::{WebviewWindow, Window};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_DONOTROUND, DWMWCP_ROUND,
};

fn set_corner_preference(hwnd: windows::Win32::Foundation::HWND, should_round: bool) {
    let preference = if should_round {
        DWMWCP_ROUND
    } else {
        DWMWCP_DONOTROUND
    };

    unsafe {
        let result = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );

        if let Err(e) = result {
            // It's normal to fail on Windows 10 since the attribute is unsupported there.
            tracing::debug!("DwmSetWindowAttribute failed (expected on Win10): {}", e);
        }
    }

    unsafe {
        let border_color = DWMWA_COLOR_NONE;
        let result = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_color as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&border_color) as u32,
        );

        if let Err(e) = result {
            tracing::debug!("DWM border color update failed (expected on Win10): {}", e);
        }
    }
}

pub fn sync_rounded_region(window: &WebviewWindow, _radius: i32) {
    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("Failed to get window handle for rounded region");
        return;
    };

    // On Windows 11, setting DWMWCP_ROUND politely asks DWM to round the window corners
    // and correctly clip any native blur/mica effects to the rounded borders.
    // On Windows 10, this API call silently does nothing and leaves the corners square,
    // which is the proper native behavior for frameless blurred windows on Win10.
    set_corner_preference(hwnd, true);
}

pub fn sync_maximized_region(window: &Window) {
    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("Failed to get window handle for maximized region");
        return;
    };

    let should_round = !window.is_maximized().unwrap_or(false);
    set_corner_preference(hwnd, should_round);
}
