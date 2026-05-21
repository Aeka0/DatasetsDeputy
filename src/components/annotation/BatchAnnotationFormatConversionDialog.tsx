import { ArrowLeftRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  MAX_XML_BATCH_SIZE,
  MIN_XML_BATCH_SIZE,
  clampXmlBatchSize
} from "../../lib/annotationXmlBatch";
import {
  buildAnnotationFormatConversionKey,
  type AnnotationFormat,
  type AnnotationFormatConversionKey,
  type QualityWordPlacement,
  type UsableAnnotationFormat
} from "../../lib/annotationFormatConversion";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { AppSelect, type AppSelectOption } from "../ui/AppSelect";
import { Button } from "../ui/Button";
import { DialogTitleWithDataset } from "../ui/DialogTitleWithDataset";
import { Switch } from "../ui/Switch";

export interface BatchAnnotationFormatConversionOptions {
  currentFormat: UsableAnnotationFormat;
  targetFormat: UsableAnnotationFormat;
  qualityWordPlacement: QualityWordPlacement;
  xmlBatchEnabled: boolean;
  xmlBatchSize: number;
  llmBackend: LLMBackend;
  llmPrompt: string;
}

export type LLMBackend = "gemini" | "lmStudio" | "textgen" | "ollama";

interface BatchAnnotationFormatConversionDialogProps {
  datasetPathLabel?: string;
  onClose: () => void;
  onConfirm: (options: BatchAnnotationFormatConversionOptions) => void | Promise<void>;
}

interface ConversionRule {
  descriptionKey: string;
  renderOptions?: (context: ConversionRuleContext) => ReactNode;
}

interface ConversionRuleContext {
  qualityWordPlacement: QualityWordPlacement;
  setQualityWordPlacement: (placement: QualityWordPlacement) => void;
  xmlBatchEnabled: boolean;
  setXmlBatchEnabled: (enabled: boolean) => void;
  xmlBatchSize: number;
  setXmlBatchSize: (size: number) => void;
  llmBackend: LLMBackend;
  setLLMBackend: (backend: LLMBackend) => void;
  llmPrompt: string;
  setLLMPrompt: (prompt: string) => void;
}

const conversionRules: Partial<Record<AnnotationFormatConversionKey, ConversionRule>> = {
  "booruTag->anima": {
    descriptionKey: "annotationFormatConversion.descriptionBooruTagToAnima",
    renderOptions: (context) => <BooruTagToAnimaOptions {...context} />
  },
  "anima->anima": {
    descriptionKey: "annotationFormatConversion.descriptionAnimaToAnima",
    renderOptions: (context) => <AnimaToAnimaOptions {...context} />
  },
  "anima->booruTag": {
    descriptionKey: "annotationFormatConversion.descriptionAnimaToBooruTag",
    renderOptions: () => <AnimaToBooruTagOptions />
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
  },
  "naturalLanguage->naturalLanguage": {
    descriptionKey: "annotationFormatConversion.descriptionNaturalLanguageRewrite",
    renderOptions: (context) => <NaturalLanguageRewriteOptions {...context} />
  }
};

function isUsableFormat(value: AnnotationFormat): value is UsableAnnotationFormat {
  return value !== "unset";
}

function BooruTagToAnimaOptions({
  qualityWordPlacement,
  setQualityWordPlacement
}: ConversionRuleContext) {
  const { t } = useTranslation();
  const qualityWordOptions: AppSelectOption<QualityWordPlacement>[] = [
    {
      value: "none",
      label: t("annotationFormatConversion.qualityWordsNone")
    },
    {
      value: "prefix",
      label: t("annotationFormatConversion.qualityWordsPrefix")
    },
    {
      value: "suffix",
      label: t("annotationFormatConversion.qualityWordsSuffix")
    }
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.stepOneTitle")}
        </div>
        <div className="px-4 py-3 text-[13px] leading-6 text-neutral-700">
          {t("annotationFormatConversion.stepOneDescription")}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.stepTwoTitle")}
        </div>
        <div className="grid min-h-12 grid-cols-[92px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
          <div className="text-[13px] text-neutral-700">
            {t("annotationFormatConversion.addMethod")}
          </div>
          <AppSelect
            value={qualityWordPlacement}
            options={qualityWordOptions}
            onChange={setQualityWordPlacement}
          />
        </div>
      </section>
    </div>
  );
}

