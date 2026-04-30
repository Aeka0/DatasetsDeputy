use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

use crate::{
    app_dirs::AppDirs,
    errors::{AppError, AppResult},
};

const SETTINGS_FILE: &str = "python-env-settings.json";
const MODE_EXTERNAL_VENV: &str = "externalVenv";
const MODE_MANAGED_VENV: &str = "managedVenv";
const INSTALL_PROFILE_CPU: &str = "cpu";
const INSTALL_PROFILE_CUDA_121: &str = "cuda121";
const INSTALL_PROFILE_CUDA_124: &str = "cuda124";

const PROBE_SCRIPT: &str = r#"
import json
import platform
import sys

payload = {
    "pythonVersion": platform.python_version(),
    "executable": sys.executable,
    "torchAvailable": False,
    "cudaAvailable": False,
    "deviceNames": [],
}

try:
    import torch
    payload["torchAvailable"] = True
    payload["torchVersion"] = getattr(torch, "__version__", None)
    payload["cudaAvailable"] = bool(torch.cuda.is_available())
    payload["cudaVersion"] = getattr(torch.version, "cuda", None)
    if payload["cudaAvailable"]:
        payload["deviceNames"] = [
            torch.cuda.get_device_name(index)
            for index in range(torch.cuda.device_count())
        ]
except Exception as exc:
    payload["error"] = f"{type(exc).__name__}: {exc}"

