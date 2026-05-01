use serde::{Deserialize, Serialize};
use tauri::utils::{
    config::{Color, WindowConfig, WindowEffectsConfig},
    WindowEffect,
};

use crate::{app_dirs::AppDirs, errors::AppResult};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowRenderMode {
    Blur,
    Acrylic,
}

impl WindowRenderMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blur => "blur",
            Self::Acrylic => "acrylic",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRenderingSettings {
    pub mode: WindowRenderMode,
}

fn detect_default_mode() -> WindowRenderMode {
    #[cfg(target_os = "windows")]
    {
        if is_windows_11_or_later() {
            WindowRenderMode::Acrylic
        } else {
            WindowRenderMode::Blur
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        WindowRenderMode::Blur
    }
}

#[cfg(target_os = "windows")]
fn is_windows_11_or_later() -> bool {
    #[repr(C)]
    struct OsVersionInfoExW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
        w_service_pack_major: u16,
        w_service_pack_minor: u16,
        w_suite_mask: u16,
        w_product_type: u8,
        w_reserved: u8,
    }

    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoExW) -> i32;
    }

    let result = unsafe {
        let mut info = std::mem::zeroed::<OsVersionInfoExW>();
        info.dw_os_version_info_size = std::mem::size_of::<OsVersionInfoExW>() as u32;
        if RtlGetVersion(&mut info) == 0 {
            let is_win11 = info.dw_build_number >= 22000;
            tracing::info!(
                "操作系统版本检测：build {}，判定为 {}",
                info.dw_build_number,
                if is_win11 { "Windows 11+" } else { "Windows 10" }
            );
            is_win11
        } else {
            tracing::warn!("RtlGetVersion 调用失败，回退到 Blur 模式。");
            false
        }
    };
    result
}

pub fn load_settings(_dirs: &AppDirs) -> WindowRenderingSettings {
    WindowRenderingSettings {
        mode: detect_default_mode(),
    }
}

pub fn save_settings(
    _dirs: &AppDirs,
    _settings: WindowRenderingSettings,
) -> AppResult<WindowRenderingSettings> {
    let settings = WindowRenderingSettings {
        mode: detect_default_mode(),
    };
    tracing::info!("窗口渲染模式已固定为：{}", settings.mode.as_str());
    Ok(settings)
}

pub fn apply_to_main_window_config(
    mut config: WindowConfig,
    settings: &WindowRenderingSettings,
) -> WindowConfig {
    config.shadow = false;
    config.transparent = true;

    match settings.mode {
        WindowRenderMode::Blur => {
            config.window_effects = Some(WindowEffectsConfig {
                effects: vec![WindowEffect::Blur],
                color: Some(Color(246, 248, 252, 140)),
                ..Default::default()
            });
        }
        WindowRenderMode::Acrylic => {
            config.window_effects = Some(WindowEffectsConfig {
                effects: vec![WindowEffect::Acrylic],
                color: Some(Color(246, 248, 252, 150)),
                ..Default::default()
            });
        }
    }

    config
}
