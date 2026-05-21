import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  defaultAnnotationNormalizationOptions,
  type AnnotationNormalizationOptions
} from "../../lib/annotationNormalization";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { Button } from "../ui/Button";
import { DialogTitleWithDataset } from "../ui/DialogTitleWithDataset";
import { Switch } from "../ui/Switch";

interface BatchAnnotationNormalizationDialogProps {
  datasetPathLabel?: string;
  onClose: () => void;
  onConfirm: (options: AnnotationNormalizationOptions) => void | Promise<void>;
}

type NormalizationOptionKey = keyof AnnotationNormalizationOptions;

const normalizationOptionKeys: NormalizationOptionKey[] = [
  "lowercase",
  "halfWidth",
  "removeSpecial",
  "underscoreToSpace",
  "removeNewlines",
  "removeJunk",
  "removeNonAscii"
];

export function BatchAnnotationNormalizationDialog({
  datasetPathLabel,
  onClose,
  onConfirm
}: BatchAnnotationNormalizationDialogProps) {
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [options, setOptions] = useState(defaultAnnotationNormalizationOptions);

  const updateOption = (key: NormalizationOptionKey, checked: boolean) => {
    setOptions((current) => ({
      ...current,
      [key]: checked
    }));
  };

  return (
    <AnimatedPortal open={open}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-annotation-normalization-title"
        >
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Sparkles size={18} className="text-neutral-700" />
              <DialogTitleWithDataset
                id="batch-annotation-normalization-title"
                title={t("annotationNormalization.title")}
                datasetPathLabel={datasetPathLabel}
              />
            </div>
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

          <div className="bg-neutral-50/42 px-5 py-5">
            <p className="m-0 text-[13px] leading-6 text-neutral-600">
              {t("annotationNormalization.description")}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {normalizationOptionKeys.map((key) => (
                <Switch
                  key={key}
                  className="min-h-10 rounded-lg border border-neutral-200 bg-white px-3 py-2"
                  checked={options[key]}
                  label={t(`annotationNormalization.options.${key}`)}
                  onCheckedChange={(checked) => updateOption(key, checked)}
                />
              ))}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
            <Button type="button" variant="secondary" onClick={close}>
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onConfirm(options);
              }}
            >
              {t("annotationNormalization.execute")}
            </Button>
          </footer>
        </section>
      </div>
    </AnimatedPortal>
  );
}
