import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  defaultAnnotationPromptSettings,
  generateAnnotationPrompt,
  type AnnotationPromptMode,
  type AnnotationPromptSettings
} from "../../lib/annotationPrompt";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import { Button } from "../ui/Button";

interface GeminiSettings extends AnnotationPromptSettings {
  apiKey: string;
  model: string;
  availableModels: string[];
  rpmLimit: number;
  useProxy: boolean;
  proxyPort: string;
  imageResizeMode: string;
  imageConvertFormat: string;
}

const fallbackSettings: GeminiSettings = {
  ...defaultAnnotationPromptSettings,
  apiKey: "",
  model: "gemini-flash-latest",
  availableModels: ["gemini-flash-latest", "gemini-pro-latest"],
  rpmLimit: 0,
  useProxy: false,
  proxyPort: "7890",
  imageResizeMode: "none",
  imageConvertFormat: "none"
};

const promptModes: Array<{ value: AnnotationPromptMode; labelKey: string }> = [
  { value: "exact", labelKey: "annotationPrompt.modeExact" },
  { value: "short", labelKey: "annotationPrompt.modeShort" },
  { value: "tag", labelKey: "annotationPrompt.modeTag" },
  { value: "empty", labelKey: "annotationPrompt.modeEmpty" }
];

const promptOptions: Array<{ key: keyof AnnotationPromptSettings; labelKey: string }> = [
  { key: "atmosphere", labelKey: "annotationPrompt.optionAtmosphere" },
  { key: "quality", labelKey: "annotationPrompt.optionQuality" },
  { key: "lensInfo", labelKey: "annotationPrompt.optionLens" },
  { key: "ignoreText", labelKey: "annotationPrompt.optionIgnoreText" },
  { key: "facialFeatures", labelKey: "annotationPrompt.optionFaces" },
  { key: "jpegCompression", labelKey: "annotationPrompt.optionJpeg" },
  { key: "adversarialNoise", labelKey: "annotationPrompt.optionNoise" },
  { key: "aiGenerated", labelKey: "annotationPrompt.optionAi" }
];

interface PromptManagementDialogProps {
  onClose: () => void;
}

export function PromptManagementDialog({ onClose }: PromptManagementDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<GeminiSettings>(fallbackSettings);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const isEmptyMode = settings.annotationMode === "empty";
  const promptPreview = generateAnnotationPrompt(settings);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setHasLoaded(true);
      return;
    }

    void invokeCommand<GeminiSettings>("get_gemini_settings")
      .then((loadedSettings) => {
        setSettings({ ...fallbackSettings, ...loadedSettings });
        setHasLoaded(true);
      })
      .catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoaded) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<GeminiSettings>("save_gemini_settings", { settings }).catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(t("annotationPrompt.saveFailed", { message: text }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [settings, hasLoaded]);

  const patchSettings = (patch: Partial<GeminiSettings>) => {
    setMessage("");
    setSettings((current) => ({ ...current, ...patch }));
  };

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 px-5"
      onClick={onClose}
    >
      <section
        className="flex h-[600px] w-full max-w-[960px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-management-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <div className="min-w-0">
            <h2
              id="prompt-management-title"
              className="m-0 text-[15px] font-semibold text-slate-950"
            >
              {t("annotationPrompt.title")}
            </h2>
          </div>
          <Button
            type="button"
            variant="icon"
            className="shrink-0"
            aria-label={t("menu.close")}
            title={t("menu.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0 bg-slate-50/42">
          <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-5">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-[13px] font-semibold text-slate-900">
                  {t("annotationPrompt.mode")}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 px-4 py-3">
                {promptModes.map((mode) => {
                  const isActive = settings.annotationMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      className={`no-drag h-8 rounded-md px-2 text-[13px] font-medium transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => patchSettings({ annotationMode: mode.value })}
                    >
                      {t(mode.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-[13px] font-semibold text-slate-900">
                  {t("annotationPrompt.options")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3">
                {promptOptions.map((option) => (
                  <label
                    key={option.key}
                    className={`flex min-h-8 items-center gap-2 text-[13px] ${
                      isEmptyMode ? "text-slate-400" : "text-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={isEmptyMode}
                      checked={Boolean(settings[option.key])}
                      onChange={(event) =>
                        patchSettings({ [option.key]: event.target.checked } as Partial<GeminiSettings>)
                      }
                    />
                    <span>{t(option.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-[13px] font-semibold text-slate-900">
                  {t("annotationPrompt.additional")}
                </div>
              </div>
              <div className="px-4 py-3">
                <textarea
                  className="glass-input min-h-[160px] w-full resize-none px-2.5 py-2 text-[13px] leading-5"
                  value={settings.additionalPromptContent}
                  onChange={(event) =>
                    patchSettings({ additionalPromptContent: event.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-2 flex h-8 items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-slate-900">
                {t("annotationPrompt.preview")}
              </div>
              {message ? (
                <div className="min-w-0 truncate text-[12px] text-slate-500">{message}</div>
              ) : null}
            </div>
            <textarea
              className="glass-input min-h-0 flex-1 resize-none px-3 py-2 text-[12px] leading-5"
              readOnly
              value={promptPreview}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
