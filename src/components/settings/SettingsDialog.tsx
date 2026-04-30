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
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import i18next from "../../i18n";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import {
  getBottomUiOpacity,
  getThemePreference,
  getTopUiOpacity,
  setThemePreference,
  setBottomUiOpacity,
  setTopUiOpacity,
  watchUiOpacity,
  watchThemePreference,
  type ThemePreference
} from "../../lib/theme";
import { useDatasetStore } from "../../stores/datasetStore";
import { Button } from "../ui/Button";

type SettingsSectionKey =
  | "general"
  | "language"
  | "network"
  | "localFiles"
  | "appearance";
type NetworkSectionKey = "gemini" | "proxy" | "imageTransfer";
type LocalFilesSectionKey = "environment" | "cache";

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
type PythonEnvInstallProfile = "cpu" | "cuda121" | "cuda124";

interface PythonEnvSettings {
  mode: PythonEnvMode;
  externalPath: string;
  managedPath: string;
  installProfile: PythonEnvInstallProfile;
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
  cudaAvailable: boolean;
  cudaVersion?: string;
  deviceNames: string[];
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

interface ThumbnailCacheInfo {
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
  installProfile: "cuda121"
};

const pythonEnvModeOptions: Array<{ value: PythonEnvMode; labelKey: string }> = [
  { value: "managedVenv", labelKey: "settings.pythonEnvModeManaged" },
  { value: "externalVenv", labelKey: "settings.pythonEnvModeExternal" }
];

const pythonInstallProfileOptions: Array<{
  value: PythonEnvInstallProfile;
  labelKey: string;
}> = [
  { value: "cuda121", labelKey: "settings.pythonInstallCuda121" },
  { value: "cuda124", labelKey: "settings.pythonInstallCuda124" },
  { value: "cpu", labelKey: "settings.pythonInstallCpu" }
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

function formatByteSize(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

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
          className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
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
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition hover:bg-slate-100 ${
                  selected ? "text-slate-950" : "text-slate-600"
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
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const [activeNetworkSection, setActiveNetworkSection] =
    useState<NetworkSectionKey>("gemini");
  const [activeLocalFilesSection, setActiveLocalFilesSection] =
    useState<LocalFilesSectionKey>("environment");
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getThemePreference);
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
  const { highlightCellState, setHighlightCellState, refreshImages } = useDatasetStore();
  const [thumbnailCacheInfo, setThumbnailCacheInfo] =
    useState<ThumbnailCacheInfo>({ sizeBytes: 0 });
  const [isThumbnailCacheBusy, setIsThumbnailCacheBusy] = useState(false);
  const [localFilesMessage, setLocalFilesMessage] = useState("");
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  const currentLanguage = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";

  useEffect(() => watchThemePreference(setThemePreferenceState), []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<GeminiSettings>("get_gemini_settings")
      .then((settings) => {
        setGeminiSettings(settings);
        setHasLoadedGeminiSettings(true);
      })
      .catch((error) => setGeminiMessage(String(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<PythonEnvSettings>("get_python_env_settings")
      .then((settings) => {
        setPythonEnvSettings(settings);
        setHasLoadedPythonEnvSettings(true);
      })
      .catch((error) => setPythonEnvMessage(String(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedGeminiSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<GeminiSettings>("save_gemini_settings", {
        settings: geminiSettings
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
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
          const message = error instanceof Error ? error.message : String(error);
          setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [pythonEnvSettings, hasLoadedPythonEnvSettings]);
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
      const message = error instanceof Error ? error.message : String(error);
      setGeminiMessage(t("settings.geminiActionFailed", { message }));
    } finally {
      setIsGeminiBusy(false);
    }
  };

  const pickPythonEnvPath = async (selectionMode: "folder" | "file") => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    setIsPythonEnvBusy(true);
    setPythonEnvMessage("");
    try {
      const path = await invokeCommand<string>("pick_python_env_path", {
        selectionMode
      });
      patchPythonEnvSettings({ mode: "externalVenv", externalPath: path });
      setPythonEnvMessage(t("settings.pythonEnvPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = error instanceof Error ? error.message : String(payload.message ?? error);
        setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
      }
    } finally {
      setIsPythonEnvBusy(false);
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
      const message = error instanceof Error ? error.message : String(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const createManagedPythonEnv = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    const confirmed = window.confirm(t("settings.pythonEnvInstallConfirm"));
    if (!confirmed) return;

    const nextSettings: PythonEnvSettings = {
      ...pythonEnvSettings,
      mode: "managedVenv"
    };
    setPythonEnvSettings(nextSettings);
    setPythonEnvProbe(undefined);
    setIsPythonEnvBusy(true);
    setPythonEnvMessage(t("settings.pythonEnvCreating"));
    try {
      const createResult = await invokeCommand<PythonEnvInstallResult>(
        "create_managed_python_env"
      );
      if (!createResult.success) {
        setPythonEnvMessage(createResult.message);
        return;
      }

      setPythonEnvMessage(t("settings.pythonEnvInstalling"));
      const installResult = await invokeCommand<PythonEnvInstallResult>(
        "install_managed_python_deps",
        {
          installProfile: nextSettings.installProfile
        }
      );
      setPythonEnvSettings((current) => ({
        ...current,
        mode: "managedVenv",
        managedPath: installResult.managedPath || createResult.managedPath
      }));
      setPythonEnvMessage(installResult.message);
      if (installResult.success) {
        await probePythonEnv({
          ...nextSettings,
          managedPath: installResult.managedPath || createResult.managedPath
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const refreshThumbnailCacheInfo = async () => {
    if (!hasTauriRuntime() || isThumbnailCacheBusy) return;

    setIsThumbnailCacheBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<ThumbnailCacheInfo>("get_thumbnail_cache_info");
      setThumbnailCacheInfo(info);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalFilesMessage(t("settings.thumbnailCacheActionFailed", { message }));
    } finally {
      setIsThumbnailCacheBusy(false);
    }
  };

  const clearThumbnailCache = async () => {
    if (!hasTauriRuntime() || isThumbnailCacheBusy) return;

    setIsThumbnailCacheBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<ThumbnailCacheInfo>("clear_thumbnail_cache");
      setThumbnailCacheInfo(info);
      await refreshImages();
      setLocalFilesMessage(t("settings.thumbnailCacheCleared"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalFilesMessage(t("settings.thumbnailCacheActionFailed", { message }));
    } finally {
      setIsThumbnailCacheBusy(false);
    }
  };

  useEffect(() => {
    if (activeSection === "localFiles" && activeLocalFilesSection === "cache") {
      void refreshThumbnailCacheInfo();
    }
  }, [activeSection, activeLocalFilesSection]);

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 px-5"
    >
      <section
        className="flex h-[560px] w-full max-w-[820px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50/90">
          <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
            <Globe2 size={17} className="text-slate-700" />
            <h2 id="settings-title" className="m-0 text-[15px] font-semibold text-slate-950">
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
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium transition ${
                    isActive
                      ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:bg-white/72 hover:text-slate-950"
                  }`}
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
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-950">
                {t(active.labelKey)}
              </div>
            </div>
            <Button
              type="button"
              variant="icon"
              className="shrink-0"
              aria-label={t("settings.close")}
              title={t("menu.close")}
              onClick={onClose}
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            </Button>
          </header>

          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/42 p-5"
            style={{ scrollbarGutter: "stable" }}
          >
            {activeSection === "general" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <label className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.highlightCellState")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      {t("settings.highlightCellStateDescription")}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="no-drag h-4 w-4 shrink-0"
                    checked={highlightCellState}
                    onChange={(event) => setHighlightCellState(event.target.checked)}
                  />
                </label>
              </div>
            ) : activeSection === "language" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.languageNative")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
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
                <div className="flex gap-1 border-b border-slate-200 pb-2">
                  {[
                    { key: "environment" as const, label: t("settings.localFilesEnvironment") },
                    { key: "cache" as const, label: t("settings.localFilesCache") }
                  ].map((item) => {
                    const isActive = activeLocalFilesSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`no-drag h-8 rounded-md px-3 text-[13px] font-medium transition ${
                          isActive
                            ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-600 hover:bg-white/72 hover:text-slate-950"
                        }`}
                        onClick={() => setActiveLocalFilesSection(item.key)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {activeLocalFilesSection === "environment" ? (
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-slate-900">
                        {t("settings.pythonEnvTitle")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-500">
                        {t("settings.pythonEnvDescription")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="no-drag h-8 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPythonEnvBusy}
                      onClick={() => void probePythonEnv()}
                    >
                      {t("settings.pythonEnvProbe")}
                    </button>
                  </div>

                  <div className="space-y-3 px-4 py-3">
                    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-3">
                      <div className="text-[12px] font-medium text-slate-600">
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

                    {pythonEnvSettings.mode === "externalVenv" ? (
                    <div className="rounded-md border border-slate-100 bg-white/72 p-3">
                      <div className="mb-2 text-[12px] font-semibold text-slate-700">
                        {t("settings.pythonEnvExternal")}
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_92px_92px] gap-2">
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
                          className="no-drag h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isPythonEnvBusy}
                          onClick={() => void pickPythonEnvPath("folder")}
                        >
                          {t("settings.pythonEnvPickFolder")}
                        </button>
                        <button
                          type="button"
                          className="no-drag h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isPythonEnvBusy}
                          onClick={() => void pickPythonEnvPath("file")}
                        >
                          {t("settings.pythonEnvPickFile")}
                        </button>
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-slate-500">
                        {t("settings.pythonEnvExternalHint")}
                      </div>
                    </div>
                    ) : null}

                    {pythonEnvSettings.mode === "managedVenv" ? (
                    <div className="rounded-md border border-slate-100 bg-white/72 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-semibold text-slate-700">
                            {t("settings.pythonEnvManaged")}
                          </div>
                          <div className="mt-0.5 break-all text-[11px] text-slate-500">
                            {pythonEnvSettings.managedPath || "-"}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="no-drag h-8 shrink-0 rounded-md border border-slate-900 bg-slate-900 px-3 text-[12px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isPythonEnvBusy}
                          onClick={() => void createManagedPythonEnv()}
                        >
                          {t("settings.pythonEnvCreateManaged")}
                        </button>
                      </div>
                      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-3">
                        <div className="text-[12px] font-medium text-slate-600">
                          {t("settings.pythonEnvInstallProfile")}
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
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-slate-500">
                        {t("settings.pythonEnvManagedHint")}
                      </div>
                    </div>
                    ) : null}

                    {pythonEnvProbe ? (
                      <div className="rounded-md border border-slate-100 bg-white p-3">
                        <div className="mb-2 text-[12px] font-semibold text-slate-700">
                          {t("settings.pythonEnvProbeResult")}
                        </div>
                        <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                          <span className="text-slate-500">
                            {t("settings.pythonEnvStatus")}
                          </span>
                          <span className={pythonEnvProbe.ok ? "text-emerald-700" : "text-red-600"}>
                            {pythonEnvProbe.ok
                              ? t("settings.pythonEnvStatusOk")
                              : t("settings.pythonEnvStatusFailed")}
                          </span>
                          <span className="text-slate-500">
                            {t("settings.pythonEnvPythonPath")}
                          </span>
                          <span className="break-all text-slate-700">
                            {pythonEnvProbe.pythonPath ?? "-"}
                          </span>
                          <span className="text-slate-500">
                            {t("settings.pythonEnvPythonVersion")}
                          </span>
                          <span className="text-slate-700">
                            {pythonEnvProbe.pythonVersion ?? "-"}
                          </span>
                          <span className="text-slate-500">
                            {t("settings.pythonEnvTorchVersion")}
                          </span>
                          <span className="text-slate-700">
                            {pythonEnvProbe.torchVersion ?? "-"}
                          </span>
                          <span className="text-slate-500">
                            {t("settings.pythonEnvCuda")}
                          </span>
                          <span className="text-slate-700">
                            {pythonEnvProbe.cudaAvailable
                              ? t("settings.pythonEnvCudaAvailable", {
                                  version: pythonEnvProbe.cudaVersion ?? "-"
                                })
                              : t("settings.pythonEnvCudaUnavailable")}
                          </span>
                          <span className="text-slate-500">
                            {t("settings.pythonEnvDevices")}
                          </span>
                          <span className="text-slate-700">
                            {pythonEnvProbe.deviceNames.length > 0
                              ? pythonEnvProbe.deviceNames.join(", ")
                              : "-"}
                          </span>
                          {pythonEnvProbe.error ? (
                            <>
                              <span className="text-slate-500">
                                {t("settings.pythonEnvError")}
                              </span>
                              <span className="break-words text-red-600">
                                {pythonEnvProbe.error}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {pythonEnvMessage ? (
                      <div className="text-[12px] leading-5 text-slate-500">
                        {pythonEnvMessage}
                      </div>
                    ) : null}
                  </div>
                </div>
                ) : null}

                {activeLocalFilesSection === "cache" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.thumbnailCache")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      {t("settings.thumbnailCacheDescription")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="min-w-20 text-right text-[13px] font-medium text-slate-700">
                      {formatByteSize(thumbnailCacheInfo.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isThumbnailCacheBusy}
                      onClick={() => void refreshThumbnailCacheInfo()}
                    >
                      {t("settings.thumbnailCacheRefresh")}
                    </button>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isThumbnailCacheBusy || thumbnailCacheInfo.sizeBytes === 0}
                      onClick={() => void clearThumbnailCache()}
                    >
                      {t("settings.thumbnailCacheClear")}
                    </button>
                  </div>
                </div>
                {localFilesMessage ? (
                  <div className="px-4 py-3 text-[12px] text-slate-500">
                    {localFilesMessage}
                  </div>
                ) : null}
              </div>
                ) : null}
              </div>
            ) : activeSection === "appearance" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.theme")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
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
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.bottomUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
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
                    <span className="w-10 text-right text-[12px] text-slate-500">
                      {bottomUiOpacity}%
                    </span>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.topUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
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
                    <span className="w-10 text-right text-[12px] text-slate-500">
                      {topUiOpacity}%
                    </span>
                  </div>
                </div>
              </div>
            ) : activeSection === "network" ? (
              <div className="space-y-3">
                <div className="flex gap-1 border-b border-slate-200 pb-2">
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
                        className={`no-drag h-8 rounded-md px-3 text-[13px] font-medium transition ${
                          isActive
                            ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-600 hover:bg-white/72 hover:text-slate-950"
                        }`}
                        onClick={() => setActiveNetworkSection(item.key)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {activeNetworkSection === "gemini" ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900">
                          {t("settings.geminiApi")}
                        </div>
                        <div className="mt-0.5 text-[12px] text-slate-500">
                          {t("settings.geminiApiDescription")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="no-drag h-8 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isGeminiBusy}
                        onClick={() => void runGeminiAction("test")}
                      >
                        {t("settings.geminiTestConnection")}
                      </button>
                    </div>

                    <div className="space-y-3 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-slate-600">
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
                          <span className="mb-1 block text-[12px] font-medium text-slate-600">
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
                          className="no-drag h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isGeminiBusy}
                          onClick={() => void runGeminiAction("fetch")}
                        >
                          {t("settings.geminiFetchModels")}
                        </button>
                      </div>

                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-slate-600">
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
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {t("settings.geminiRpmLimitDescription")}
                        </span>
                      </label>

                      {geminiMessage ? (
                        <div className="truncate text-[12px] text-slate-500">
                          {geminiMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeNetworkSection === "proxy" ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="text-[13px] font-semibold text-slate-900">
                      {t("settings.networkProxy")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      {t("settings.networkProxyDescription")}
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4 px-4 py-3">
                    <label className="flex items-center gap-2 text-[13px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={geminiSettings.useProxy}
                        onChange={(event) =>
                          patchGeminiSettings({ useProxy: event.target.checked })
                        }
                      />
                      {t("settings.geminiUseProxy")}
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-slate-600">
                        {t("settings.geminiProxyPort")}
                      </span>
                      <input
                        className="glass-input h-8 w-full px-2.5 text-[13px]"
                        value={geminiSettings.proxyPort}
                        disabled={!geminiSettings.useProxy}
                        onChange={(event) => patchGeminiSettings({ proxyPort: event.target.value })}
                      />
                      <span className="mt-1 block text-[11px] text-slate-500">
                        {t("settings.geminiProxyPortDescription")}
                      </span>
                    </label>
                  </div>
                </div>
                ) : null}

                {activeNetworkSection === "imageTransfer" ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <div className="text-[13px] font-semibold text-slate-900">
                        {t("settings.networkImageTransfer")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-500">
                        {t("settings.networkImageTransferDescription")}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-slate-600">
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
                        <span className="mb-1 block text-[12px] font-medium text-slate-600">
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
              <div className="h-full rounded-lg border border-dashed border-slate-200 bg-white/72" />
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
