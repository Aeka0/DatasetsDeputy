import {
  Check,
  ChevronDown,
  Folder,
  Globe2,
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
import { Button } from "../ui/Button";

type SettingsSectionKey = "general" | "language" | "network" | "localFiles" | "appearance";
type NetworkSectionKey = "gemini" | "proxy" | "imageTransfer";

interface SettingsSection {
  key: SettingsSectionKey;
  labelKey: string;
  icon: typeof Settings2;
}

const sections: SettingsSection[] = [
  { key: "general", labelKey: "settings.general", icon: Settings2 },
  { key: "language", labelKey: "settings.language", icon: Languages },
  { key: "network", labelKey: "settings.network", icon: Wifi },
  { key: "localFiles", labelKey: "settings.localFiles", icon: Folder },
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
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getThemePreference);
  const [bottomUiOpacity, setBottomUiOpacityState] = useState(getBottomUiOpacity);
  const [topUiOpacity, setTopUiOpacityState] = useState(getTopUiOpacity);
  const [geminiSettings, setGeminiSettings] =
    useState<GeminiSettings>(defaultGeminiSettings);
  const [geminiMessage, setGeminiMessage] = useState("");
  const [isGeminiBusy, setIsGeminiBusy] = useState(false);
  const [hasLoadedGeminiSettings, setHasLoadedGeminiSettings] = useState(false);
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
            {activeSection === "language" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.languageNative")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">Language</div>
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