function AnimaToAnimaOptions({
  qualityWordPlacement,
  setQualityWordPlacement
}: ConversionRuleContext) {
  const { t } = useTranslation();
  const qualityWordOptions: AppSelectOption<QualityWordPlacement>[] = [
    {
      value: "keep",
      label: t("annotationFormatConversion.qualityWordsKeep")
    },
    {
      value: "prefix",
      label: t("annotationFormatConversion.qualityWordsPrefix")
    },
    {
      value: "suffix",
      label: t("annotationFormatConversion.qualityWordsSuffix")
    },
    {
      value: "off",
      label: t("annotationFormatConversion.qualityWordsOff")
    }
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.animaStepOneTitle")}
        </div>
        <div className="grid min-h-12 grid-cols-[92px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
          <div className="text-[13px] text-neutral-700">
            {t("annotationFormatConversion.qualityWordsMethod")}
          </div>
          <AppSelect
            value={qualityWordPlacement}
            options={qualityWordOptions}
            onChange={setQualityWordPlacement}
          />
        </div>
      </section>
    </div>
  );
}

function AnimaToBooruTagOptions() {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.reverseStepOneTitle")}
        </div>
        <div className="px-4 py-3 text-[13px] leading-6 text-neutral-700">
          {t("annotationFormatConversion.reverseStepOneDescription")}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.reverseStepTwoTitle")}
        </div>
        <div className="px-4 py-3 text-[13px] leading-6 text-neutral-700">
          {t("annotationFormatConversion.reverseStepTwoDescription")}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.reverseStepThreeTitle")}
        </div>
        <div className="px-4 py-3 text-[13px] leading-6 text-neutral-700">
          {t("annotationFormatConversion.reverseStepThreeDescription")}
        </div>
      </section>
    </div>
  );
}

