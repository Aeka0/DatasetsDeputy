import { ArrowLeftRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { AppSelect, type AppSelectOption } from "../ui/AppSelect";
import { Button } from "../ui/Button";

type AnnotationFormat = "unset" | "booruTag" | "anima" | "naturalLanguage";
type UsableAnnotationFormat = Exclude<AnnotationFormat, "unset">;
type ConversionRuleKey = `${UsableAnnotationFormat}->${UsableAnnotationFormat}`;

interface BatchAnnotationFormatConversionDialogProps {
  onClose: () => void;
}

interface ConversionRule {
  descriptionKey: string;
  renderOptions?: () => ReactNode;
}

const conversionRules: Partial<Record<ConversionRuleKey, ConversionRule>> = {
  "booruTag->anima": {
    descriptionKey: "annotationFormatConversion.descriptionBooruTagToAnima",
    renderOptions: () => <BooruTagToAnimaOptions />
  },
  "anima->booruTag": {
    descriptionKey: "annotationFormatConversion.descriptionAnimaToBooruTag"
  },
  "booruTag->naturalLanguage": {
    descriptionKey: "annotationFormatConversion.descriptionBooruTagToNaturalLanguage"
  },
  "naturalLanguage->booruTag": {
    descriptionKey: "annotationFormatConversion.descriptionNaturalLanguageToBooruTag"
  },
  "anima->naturalLanguage": {
    descriptionKey: "annotationFormatConversion.descriptionAnimaToNaturalLanguage"
  },
  "naturalLanguage->anima": {
    descriptionKey: "annotationFormatConversion.descriptionNaturalLanguageToAnima"
  }
};

function isUsableFormat(value: AnnotationFormat): value is UsableAnnotationFormat {
  return value !== "unset";
}

function buildRuleKey(
  currentFormat: UsableAnnotationFormat,
  targetFormat: UsableAnnotationFormat
): ConversionRuleKey {
  return `${currentFormat}->${targetFormat}`;
}

function BooruTagToAnimaOptions() {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="px-4 py-3">
        <label className="flex min-h-8 items-center gap-2 text-[13px] text-neutral-700">
          <input type="checkbox" />
          {t("annotationFormatConversion.addQualityWords")}
        </label>
      </div>
    </section>
  );
}

export function BatchAnnotationFormatConversionDialog({
  onClose
}: BatchAnnotationFormatConversionDialogProps) {
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [currentFormat, setCurrentFormat] = useState<AnnotationFormat>("unset");
  const [targetFormat, setTargetFormat] = useState<AnnotationFormat>("unset");
  const hasFormatsSelected =
    isUsableFormat(currentFormat) && isUsableFormat(targetFormat);
  const activeRule = hasFormatsSelected
    ? conversionRules[buildRuleKey(currentFormat, targetFormat)]
    : undefined;

  const formatOptions: AppSelectOption<AnnotationFormat>[] = [
    {
      value: "unset",
      label: t("annotationFormatConversion.formatUnset")
    },
    {
      value: "booruTag",
      label: t("annotationFormatConversion.formatBooruTag")
    },
    {
      value: "anima",
      label: t("annotationFormatConversion.formatAnima")
    },
    {
      value: "naturalLanguage",
      label: t("annotationFormatConversion.formatNaturalLanguage")
    }
  ];

  return (
    <AnimatedPortal open={open}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-annotation-format-conversion-title"
        >
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="flex items-center gap-2.5">
              <ArrowLeftRight size={18} className="text-neutral-700" />
              <h2
                id="batch-annotation-format-conversion-title"
                className="m-0 text-[15px] font-semibold text-neutral-950"
              >
                {t("annotationFormatConversion.title")}
              </h2>
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

          <div className="grid min-h-[320px] grid-cols-[250px_minmax(0,1fr)] bg-neutral-50/42">
            <div className="border-r border-neutral-200 p-5">
              <div className="space-y-4">
                <label className="block">
                  <span className="text-[12px] font-medium text-neutral-600">
                    {t("annotationFormatConversion.currentFormat")}
                  </span>
                  <AppSelect
                    className="mt-1"
                    value={currentFormat}
                    options={formatOptions}
                    onChange={setCurrentFormat}
                  />
                </label>

                <label className="block">
                  <span className="text-[12px] font-medium text-neutral-600">
                    {t("annotationFormatConversion.targetFormat")}
                  </span>
                  <AppSelect
                    className="mt-1"
                    value={targetFormat}
                    options={formatOptions}
                    onChange={setTargetFormat}
                  />
                </label>
              </div>

              <div className="mt-5 rounded-lg border border-neutral-200 bg-white text-[12px] leading-5 text-neutral-600">
                <div className="border-b border-neutral-100 px-3 py-2 font-medium text-neutral-700">
                  {t("annotationFormatConversion.descriptionTitle")}
                </div>
                <p className="m-0 px-3 py-2.5">
                  {hasFormatsSelected
                    ? t(
                        activeRule?.descriptionKey ??
                          "annotationFormatConversion.descriptionGeneric"
                      )
                    : t("annotationFormatConversion.selectFormatsHint")}
                </p>
              </div>
            </div>

            <div className="flex p-5">
              {!hasFormatsSelected ? (
                <div className="m-auto max-w-[320px] text-center text-[13px] leading-6 text-neutral-500">
                  <div>{t("annotationFormatConversion.placeholderLineOne")}</div>
                  <div>{t("annotationFormatConversion.placeholderLineTwo")}</div>
                </div>
              ) : activeRule?.renderOptions ? (
                <div className="w-full">{activeRule.renderOptions()}</div>
              ) : null}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
            <Button type="button" variant="secondary" onClick={close}>
              {t("actions.cancel")}
            </Button>
            <Button type="button" disabled={!hasFormatsSelected} onClick={close}>
              {t("annotationFormatConversion.execute")}
            </Button>
          </footer>
        </section>
      </div>
    </AnimatedPortal>
  );
}
