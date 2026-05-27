import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatAppError } from "../../lib/errors";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { Button } from "../ui/Button";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";

interface ModelSettings {
  wd14Tagger: Wd14TaggerSettings;
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

const fallbackSettings: ModelSettings = {
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

interface Wd14TaggerSettingsDialogProps {
  onClose: () => void;
}

export function Wd14TaggerSettingsDialog({ onClose }: Wd14TaggerSettingsDialogProps) {
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [settings, setSettings] = useState<ModelSettings>(fallbackSettings);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ModelSettings>("get_model_settings")
      .then((loadedSettings) => {
        setSettings({
          ...fallbackSettings,
          ...loadedSettings,
          wd14Tagger: {
            ...fallbackSettings.wd14Tagger,
            ...loadedSettings.wd14Tagger
          }
        });
      })
      .catch((error) => setMessage(formatAppError(error)));
  }, []);

  const patchWd14Settings = (patch: Partial<Wd14TaggerSettings>) => {
    setMessage("");
    setSettings((current) => ({
      ...current,
      wd14Tagger: {
        ...current.wd14Tagger,
        ...patch
      }
    }));
  };

  const save = async () => {
    if (!hasTauriRuntime()) {
      onClose();
      return;
    }

    try {
      await invokeCommand<ModelSettings>("save_model_settings", { settings });
      onClose();
    } catch (error) {
      const text = formatAppError(error);
      setMessage(t("wd14Settings.saveFailed", { message: text }));
    }
  };

  const sliderRow = (
    label: string,
    value: number,
    onChange: (value: number) => void
  ) => (
    <label className="grid grid-cols-[148px_minmax(0,1fr)_44px] items-center gap-3 px-4 py-3">
      <span className="text-[13px] text-neutral-700">{label}</span>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="no-drag w-full"
      />
      <span className="text-right text-[12px] tabular-nums text-neutral-500">
        {value.toFixed(2)}
      </span>
    </label>
  );

  return (
    <AnimatedPortal open={open}>
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5"
    >
      <section
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wd14-settings-title"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
          <h2
            id="wd14-settings-title"
            className="m-0 text-[15px] font-semibold text-neutral-950"
          >
            {t("wd14Settings.title")}
          </h2>
          <Button
            type="button"
            variant="icon"
            className="shrink-0"
            aria-label={t("menu.close")}
            title={t("menu.close")}
            onClick={close}
          >
            <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Button>
        </header>

        <div className="bg-neutral-50/42 p-5">
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="divide-y divide-black/[0.06]">
              <div className="flex min-h-10 items-center px-4 py-2">
                <Switch
                  checked={settings.wd14Tagger.addCharacterTags}
                  label={t("wd14Settings.addCharacterTags")}
                  onCheckedChange={(checked) => patchWd14Settings({ addCharacterTags: checked })}
                />
              </div>
              <div className="flex min-h-10 items-center px-4 py-2">
                <Switch
                  checked={settings.wd14Tagger.addCopyrightTags}
                  label={t("wd14Settings.addCopyrightTags")}
                  onCheckedChange={(checked) => patchWd14Settings({ addCopyrightTags: checked })}
                />
              </div>
              <div className="flex min-h-10 items-center px-4 py-2">
                <Switch
                  checked={settings.wd14Tagger.replaceUnderscoresWithSpaces}
                  label={t("wd14Settings.replaceUnderscores")}
                  onCheckedChange={(checked) =>
                    patchWd14Settings({ replaceUnderscoresWithSpaces: checked })
                  }
                />
              </div>
              {sliderRow(
                t("wd14Settings.generalThreshold"),
                settings.wd14Tagger.generalThreshold,
                (value) => patchWd14Settings({ generalThreshold: value })
              )}
              {sliderRow(
                t("wd14Settings.characterThreshold"),
                settings.wd14Tagger.characterThreshold,
                (value) => patchWd14Settings({ characterThreshold: value })
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[12px] text-neutral-500">
              {message}
            </div>
            <div className="flex shrink-0 justify-end">
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800"
                onClick={() => void save()}
              >
                {t("actions.save")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
