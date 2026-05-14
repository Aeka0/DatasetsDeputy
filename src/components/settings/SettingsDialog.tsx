import {
  Check,
  ChevronDown,
  Globe2,
  HardDrive,
  Languages,
  MonitorCog,
  Settings2,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import i18next from "../../i18n";
import { cn } from "../../lib/cn";
import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import {
  getBottomUiOpacity,
  getThemePreference,
  getTopUiOpacity,
  getUiAnimationPreference,
  setThemePreference,
  setBottomUiOpacity,
  setTopUiOpacity,
  setUiAnimationPreference,
  watchUiOpacity,
  watchUiAnimationPreference,
  watchThemePreference,
  type ThemePreference,
  type UiAnimationPreference
} from "../../lib/theme";
import { useDatasetStore } from "../../stores/datasetStore";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

type SettingsSectionKey =
  | "general"
  | "language"
  | "network"
  | "localFiles"
  | "appearance";
type NetworkSectionKey = "gemini" | "proxy" | "imageTransfer";
type LocalFilesSectionKey = "environment" | "models" | "tempFiles";

interface SettingsSection {
  key: SettingsSectionKey;
  labelKey: string;
  icon: typeof Settings2;
}

const sections: SettingsSection[] = [
  { key: "general", labelKey: "settings.general", icon: Settings2 },
  { key: "language", labelKey: "settings.language", icon: Languages },
  { key: "network", labelKey: "settings.network", icon: Wifi },
  { key: "localFiles", labelKey: "settings.localFiles", icon: HardDrive },
  { key: "appearance", labelKey: "settings.appearance", icon: MonitorCog }
];

const languageOptions = [
  { value: "zh-CN", labelKey: "settings.simplifiedChinese" },
  { value: "en-US", labelKey: "settings.english" }
];

const themeOptions: Array<{ value: ThemePreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" }
];

const uiAnimationOptions: Array<{ value: UiAnimationPreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.uiAnimationSystem" },
  { value: "on", labelKey: "settings.uiAnimationOn" },
  { value: "off", labelKey: "settings.uiAnimationOff" }
];

interface GeminiSettings {
  apiKey: string;
  model: string;
  availableModels: string[];
  rpmLimit: number;
  useProxy: boolean;
  proxyPort: string;
  imageResizeMode: string;
  imageConvertFormat: string;
}

type PythonEnvMode = "externalVenv" | "managedVenv";
type PythonEnvInstallProfile = "cpu" | "cuda128" | "cuda130";
type OnnxRuntimeInstallProfile = "cpu" | "cuda" | "directml";

interface PythonEnvSettings {
  mode: PythonEnvMode;
  externalPath: string;
  managedPath: string;
  installProfile: PythonEnvInstallProfile;
  onnxInstallProfile: OnnxRuntimeInstallProfile;
}

interface PythonEnvProbeReport {
  ok: boolean;
  mode: PythonEnvMode;
  pythonPath?: string;
  managedPath: string;
  pythonAvailable: boolean;
  pythonVersion?: string;
  torchAvailable: boolean;
  torchVersion?: string;
  torchError?: string;
  cudaAvailable: boolean;
  cudaVersion?: string;
  deviceNames: string[];
  onnxRuntimeAvailable: boolean;
  onnxRuntimeVersion?: string;
  onnxRuntimeProviders: string[];
  onnxRuntimeError?: string;
  error?: string;
  stdout: string;
  stderr: string;
}

interface PythonEnvInstallResult {
  success: boolean;
  message: string;
  managedPath: string;
  pythonPath?: string;
  stdout: string;
  stderr: string;
}

interface ModelSettings {
  wd14Tagger: Wd14TaggerSettings;
}

interface ModelPathSelection {
  path: string;
  modelType: Wd14TaggerSettings["modelType"];
}

interface Wd14TaggerSettings {
  modelPath: string;
  modelType: "pytorch" | "onnx" | "unknown";
  addCharacterTags: boolean;
  addCopyrightTags: boolean;
  replaceUnderscoresWithSpaces: boolean;
  generalThreshold: number;
  characterThreshold: number;
}

interface ThumbnailCacheInfo {
  sizeBytes: number;
}

interface ThumbnailSettings {
  thumbnailSize: number;
}

interface LogFilesInfo {
  sizeBytes: number;
}

const defaultGeminiSettings: GeminiSettings = {
  apiKey: "",
  model: "gemini-flash-latest",
  availableModels: ["gemini-flash-latest", "gemini-pro-latest"],
  rpmLimit: 0,
  useProxy: false,
  proxyPort: "7890",
  imageResizeMode: "none",
  imageConvertFormat: "none"
};

const defaultPythonEnvSettings: PythonEnvSettings = {
  mode: "managedVenv",
  externalPath: "",
  managedPath: "",
  installProfile: "cuda128",
  onnxInstallProfile: "directml"
};

const defaultModelSettings: ModelSettings = {
  wd14Tagger: {
    modelPath: "",
    modelType: "unknown",
    addCharacterTags: true,
    addCopyrightTags: false,
    replaceUnderscoresWithSpaces: true,
    generalThreshold: 0.7,
    characterThreshold: 0.9
  }
};

const defaultThumbnailSettings: ThumbnailSettings = {
  thumbnailSize: 256
};

const thumbnailSizeOptions = [
  { value: "128", label: "128 px" },
  { value: "192", label: "192 px" },
  { value: "256", label: "256 px" },
  { value: "384", label: "384 px" },
  { value: "512", label: "512 px" }
];

const pythonEnvModeOptions: Array<{ value: PythonEnvMode; labelKey: string }> = [
  { value: "managedVenv", labelKey: "settings.pythonEnvModeManaged" },
  { value: "externalVenv", labelKey: "settings.pythonEnvModeExternal" }
];

const pythonInstallProfileOptions: Array<{
  value: PythonEnvInstallProfile;
  labelKey: string;
}> = [
  { value: "cuda128", labelKey: "settings.pythonInstallCuda128" },
  { value: "cuda130", labelKey: "settings.pythonInstallCuda130" },
  { value: "cpu", labelKey: "settings.pythonInstallCpu" }
];

const onnxInstallProfileOptions: Array<{
  value: OnnxRuntimeInstallProfile;
  labelKey: string;
}> = [
  { value: "directml", labelKey: "settings.onnxInstallDirectml" },
  { value: "cuda", labelKey: "settings.onnxInstallCuda" },
  { value: "cpu", labelKey: "settings.onnxInstallCpu" }
];

const resizeOptions = [
  { value: "none", labelKey: "settings.geminiResizeNone" },
  { value: "loose", labelKey: "settings.geminiResizeLoose" },
  { value: "normal", labelKey: "settings.geminiResizeNormal" },
  { value: "high", labelKey: "settings.geminiResizeHigh" },
  { value: "extreme", labelKey: "settings.geminiResizeExtreme" }
];

const convertFormatOptions = [
  { value: "none", labelKey: "settings.geminiFormatNone" },
  { value: "webp", labelKey: "settings.geminiFormatWebp" },
  { value: "jpeg", labelKey: "settings.geminiFormatJpeg" }
];


interface SettingsDialogProps {
  onClose: () => void;
}

interface SelectOption {
  value: string;
  label: string;
}

interface SettingsSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

function SettingsSelect({ value, options, onChange, className = "" }: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`no-drag relative ${className}`}>
      <button
        type="button"
        className="glass-input flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{selectedOption?.label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-neutral-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="app-dropdown-menu absolute left-0 top-9 z-[70] min-w-full rounded-lg py-2">
          <div className="app-dropdown-backdrop" />
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition hover:bg-neutral-100 ${
                  selected ? "text-neutral-950" : "text-neutral-600"
                }`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {selected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { i18n, t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const [activeNetworkSection, setActiveNetworkSection] =
    useState<NetworkSectionKey>("gemini");
  const [activeLocalFilesSection, setActiveLocalFilesSection] =
    useState<LocalFilesSectionKey>("environment");
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getThemePreference);
  const [uiAnimationPreference, setUiAnimationPreferenceState] =
    useState<UiAnimationPreference>(getUiAnimationPreference);
  const [bottomUiOpacity, setBottomUiOpacityState] = useState(getBottomUiOpacity);
  const [topUiOpacity, setTopUiOpacityState] = useState(getTopUiOpacity);
  const [geminiSettings, setGeminiSettings] =
    useState<GeminiSettings>(defaultGeminiSettings);
  const [geminiMessage, setGeminiMessage] = useState("");
  const [isGeminiBusy, setIsGeminiBusy] = useState(false);
  const [hasLoadedGeminiSettings, setHasLoadedGeminiSettings] = useState(false);
  const [pythonEnvSettings, setPythonEnvSettings] =
    useState<PythonEnvSettings>(defaultPythonEnvSettings);
  const [pythonEnvProbe, setPythonEnvProbe] = useState<PythonEnvProbeReport>();
  const [pythonEnvMessage, setPythonEnvMessage] = useState("");
  const [isPythonEnvBusy, setIsPythonEnvBusy] = useState(false);
  const [hasLoadedPythonEnvSettings, setHasLoadedPythonEnvSettings] = useState(false);
  const [modelSettings, setModelSettings] =
    useState<ModelSettings>(defaultModelSettings);
  const [modelSettingsMessage, setModelSettingsMessage] = useState("");
  const [isModelSettingsBusy, setIsModelSettingsBusy] = useState(false);
  const [hasLoadedModelSettings, setHasLoadedModelSettings] = useState(false);
  const [thumbnailSettings, setThumbnailSettings] =
    useState<ThumbnailSettings>(defaultThumbnailSettings);
  const [hasLoadedThumbnailSettings, setHasLoadedThumbnailSettings] = useState(false);
  const {
    highlightCellState,
    autoSaveAfterAnnotation,
    autoSaveAfterBatch,
    setHighlightCellState,
    setAutoSaveAfterAnnotation,
    setAutoSaveAfterBatch,
    refreshImages,
    bumpThumbnailCacheKey
  } = useDatasetStore(
    useShallow((state) => ({
      highlightCellState: state.highlightCellState,
      autoSaveAfterAnnotation: state.autoSaveAfterAnnotation,
      autoSaveAfterBatch: state.autoSaveAfterBatch,
      setHighlightCellState: state.setHighlightCellState,
      setAutoSaveAfterAnnotation: state.setAutoSaveAfterAnnotation,
      setAutoSaveAfterBatch: state.setAutoSaveAfterBatch,
      refreshImages: state.refreshImages,
      bumpThumbnailCacheKey: state.bumpThumbnailCacheKey
    }))
  );
  const [thumbnailCacheInfo, setThumbnailCacheInfo] =
    useState<ThumbnailCacheInfo>({ sizeBytes: 0 });
  const [logFilesInfo, setLogFilesInfo] = useState<LogFilesInfo>({ sizeBytes: 0 });
  const [isTemporaryFilesBusy, setIsTemporaryFilesBusy] = useState(false);
  const [localFilesMessage, setLocalFilesMessage] = useState("");
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  const currentLanguage = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";

  useEffect(() => watchThemePreference(setThemePreferenceState), []);
  useEffect(() => watchUiAnimationPreference(setUiAnimationPreferenceState), []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<GeminiSettings>("get_gemini_settings")
      .then((settings) => {
        setGeminiSettings(settings);
        setHasLoadedGeminiSettings(true);
      })
      .catch((error) => setGeminiMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<PythonEnvSettings>("get_python_env_settings")
      .then((settings) => {
        setPythonEnvSettings(settings);
        setHasLoadedPythonEnvSettings(true);
      })
      .catch((error) => setPythonEnvMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ModelSettings>("get_model_settings")
      .then((settings) => {
        setModelSettings(settings);
        setHasLoadedModelSettings(true);
      })
      .catch((error) => setModelSettingsMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ThumbnailSettings>("get_thumbnail_settings")
      .then((settings) => {
        setThumbnailSettings(settings);
        setHasLoadedThumbnailSettings(true);
      })
      .catch((error) => setLocalFilesMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedGeminiSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<GeminiSettings>("save_gemini_settings", {
        settings: geminiSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setGeminiMessage(t("settings.geminiActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [geminiSettings, hasLoadedGeminiSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedPythonEnvSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<PythonEnvSettings>("save_python_env_settings", {
        settings: pythonEnvSettings
      })
        .catch((error) => {
          const message = formatAppError(error);
          setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [pythonEnvSettings, hasLoadedPythonEnvSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedModelSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<ModelSettings>("save_model_settings", {
        settings: modelSettings
      })
        .then((savedSettings) => {
          if (JSON.stringify(savedSettings) !== JSON.stringify(modelSettings)) {
            setModelSettings(savedSettings);
          }
        })
        .catch((error) => {
          const message = formatAppError(error);
          setModelSettingsMessage(t("settings.modelSettingsActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [modelSettings, hasLoadedModelSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedThumbnailSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<ThumbnailSettings>("save_thumbnail_settings", {
        settings: thumbnailSettings
      })
        .then((savedSettings) => {
          if (savedSettings.thumbnailSize !== thumbnailSettings.thumbnailSize) {
            setThumbnailSettings(savedSettings);
          }
        })
        .catch((error) => {
          const message = formatAppError(error);
          setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [thumbnailSettings, hasLoadedThumbnailSettings]);
  useEffect(
    () =>
      watchUiOpacity(() => {
        setBottomUiOpacityState(getBottomUiOpacity());
        setTopUiOpacityState(getTopUiOpacity());
      }),
    []
  );

  const updateThemePreference = (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    setThemePreference(preference);
  };

  const updateUiAnimationPreference = (preference: UiAnimationPreference) => {
    setUiAnimationPreferenceState(preference);
    setUiAnimationPreference(preference);
  };

  const updateBottomUiOpacity = (value: number) => {
    setBottomUiOpacityState(value);
    setBottomUiOpacity(value);
  };

  const updateTopUiOpacity = (value: number) => {
    setTopUiOpacityState(value);
    setTopUiOpacity(value);
  };

  const patchGeminiSettings = (patch: Partial<GeminiSettings>) => {
    setGeminiSettings((current) => ({ ...current, ...patch }));
  };

  const patchPythonEnvSettings = (patch: Partial<PythonEnvSettings>) => {
    setPythonEnvSettings((current) => ({ ...current, ...patch }));
    setPythonEnvProbe(undefined);
  };

  const patchWd14TaggerSettings = (patch: Partial<Wd14TaggerSettings>) => {
    setModelSettings((current) => ({
      ...current,
      wd14Tagger: {
        ...current.wd14Tagger,
        ...patch
      }
    }));
    setModelSettingsMessage("");
  };

  const runGeminiAction = async (action: "fetch" | "test") => {
    if (!hasTauriRuntime() || isGeminiBusy) return;

    setIsGeminiBusy(true);
    setGeminiMessage("");
    try {
      if (action === "fetch") {
        const models = await invokeCommand<string[]>("fetch_gemini_models", {
          settings: geminiSettings
        });
        const nextSettings = {
          ...geminiSettings,
          availableModels: models,
          model: models[0] ?? geminiSettings.model
        };
        setGeminiSettings(nextSettings);
        setGeminiMessage(t("settings.geminiModelsFetched", { count: models.length }));
        return;
      }

      const count = await invokeCommand<number>("test_gemini_connection", {
        settings: geminiSettings
      });
      setGeminiMessage(t("settings.geminiConnectionOk", { count }));
    } catch (error) {
      const message = formatAppError(error);
      setGeminiMessage(t("settings.geminiActionFailed", { message }));
    } finally {
      setIsGeminiBusy(false);
    }
  };

  const pickPythonEnvPath = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    setIsPythonEnvBusy(true);
    setPythonEnvMessage("");
    try {
      const path = await invokeCommand<string>("pick_python_env_path");
      patchPythonEnvSettings({ mode: "externalVenv", externalPath: path });
      setPythonEnvMessage(t("settings.pythonEnvPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
      }
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const inferWd14ModelType = (path: string): Wd14TaggerSettings["modelType"] => {
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension === "onnx") return "onnx";
    if (["pt", "pth", "safetensors", "bin"].includes(extension ?? "")) return "pytorch";
    return "unknown";
  };

  const updateWd14ModelPath = (path: string) => {
    patchWd14TaggerSettings({
      modelPath: path,
      modelType: inferWd14ModelType(path)
    });
  };

  const pickWd14ModelPath = async () => {
    if (!hasTauriRuntime() || isModelSettingsBusy) return;

    setIsModelSettingsBusy(true);
    setModelSettingsMessage("");
    try {
      const selection = await invokeCommand<ModelPathSelection>("pick_wd14_model_path");
      patchWd14TaggerSettings({
        modelPath: selection.path,
        modelType: selection.modelType
      });
      setModelSettingsMessage(t("settings.modelPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setModelSettingsMessage(t("settings.modelSettingsActionFailed", { message }));
      }
    } finally {
      setIsModelSettingsBusy(false);
    }
  };

  const probePythonEnv = async (settings = pythonEnvSettings) => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    setIsPythonEnvBusy(true);
    setPythonEnvMessage("");
    try {
      const report = await invokeCommand<PythonEnvProbeReport>("probe_python_env", {
        settings
      });
      setPythonEnvProbe(report);
      setPythonEnvMessage(
        report.ok
          ? t("settings.pythonEnvProbeOk")
          : t("settings.pythonEnvProbeFailed", {
              message: report.error ?? t("settings.pythonEnvUnknownError")
            })
      );
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const installManagedPythonDeps = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    const confirmed = window.confirm(t("settings.pythonDepsInstallConfirm"));
    if (!confirmed) return;

    const nextSettings: PythonEnvSettings = {
      ...pythonEnvSettings,
      mode: "managedVenv"
    };
    setPythonEnvSettings(nextSettings);
    setPythonEnvProbe(undefined);
    setIsPythonEnvBusy(true);
    setPythonEnvMessage(t("settings.pythonEnvInstalling"));
    try {
      const installResult = await invokeCommand<PythonEnvInstallResult>(
        "install_managed_python_deps",
        {
          installProfile: nextSettings.installProfile
        }
      );
      setPythonEnvMessage(installResult.message);
      if (installResult.success) {
        setPythonEnvSettings((current) => ({
          ...current,
          mode: "managedVenv",
          managedPath: installResult.managedPath
        }));
        await probePythonEnv({
          ...nextSettings,
          managedPath: installResult.managedPath
        });
      }
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const installManagedOnnxDeps = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    const confirmed = window.confirm(t("settings.onnxDepsInstallConfirm"));
    if (!confirmed) return;

    const nextSettings: PythonEnvSettings = {
      ...pythonEnvSettings,
      mode: "managedVenv"
    };
    setPythonEnvSettings(nextSettings);
    setPythonEnvProbe(undefined);
    setIsPythonEnvBusy(true);
    setPythonEnvMessage(t("settings.onnxRuntimeInstalling"));
    try {
      const installResult = await invokeCommand<PythonEnvInstallResult>(
        "install_managed_onnx_deps",
        {
          installProfile: nextSettings.onnxInstallProfile
        }
      );
      setPythonEnvMessage(installResult.message);
      if (installResult.success) {
        setPythonEnvSettings((current) => ({
          ...current,
          mode: "managedVenv",
          managedPath: installResult.managedPath
        }));
        await probePythonEnv({
          ...nextSettings,
          managedPath: installResult.managedPath
        });
      }
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const refreshTemporaryFilesInfo = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const [thumbnailInfo, logInfo] = await Promise.all([
        invokeCommand<ThumbnailCacheInfo>("get_thumbnail_cache_info"),
        invokeCommand<LogFilesInfo>("get_log_files_info")
      ]);
      setThumbnailCacheInfo(thumbnailInfo);
      setLogFilesInfo(logInfo);
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  const clearThumbnailCache = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<ThumbnailCacheInfo>("clear_thumbnail_cache");
      setThumbnailCacheInfo(info);
      await refreshImages();
      bumpThumbnailCacheKey();
      const refreshedInfo = await invokeCommand<ThumbnailCacheInfo>("get_thumbnail_cache_info");
      setThumbnailCacheInfo(refreshedInfo);
      setLocalFilesMessage(t("settings.thumbnailCacheCleared"));
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  const clearLogFiles = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<LogFilesInfo>("clear_log_files");
      setLogFilesInfo(info);
      setLocalFilesMessage(t("settings.logFilesCleared"));
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  useEffect(() => {
    if (activeSection === "localFiles" && activeLocalFilesSection === "tempFiles") {
      void refreshTemporaryFilesInfo();
    }
  }, [activeSection, activeLocalFilesSection]);

  const torchDeviceSummary = pythonEnvProbe
    ? pythonEnvProbe.cudaAvailable
      ? [
          t("settings.pythonEnvCudaAvailable", {
            version: pythonEnvProbe.cudaVersion ?? "-"
          }),
          pythonEnvProbe.deviceNames.length > 0
            ? pythonEnvProbe.deviceNames.join(", ")
            : undefined
        ]
          .filter(Boolean)
          .join(" / ")
      : t("settings.pythonEnvCudaUnavailable")
    : "-";
  const onnxProviderSummary = pythonEnvProbe?.onnxRuntimeProviders.length
    ? pythonEnvProbe.onnxRuntimeProviders.join(", ")
    : "-";

  return (
    <AnimatedPortal open={open}>
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5"
    >
      <section
        className="flex h-[560px] w-full max-w-[820px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/90">
          <div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-4">
            <Globe2 size={17} className="text-neutral-700" />
            <h2 id="settings-title" className="m-0 text-[15px] font-semibold text-neutral-950">
              {t("settings.title")}
            </h2>
          </div>

          <nav className="flex-1 space-y-1 px-2 py-3" aria-label={t("settings.categoryLabel")}>
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.key === activeSection;

              return (
                <button
                  key={section.key}
                  type="button"
                  className={cn(
                    "sidebar-nav-button flex h-9 w-full items-center gap-2 rounded px-3 text-left text-[13px] transition",
                    isActive && "sidebar-nav-button-active"
                  )}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveSection(section.key)}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{t(section.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-neutral-950">
                {t(active.labelKey)}
              </div>
            </div>
            <Button
              type="button"
              variant="icon"
              className="shrink-0"
              aria-label={t("settings.close")}
              title={t("menu.close")}
              onClick={close}
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            </Button>
          </header>

          <div
            className="hover-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-neutral-50/42 p-5"
          >
            {activeSection === "general" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.highlightCellState")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.highlightCellStateDescription")}
                    </div>
                  </div>
                  <Switch
                    aria-label={t("settings.highlightCellState")}
                    checked={highlightCellState}
                    onCheckedChange={setHighlightCellState}
                  />
                  </div>
                  <div className="flex min-h-12 items-center justify-between gap-4 border-t border-neutral-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900">
                        {t("settings.autoSaveAfterAnnotation")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.autoSaveAfterAnnotationDescription")}
                      </div>
                    </div>
                    <Switch
                      aria-label={t("settings.autoSaveAfterAnnotation")}
                      checked={autoSaveAfterAnnotation}
                      onCheckedChange={setAutoSaveAfterAnnotation}
                    />
                  </div>
                  <div className="flex min-h-12 items-center justify-between gap-4 border-t border-neutral-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900">
                        {t("settings.autoSaveAfterBatch")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.autoSaveAfterBatchDescription")}
                      </div>
                    </div>
                    <Switch
                      aria-label={t("settings.autoSaveAfterBatch")}
                      checked={autoSaveAfterBatch}
                      onCheckedChange={setAutoSaveAfterBatch}
                    />
                  </div>
                </div>
              ) : activeSection === "language" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.languageNative")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.languageDescription")}
                    </div>
                  </div>
                  <SettingsSelect
                    className="min-w-[150px]"
                    value={currentLanguage}
                    options={languageOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) => void i18next.changeLanguage(nextValue)}
                  />
                </div>
              </div>
            ) : activeSection === "localFiles" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1 border-b border-neutral-100 px-1.5">
                  {[
                    { key: "environment" as const, label: t("settings.localFilesEnvironment") },
                    { key: "models" as const, label: t("settings.localFilesModels") },
                    { key: "tempFiles" as const, label: t("settings.localFilesTempFiles") }
                  ].map((item) => {
                    const isActive = activeLocalFilesSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={cn(
                          "no-drag h-9 border-b-2 px-3 text-[13px] transition",
                          isActive
                            ? "border-neutral-900 text-neutral-950"
                            : "border-transparent text-neutral-500 hover:text-neutral-900"
                        )}
                        onClick={() => setActiveLocalFilesSection(item.key)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {activeLocalFilesSection === "environment" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3">
                      <div className="min-w-0 text-[13px] font-semibold text-neutral-900">
                        {t("settings.pythonEnvTitle")}
                      </div>
                      <button
                        type="button"
                        className="no-drag h-7 shrink-0 rounded-md border border-neutral-300 bg-white px-2.5 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isPythonEnvBusy}
                        onClick={() => void probePythonEnv()}
                      >
                        {t("settings.pythonEnvProbe")}
                      </button>
                    </div>

                    <div className="py-1">
                      <div className="grid min-h-11 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 px-3 py-2">
                        <div className="text-[12px] text-neutral-500">
                          {t("settings.pythonEnvMode")}
                        </div>
                        <SettingsSelect
                          value={pythonEnvSettings.mode}
                          options={pythonEnvModeOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchPythonEnvSettings({ mode: nextValue as PythonEnvMode })
                          }
                        />
                      </div>

                      <div className="grid min-h-11 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 px-3 py-2">
                        <div className="text-[12px] text-neutral-500">
                          {pythonEnvSettings.mode === "externalVenv"
                            ? t("settings.pythonEnvExternal")
                            : t("settings.runtimeManagedSource")}
                        </div>
                        {pythonEnvSettings.mode === "externalVenv" ? (
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_104px] gap-2">
                            <input
                              className="glass-input h-8 min-w-0 px-2.5 text-[13px]"
                              value={pythonEnvSettings.externalPath}
                              placeholder={t("settings.pythonEnvExternalPlaceholder")}
                              onChange={(event) =>
                                patchPythonEnvSettings({
                                  mode: "externalVenv",
                                  externalPath: event.target.value
                                })
                              }
                            />
                            <button
                              type="button"
                              className="no-drag h-8 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={isPythonEnvBusy}
                              onClick={() => void pickPythonEnvPath()}
                            >
                              {t("settings.pythonEnvPickFolder")}
                            </button>
                          </div>
                        ) : (
                          <div
                            className="min-w-0 truncate text-[12px] text-neutral-700"
                            title={
                              pythonEnvSettings.managedPath ||
                              t("settings.runtimeManagedPathPending")
                            }
                          >
                            {pythonEnvSettings.managedPath || t("settings.runtimeManagedPathPending")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="grid grid-cols-[112px_92px_120px_minmax(0,1fr)] border-b border-black/[0.06] px-3 py-2 text-[11px] font-semibold uppercase text-neutral-500">
                        <div>{t("settings.pythonEnvProbeResult")}</div>
                        <div>{t("settings.pythonEnvStatus")}</div>
                        <div>{t("settings.pythonEnvPythonVersion")}</div>
                        <div>{t("settings.pythonEnvDevices")}</div>
                      </div>

                      <div className="grid min-h-10 grid-cols-[112px_92px_120px_minmax(0,1fr)] items-center border-b border-black/[0.06] px-3 py-2 text-[12px]">
                        <div className="font-medium text-neutral-900">
                          {t("settings.pytorchRuntime")}
                        </div>
                        <div
                          className={cn(
                            "font-medium",
                            pythonEnvProbe?.torchAvailable
                              ? "text-emerald-700"
                              : pythonEnvProbe
                                ? "text-amber-700"
                                : "text-neutral-500"
                          )}
                        >
                          {pythonEnvProbe
                            ? pythonEnvProbe.torchAvailable
                              ? t("settings.runtimeAvailable")
                              : t("settings.runtimeUnavailable")
                            : t("settings.runtimeNotChecked")}
                        </div>
                        <div className="min-w-0 truncate text-neutral-700">
                          {pythonEnvProbe?.torchVersion ?? "-"}
                        </div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={torchDeviceSummary}
                        >
                          {torchDeviceSummary}
                        </div>
                      </div>

                      <div className="grid min-h-10 grid-cols-[112px_92px_120px_minmax(0,1fr)] items-center px-3 py-2 text-[12px]">
                        <div className="font-medium text-neutral-900">
                          {t("settings.onnxRuntime")}
                        </div>
                        <div
                          className={cn(
                            "font-medium",
                            pythonEnvProbe?.onnxRuntimeAvailable
                              ? "text-emerald-700"
                              : pythonEnvProbe
                                ? "text-amber-700"
                                : "text-neutral-500"
                          )}
                        >
                          {pythonEnvProbe
                            ? pythonEnvProbe.onnxRuntimeAvailable
                              ? t("settings.runtimeAvailable")
                              : t("settings.runtimeUnavailable")
                            : t("settings.runtimeNotChecked")}
                        </div>
                        <div className="min-w-0 truncate text-neutral-700">
                          {pythonEnvProbe?.onnxRuntimeVersion ?? "-"}
                        </div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={onnxProviderSummary}
                        >
                          {onnxProviderSummary}
                        </div>
                      </div>
                    </div>

                    {pythonEnvSettings.mode === "managedVenv" ? (
                      <div className="pt-2 pb-1">
                        <div className="grid grid-cols-[112px_minmax(0,180px)_96px] items-center gap-2 border-b border-black/[0.06] px-3 py-2">
                          <div className="text-[12px] font-medium text-neutral-900">
                            {t("settings.pytorchRuntime")}
                          </div>
                          <SettingsSelect
                            value={pythonEnvSettings.installProfile}
                            options={pythonInstallProfileOptions.map((option) => ({
                              value: option.value,
                              label: t(option.labelKey)
                            }))}
                            onChange={(nextValue) =>
                              patchPythonEnvSettings({
                                installProfile: nextValue as PythonEnvInstallProfile
                              })
                            }
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-2 text-[11px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isPythonEnvBusy}
                            onClick={() => void installManagedPythonDeps()}
                          >
                            {t("settings.runtimeInstall")}
                          </button>
                        </div>
                        <div className="grid grid-cols-[112px_minmax(0,180px)_96px] items-center gap-2 px-3 py-2">
                          <div className="text-[12px] font-medium text-neutral-900">
                            {t("settings.onnxRuntime")}
                          </div>
                          <SettingsSelect
                            value={pythonEnvSettings.onnxInstallProfile}
                            options={onnxInstallProfileOptions.map((option) => ({
                              value: option.value,
                              label: t(option.labelKey)
                            }))}
                            onChange={(nextValue) =>
                              patchPythonEnvSettings({
                                onnxInstallProfile: nextValue as OnnxRuntimeInstallProfile
                              })
                            }
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-2 text-[11px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isPythonEnvBusy}
                            onClick={() => void installManagedOnnxDeps()}
                          >
                            {t("settings.runtimeInstall")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="truncate px-3 py-2 text-[12px] text-neutral-500"
                        title={t("settings.runtimeExternalHint")}
                      >
                        {t("settings.runtimeExternalHint")}
                      </div>
                    )}

                    {pythonEnvProbe?.pythonPath || pythonEnvProbe?.pythonVersion ? (
                      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 border-t border-black/[0.06] px-3 py-2 text-[12px]">
                        <div className="text-neutral-500">{t("settings.pythonEnvPythonPath")}</div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={pythonEnvProbe.pythonPath ?? "-"}
                        >
                          {pythonEnvProbe.pythonPath ?? "-"}
                        </div>
                      </div>
                    ) : null}

                    {pythonEnvProbe?.torchError || pythonEnvProbe?.onnxRuntimeError || pythonEnvProbe?.error ? (
                      <div className="hover-scrollbar max-h-20 space-y-1 overflow-y-auto border-t border-black/[0.06] px-3 py-2 text-[12px] leading-5 text-amber-700">
                        {pythonEnvProbe.error ? <div className="break-words">{pythonEnvProbe.error}</div> : null}
                        {pythonEnvProbe.torchError ? (
                          <div className="break-words">{pythonEnvProbe.torchError}</div>
                        ) : null}
                        {pythonEnvProbe.onnxRuntimeError ? (
                          <div className="break-words">{pythonEnvProbe.onnxRuntimeError}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {pythonEnvMessage ? (
                      <div
                        className="truncate border-t border-black/[0.06] px-3 py-2 text-[12px] text-neutral-500"
                        title={pythonEnvMessage}
                      >
                        {pythonEnvMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeLocalFilesSection === "models" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3">
                      <div className="min-w-0 text-[13px] font-semibold text-neutral-900">
                        {t("settings.wd14Tagger")}
                      </div>
                      <div className="shrink-0 text-[12px] text-neutral-500">
                        {modelSettings.wd14Tagger.modelPath
                          ? t(`settings.modelType${modelSettings.wd14Tagger.modelType}`)
                          : t("settings.modelTypeUnset")}
                      </div>
                    </div>

                    <div className="divide-y divide-black/[0.06]">
                      <div className="grid min-h-12 grid-cols-[132px_minmax(0,1fr)_104px] items-center gap-2 px-3 py-2">
                        <div className="text-[12px] text-neutral-500">
                          {t("settings.wd14ModelPath")}
                        </div>
                        <input
                          className="glass-input h-8 min-w-0 px-2.5 text-[13px]"
                          value={modelSettings.wd14Tagger.modelPath}
                          placeholder={t("settings.wd14ModelPathPlaceholder")}
                          onChange={(event) => updateWd14ModelPath(event.target.value)}
                        />
                        <button
                          type="button"
                          className="no-drag h-8 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isModelSettingsBusy}
                          onClick={() => void pickWd14ModelPath()}
                        >
                          {t("settings.modelPickFile")}
                        </button>
                      </div>
                    </div>

                    {modelSettingsMessage ? (
                      <div
                        className="truncate border-t border-black/[0.06] px-3 py-2 text-[12px] text-neutral-500"
                        title={modelSettingsMessage}
                      >
                        {modelSettingsMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeLocalFilesSection === "tempFiles" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.thumbnailSize")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.thumbnailSizeDescription")}
                    </div>
                  </div>
                  <SettingsSelect
                    className="w-[128px] shrink-0"
                    value={String(thumbnailSettings.thumbnailSize)}
                    options={thumbnailSizeOptions}
                    onChange={(nextValue) =>
                      setThumbnailSettings({ thumbnailSize: Number(nextValue) })
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.thumbnailCache")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.thumbnailCacheDescription")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="min-w-20 text-right text-[13px] font-medium text-neutral-700">
                      {formatBytes(thumbnailCacheInfo.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy}
                      onClick={() => void refreshTemporaryFilesInfo()}
                    >
                      {t("settings.tempFilesRefresh")}
                    </button>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy || thumbnailCacheInfo.sizeBytes === 0}
                      onClick={() => void clearThumbnailCache()}
                    >
                      {t("settings.tempFilesClear")}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.logFiles")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.logFilesDescription")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="min-w-20 text-right text-[13px] font-medium text-neutral-700">
                      {formatBytes(logFilesInfo.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy || logFilesInfo.sizeBytes === 0}
                      onClick={() => void clearLogFiles()}
                    >
                      {t("settings.tempFilesClear")}
                    </button>
                  </div>
                </div>
                {localFilesMessage ? (
                  <div className="px-4 py-3 text-[12px] text-neutral-500">
                    {localFilesMessage}
                  </div>
                ) : null}
              </div>
                ) : null}
              </div>
            ) : activeSection === "appearance" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.theme")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.themeDescription")}
                    </div>
                  </div>
                  <SettingsSelect
                    className="min-w-[150px]"
                    value={themePreference}
                    options={themeOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) =>
                      updateThemePreference(nextValue as ThemePreference)
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.uiAnimation")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.uiAnimationDescription")}
                    </div>
                  </div>
                  <SettingsSelect
                    className="min-w-[150px]"
                    value={uiAnimationPreference}
                    options={uiAnimationOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) =>
                      updateUiAnimationPreference(nextValue as UiAnimationPreference)
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.bottomUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.bottomUiOpacityDescription")}
                    </div>
                  </div>
                  <div className="flex min-w-[210px] items-center gap-3">
                    <input
                      type="range"
                      min={70}
                      max={100}
                      value={bottomUiOpacity}
                      onChange={(event) => updateBottomUiOpacity(Number(event.target.value))}
                      className="no-drag w-full"
                    />
                    <span className="w-10 text-right text-[12px] text-neutral-500">
                      {bottomUiOpacity}%
                    </span>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.topUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.topUiOpacityDescription")}
                    </div>
                  </div>
                  <div className="flex min-w-[210px] items-center gap-3">
                    <input
                      type="range"
                      min={30}
                      max={100}
                      value={topUiOpacity}
                      onChange={(event) => updateTopUiOpacity(Number(event.target.value))}
                      className="no-drag w-full"
                    />
                    <span className="w-10 text-right text-[12px] text-neutral-500">
                      {topUiOpacity}%
                    </span>
                  </div>
                </div>
              </div>
            ) : activeSection === "network" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1 border-b border-neutral-100 px-1.5">
                  {[
                    { key: "gemini" as const, label: t("settings.networkGemini") },
                    { key: "proxy" as const, label: t("settings.networkProxyShort") },
                    { key: "imageTransfer" as const, label: t("settings.networkImageTransfer") }
                  ].map((item) => {
                    const isActive = activeNetworkSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={cn(
                          "no-drag h-9 border-b-2 px-3 text-[13px] transition",
                          isActive
                            ? "border-neutral-900 text-neutral-950"
                            : "border-transparent text-neutral-500 hover:text-neutral-900"
                        )}
                        onClick={() => setActiveNetworkSection(item.key)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {activeNetworkSection === "gemini" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">
                          {t("settings.geminiApi")}
                        </div>
                        <div className="mt-0.5 text-[12px] text-neutral-500">
                          {t("settings.geminiApiDescription")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="no-drag h-8 shrink-0 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isGeminiBusy}
                        onClick={() => void runGeminiAction("test")}
                      >
                        {t("settings.geminiTestConnection")}
                      </button>
                    </div>

                    <div className="space-y-3 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.geminiApiKey")}
                        </span>
                        <input
                          type="password"
                          className="glass-input h-8 w-full px-2.5 text-[13px]"
                          value={geminiSettings.apiKey}
                          placeholder={t("settings.geminiApiKeyPlaceholder")}
                          onChange={(event) => patchGeminiSettings({ apiKey: event.target.value })}
                        />
                      </label>

                      <div className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2">
                        <label className="block min-w-0">
                          <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                            {t("settings.geminiModel")}
                          </span>
                          <SettingsSelect
                            className="w-full"
                            value={geminiSettings.model}
                            options={geminiSettings.availableModels.map((model) => ({
                              value: model,
                              label: model
                            }))}
                            onChange={(nextValue) =>
                              patchGeminiSettings({ model: nextValue })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isGeminiBusy}
                          onClick={() => void runGeminiAction("fetch")}
                        >
                          {t("settings.geminiFetchModels")}
                        </button>
                      </div>

                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.geminiRpmLimit")}
                        </span>
                        <input
                          type="number"
                          min={0}
                          className="glass-input h-8 w-full px-2.5 text-[13px]"
                          value={geminiSettings.rpmLimit}
                          onChange={(event) =>
                            patchGeminiSettings({
                              rpmLimit: Math.max(0, Number(event.target.value) || 0)
                            })
                          }
                        />
                        <span className="mt-1 block text-[11px] text-neutral-500">
                          {t("settings.geminiRpmLimitDescription")}
                        </span>
                      </label>

                      {geminiMessage ? (
                        <div className="truncate text-[12px] text-neutral-500">
                          {geminiMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeNetworkSection === "proxy" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                  <div className="border-b border-neutral-100 px-4 py-3">
                    <div className="text-[13px] font-semibold text-neutral-900">
                      {t("settings.networkProxy")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.networkProxyDescription")}
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4 px-4 py-3">
                    <Switch
                      className="self-start pt-1"
                      checked={geminiSettings.useProxy}
                      label={t("settings.geminiUseProxy")}
                      onCheckedChange={(checked) => patchGeminiSettings({ useProxy: checked })}
                    />
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                        {t("settings.geminiProxyPort")}
                      </span>
                      <input
                        className="glass-input h-8 w-full px-2.5 text-[13px]"
                        value={geminiSettings.proxyPort}
                        disabled={!geminiSettings.useProxy}
                        onChange={(event) => patchGeminiSettings({ proxyPort: event.target.value })}
                      />
                      <span className="mt-1 block text-[11px] text-neutral-500">
                        {t("settings.geminiProxyPortDescription")}
                      </span>
                    </label>
                  </div>
                </div>
                ) : null}

                {activeNetworkSection === "imageTransfer" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="border-b border-neutral-100 px-4 py-3">
                      <div className="text-[13px] font-semibold text-neutral-900">
                        {t("settings.networkImageTransfer")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.networkImageTransferDescription")}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.geminiImageResize")}
                        </span>
                        <SettingsSelect
                          className="w-full"
                          value={geminiSettings.imageResizeMode}
                          options={resizeOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchGeminiSettings({ imageResizeMode: nextValue })
                          }
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.geminiImageFormat")}
                        </span>
                        <SettingsSelect
                          className="w-full"
                          value={geminiSettings.imageConvertFormat}
                          options={convertFormatOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchGeminiSettings({ imageConvertFormat: nextValue })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="h-full rounded-lg border border-dashed border-neutral-200 bg-white/72" />
            )}
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