print(json.dumps(payload, ensure_ascii=False))
"#;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvSettings {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub external_path: String,
    #[serde(default)]
    pub managed_path: String,
    #[serde(default = "default_install_profile")]
    pub install_profile: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvProbeReport {
    pub ok: bool,
    pub mode: String,
    pub python_path: Option<String>,
    pub managed_path: String,
    pub python_available: bool,
    pub python_version: Option<String>,
    pub torch_available: bool,
    pub torch_version: Option<String>,
    pub cuda_available: bool,
    pub cuda_version: Option<String>,
    pub device_names: Vec<String>,
    pub error: Option<String>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvInstallResult {
    pub success: bool,
    pub message: String,
    pub managed_path: String,
    pub python_path: Option<String>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbePayload {
    python_version: Option<String>,
    executable: Option<String>,
    torch_available: bool,
    torch_version: Option<String>,
    cuda_available: bool,
    cuda_version: Option<String>,
    #[serde(default)]
    device_names: Vec<String>,
    error: Option<String>,
}

struct CommandCapture {
    success: bool,
    stdout: String,
    stderr: String,
}

pub fn default_settings(dirs: &AppDirs) -> PythonEnvSettings {
    PythonEnvSettings {
        mode: default_mode(),
        external_path: String::new(),
        managed_path: managed_venv_path(dirs).to_string_lossy().to_string(),
        install_profile: default_install_profile(),
    }
}

pub fn load_settings(dirs: &AppDirs) -> AppResult<PythonEnvSettings> {
    let path = dirs.config.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(default_settings(dirs));
    }

    let settings: PythonEnvSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(normalize_settings(dirs, settings))
}

pub fn save_settings(dirs: &AppDirs, settings: PythonEnvSettings) -> AppResult<PythonEnvSettings> {
    let settings = normalize_settings(dirs, settings);
    let path = dirs.config.join(SETTINGS_FILE);
    fs::write(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

pub fn probe_environment(
    dirs: &AppDirs,
    settings: Option<PythonEnvSettings>,
) -> AppResult<PythonEnvProbeReport> {
    let settings = settings
        .map(|settings| normalize_settings(dirs, settings))
        .unwrap_or_else(|| load_settings(dirs).unwrap_or_else(|_| default_settings(dirs)));
    let managed_path = managed_venv_path(dirs).to_string_lossy().to_string();
    let python_path = resolve_python_path(dirs, &settings);

    let Some(python_path) = python_path else {
        return Ok(PythonEnvProbeReport {
            ok: false,
            mode: settings.mode,
            python_path: None,
            managed_path,
            python_available: false,
            python_version: None,
            torch_available: false,
            torch_version: None,
            cuda_available: false,
            cuda_version: None,
            device_names: Vec::new(),
            error: Some("未找到可用的 Python 解释器".to_owned()),
            stdout: String::new(),
            stderr: String::new(),
        });
    };

    let output = match Command::new(&python_path)
        .arg("-c")
        .arg(PROBE_SCRIPT)
        .env("PYTHONIOENCODING", "utf-8")
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return Ok(PythonEnvProbeReport {
                ok: false,
                mode: settings.mode,
                python_path: Some(python_path.to_string_lossy().to_string()),
                managed_path,
                python_available: false,
                python_version: None,
                torch_available: false,
                torch_version: None,
                cuda_available: false,
                cuda_version: None,
                device_names: Vec::new(),
                error: Some(format!("Python 启动失败：{error}")),
                stdout: String::new(),
                stderr: String::new(),
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        return Ok(PythonEnvProbeReport {
            ok: false,
            mode: settings.mode,
            python_path: Some(python_path.to_string_lossy().to_string()),
            managed_path,
            python_available: false,
            python_version: None,
            torch_available: false,
            torch_version: None,
            cuda_available: false,
            cuda_version: None,
            device_names: Vec::new(),
            error: Some(if stderr.is_empty() {
                "Python 探测命令执行失败".to_owned()
            } else {
                stderr.clone()
            }),
            stdout,
            stderr,
        });
    }

    let payload: ProbePayload = serde_json::from_str(&stdout).map_err(|error| {
        AppError::InvalidInput(format!("Python 探测结果解析失败：{error}"))
    })?;
    let torch_available = payload.torch_available;
    let error = payload.error;
    Ok(PythonEnvProbeReport {
        ok: torch_available,
        mode: settings.mode,
        python_path: Some(
            payload
                .executable
                .unwrap_or_else(|| python_path.to_string_lossy().to_string()),
        ),
        managed_path,
        python_available: true,
        python_version: payload.python_version,
        torch_available,
        torch_version: payload.torch_version,
        cuda_available: payload.cuda_available,
        cuda_version: payload.cuda_version,
        device_names: payload.device_names,
        error,
        stdout,
        stderr,
    })
}

pub fn create_managed_environment(dirs: &AppDirs) -> AppResult<PythonEnvInstallResult> {
    let managed_path = managed_venv_path(dirs);
    if let Some(python_path) = python_executable_from_venv(&managed_path) {
        return Ok(PythonEnvInstallResult {
            success: true,
            message: "独立 Python 环境已存在".to_owned(),
            managed_path: managed_path.to_string_lossy().to_string(),
            python_path: Some(python_path.to_string_lossy().to_string()),
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    if let Some(parent) = managed_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut diagnostics = Vec::new();
    for attempt in venv_creation_attempts(&managed_path) {
        match run_capture(&attempt.program, &attempt.args) {
            Ok(capture) if capture.success => {
                let python_path = python_executable_from_venv(&managed_path);
                return Ok(PythonEnvInstallResult {
                    success: python_path.is_some(),
                    message: if python_path.is_some() {
                        "独立 Python 环境创建完成".to_owned()
                    } else {
                        "venv 命令完成，但未找到 Python 解释器".to_owned()
                    },
                    managed_path: managed_path.to_string_lossy().to_string(),
                    python_path: python_path.map(|path| path.to_string_lossy().to_string()),
                    stdout: capture.stdout,
                    stderr: capture.stderr,
                });
            }
            Ok(capture) => {
                diagnostics.push(format!(
                    "{} {:?}\n{}{}",
                    attempt.program, attempt.args, capture.stdout, capture.stderr
                ));
            }
            Err(error) => diagnostics.push(format!(
                "{} {:?}\n{}",
                attempt.program, attempt.args, error
            )),
        }
    }

    Ok(PythonEnvInstallResult {
        success: false,
        message: "无法创建独立 Python 环境，请确认系统已安装 Python 3".to_owned(),
        managed_path: managed_path.to_string_lossy().to_string(),
        python_path: None,
        stdout: diagnostics.join("\n\n"),
        stderr: String::new(),
    })
}

pub fn install_managed_dependencies(
    dirs: &AppDirs,
    install_profile: Option<String>,
) -> AppResult<PythonEnvInstallResult> {
    let managed_path = managed_venv_path(dirs);
    let Some(python_path) = python_executable_from_venv(&managed_path) else {
        return Ok(PythonEnvInstallResult {
            success: false,
            message: "独立 Python 环境尚未创建".to_owned(),
            managed_path: managed_path.to_string_lossy().to_string(),
            python_path: None,
            stdout: String::new(),
            stderr: String::new(),
        });
    };

    let profile = normalize_install_profile(install_profile.as_deref().unwrap_or(""));
    let upgrade = run_capture(
        &python_path.to_string_lossy(),
        &["-m", "pip", "install", "--upgrade", "pip"]
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>(),
    )?;
    if !upgrade.success {
        return Ok(PythonEnvInstallResult {
            success: false,
            message: "pip 更新失败".to_owned(),
            managed_path: managed_path.to_string_lossy().to_string(),
            python_path: Some(python_path.to_string_lossy().to_string()),
            stdout: upgrade.stdout,
            stderr: upgrade.stderr,
        });
    }

    let mut args = vec![
        "-m".to_owned(),
        "pip".to_owned(),
        "install".to_owned(),
        "torch".to_owned(),
        "torchvision".to_owned(),
    ];
    let index_url = torch_index_url(&profile);
    if let Some(index_url) = index_url {
        args.push("--index-url".to_owned());
        args.push(index_url.to_owned());
    }

    let install = run_capture(&python_path.to_string_lossy(), &args)?;
    Ok(PythonEnvInstallResult {
        success: install.success,
        message: if install.success {
            "PyTorch 依赖安装完成".to_owned()
        } else {
            "PyTorch 依赖安装失败".to_owned()
        },
        managed_path: managed_path.to_string_lossy().to_string(),
        python_path: Some(python_path.to_string_lossy().to_string()),
        stdout: [upgrade.stdout, install.stdout]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        stderr: [upgrade.stderr, install.stderr]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

fn default_mode() -> String {
    MODE_MANAGED_VENV.to_owned()
}

fn default_install_profile() -> String {
    INSTALL_PROFILE_CUDA_121.to_owned()
}

fn normalize_settings(dirs: &AppDirs, mut settings: PythonEnvSettings) -> PythonEnvSettings {
    settings.mode = match settings.mode.as_str() {
        MODE_EXTERNAL_VENV | MODE_MANAGED_VENV => settings.mode,
        _ => MODE_MANAGED_VENV.to_owned(),
    };
    settings.external_path = settings.external_path.trim().to_owned();
    settings.managed_path = managed_venv_path(dirs).to_string_lossy().to_string();
    settings.install_profile = normalize_install_profile(&settings.install_profile);
    settings
}

fn normalize_install_profile(profile: &str) -> String {
    match profile {
        INSTALL_PROFILE_CPU | INSTALL_PROFILE_CUDA_124 => profile.to_owned(),
        _ => INSTALL_PROFILE_CUDA_121.to_owned(),
    }
}

fn managed_venv_path(dirs: &AppDirs) -> PathBuf {
    dirs.runtime.join("python").join("venv")
}

fn resolve_python_path(dirs: &AppDirs, settings: &PythonEnvSettings) -> Option<PathBuf> {
    match settings.mode.as_str() {
        MODE_EXTERNAL_VENV => python_executable_from_path(&PathBuf::from(&settings.external_path)),
        MODE_MANAGED_VENV => python_executable_from_venv(&managed_venv_path(dirs)),
        _ => None,
    }
}

fn python_executable_from_path(path: &Path) -> Option<PathBuf> {
    if looks_like_python_file(path) && path.is_file() {
        return Some(path.to_path_buf());
    }
    if path.is_dir() {
        return python_candidates(path)
            .into_iter()
            .find(|candidate| candidate.is_file());
    }
    None
}

fn python_executable_from_venv(path: &Path) -> Option<PathBuf> {
    python_candidates(path)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn python_candidates(path: &Path) -> Vec<PathBuf> {
    vec![
        path.join("python.exe"),
        path.join("Scripts").join("python.exe"),
        path.join("python_embeded").join("python.exe"),
        path.join("venv").join("Scripts").join("python.exe"),
        path.join(".venv").join("Scripts").join("python.exe"),
        path.join("bin").join("python"),
        path.join("bin").join("python3"),
        path.join("venv").join("bin").join("python"),
        path.join(".venv").join("bin").join("python"),
    ]
}

fn looks_like_python_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("python.exe") || name == "python")
        .unwrap_or(false)
}

fn torch_index_url(profile: &str) -> Option<&'static str> {
    match profile {
        INSTALL_PROFILE_CPU => Some("https://download.pytorch.org/whl/cpu"),
        INSTALL_PROFILE_CUDA_124 => Some("https://download.pytorch.org/whl/cu124"),
        _ => Some("https://download.pytorch.org/whl/cu121"),
    }
}

struct VenvCreationAttempt {
    program: String,
    args: Vec<String>,
}

fn venv_creation_attempts(path: &Path) -> Vec<VenvCreationAttempt> {
    let path = path.to_string_lossy().to_string();
    vec![
        VenvCreationAttempt {
            program: "py".to_owned(),
            args: vec!["-3".to_owned(), "-m".to_owned(), "venv".to_owned(), path.clone()],
        },
        VenvCreationAttempt {
            program: "python".to_owned(),
            args: vec!["-m".to_owned(), "venv".to_owned(), path.clone()],
        },
        VenvCreationAttempt {
            program: "python3".to_owned(),
            args: vec!["-m".to_owned(), "venv".to_owned(), path],
        },
    ]
}

fn run_capture(program: &str, args: &[String]) -> AppResult<CommandCapture> {
    let output = Command::new(program)
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .output()?;
    Ok(CommandCapture {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    })
}