function NaturalLanguageRewriteOptions({
  xmlBatchEnabled,
  setXmlBatchEnabled,
  xmlBatchSize,
  setXmlBatchSize,
  llmBackend,
  setLLMBackend,
  llmPrompt,
  setLLMPrompt
}: ConversionRuleContext) {
  const { t } = useTranslation();
  const llmBackendOptions: AppSelectOption<LLMBackend>[] = [
    { value: "gemini", label: t("annotationFormatConversion.llmBackendGemini") },
    { value: "lmStudio", label: t("annotationFormatConversion.llmBackendLmStudio") },
    { value: "textgen", label: t("annotationFormatConversion.llmBackendTextgen") },
    { value: "ollama", label: t("annotationFormatConversion.llmBackendOllama") }
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.nlRewriteStepOneTitle")}
        </div>
        <div className="space-y-3 px-4 py-3">
          <Switch
            checked={xmlBatchEnabled}
            label={t("annotationFormatConversion.xmlBatchEnabled")}
            onCheckedChange={setXmlBatchEnabled}
          />
          <label className={xmlBatchEnabled ? "block" : "block opacity-45"}>
            <div className="mb-2 flex items-center justify-between gap-3 text-[13px] text-neutral-700">
              <span>{t("annotationFormatConversion.xmlBatchSize")}</span>
              <span className="font-medium text-neutral-900">{xmlBatchSize}</span>
            </div>
            <input
              type="range"
              min={MIN_XML_BATCH_SIZE}
              max={MAX_XML_BATCH_SIZE}
              step={1}
              value={xmlBatchSize}
              disabled={!xmlBatchEnabled}
              className="w-full"
              onChange={(event) => setXmlBatchSize(clampXmlBatchSize(Number(event.target.value)))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.nlRewriteStepTwoTitle")}
        </div>
        <div className="space-y-3 px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-600">
              {t("annotationFormatConversion.llmBackend")}
            </span>
            <AppSelect
              value={llmBackend}
              options={llmBackendOptions}
              onChange={setLLMBackend}
            />
          </label>
          <textarea
            value={llmPrompt}
            onChange={(event) => setLLMPrompt(event.target.value)}
            placeholder={t("annotationFormatConversion.llmPromptPlaceholder")}
            className="batch-edit-textarea glass-input h-32 w-full resize-none px-3 py-2 text-[13px]"
          />
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 text-[13px] font-semibold text-neutral-900">
          {t("annotationFormatConversion.nlRewriteStepThreeTitle")}
        </div>
        <div className="px-4 py-3 text-[13px] leading-6 text-neutral-700">
          {xmlBatchEnabled
            ? t("annotationFormatConversion.nlRewriteStepThreeXml")
            : t("annotationFormatConversion.nlRewriteStepThreeDisabled")}
        </div>
      </section>
    </div>
  );
}

export function BatchAnnotationFormatConversionDialog({
  datasetPathLabel,
  onClose,
  onConfirm
}: BatchAnnotationFormatConversionDialogProps) {
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [currentFormat, setCurrentFormat] = useState<AnnotationFormat>("unset");
  const [targetFormat, setTargetFormat] = useState<AnnotationFormat>("unset");
  const [qualityWordPlacement, setQualityWordPlacement] =
    useState<QualityWordPlacement>("none");
  const [xmlBatchEnabled, setXmlBatchEnabled] = useState(true);
  const [xmlBatchSize, setXmlBatchSize] = useState(8);
  const [llmBackend, setLLMBackend] = useState<LLMBackend>("gemini");
  const [llmPrompt, setLLMPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);
  const hasFormatsSelected =
    isUsableFormat(currentFormat) && isUsableFormat(targetFormat);
  const isNaturalLanguageRewrite =
    currentFormat === "naturalLanguage" && targetFormat === "naturalLanguage";
  const activeRule = hasFormatsSelected
    ? conversionRules[buildAnnotationFormatConversionKey(currentFormat, targetFormat)]
    : undefined;
  const canExecute =
    hasFormatsSelected &&
    !isSubmitting &&
    (!isNaturalLanguageRewrite || llmPrompt.trim().length > 0);

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

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (currentFormat === "anima" && targetFormat === "anima") {
      if (qualityWordPlacement === "none") {
        setQualityWordPlacement("keep");
      }
      return;
    }

    if (
      currentFormat === "booruTag" &&
      targetFormat === "anima" &&
      (qualityWordPlacement === "keep" || qualityWordPlacement === "off")
    ) {
      setQualityWordPlacement("none");
    }
  }, [currentFormat, qualityWordPlacement, targetFormat]);

  return (
    <AnimatedPortal open={open}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex h-[620px] max-h-[calc(100vh-48px)] w-full max-w-[680px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-annotation-format-conversion-title"
        >
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <ArrowLeftRight size={18} className="text-neutral-700" />
              <DialogTitleWithDataset
                id="batch-annotation-format-conversion-title"
                title={t("annotationFormatConversion.title")}
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
              disabled={isSubmitting}
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            </Button>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] bg-neutral-50/42">
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
              {isNaturalLanguageRewrite ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-900">
                  {t("annotationFormatConversion.lowQualityModelWarning")}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 overflow-y-auto p-5">
              {!hasFormatsSelected ? (
                <div className="m-auto max-w-[320px] text-center text-[13px] leading-6 text-neutral-500">
                  <div>{t("annotationFormatConversion.placeholderLineOne")}</div>
                  <div>{t("annotationFormatConversion.placeholderLineTwo")}</div>
                </div>
              ) : activeRule?.renderOptions ? (
                <div className="w-full">
                  {activeRule.renderOptions({
                    qualityWordPlacement,
                    setQualityWordPlacement,
                    xmlBatchEnabled,
                    setXmlBatchEnabled,
                    xmlBatchSize,
                    setXmlBatchSize,
                    llmBackend,
                    setLLMBackend,
                    llmPrompt,
                    setLLMPrompt
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting}
              onClick={close}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!canExecute}
              onClick={async () => {
                if (!canExecute) return;
                setIsSubmitting(true);
                try {
                  await onConfirm({
                    currentFormat,
                    targetFormat,
                    qualityWordPlacement,
                    xmlBatchEnabled,
                    xmlBatchSize: clampXmlBatchSize(xmlBatchSize),
                    llmBackend,
                    llmPrompt
                  });
                } finally {
                  if (isMountedRef.current) {
                    setIsSubmitting(false);
                  }
                }
              }}
            >
              {isSubmitting
                ? t("annotationFormatConversion.executing")
                : t("annotationFormatConversion.execute")}
            </Button>
          </footer>
        </section>
      </div>
    </AnimatedPortal>
  );
}
