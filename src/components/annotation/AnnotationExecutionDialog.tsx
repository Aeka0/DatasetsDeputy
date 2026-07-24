import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronsRight,
  FilePen,
  Server,
  SquareDashed,
  SquareDashedMousePointer,
  SquareDashedText,
  Tags,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProviderIconName } from "../../lib/providerIcons";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { AppSelect, type AppSelectOption } from "../ui/AppSelect";
import { Button } from "../ui/Button";
import { ProviderIcon } from "../ui/ProviderIcon";

export type AnnotationExecutionScope = "selected" | "all" | "empty";
export type AnnotationConflictStrategy = "overwrite" | "skip" | "mergePrefix" | "mergeSuffix";
export type AnnotationExecutionMode =
  | "gemini"
  | "openai"
  | "anthropic"
  | "grok"
  | "doubao"
  | "qwen"
  | "deepseek"
  | "zhipu"
  | "lmStudio"
  | "ollama"
  | "textgen"
  | "wd14";

type ModeOptionIcon =
  | { kind: "provider"; provider: ProviderIconName }
  | { kind: "lucide"; icon: LucideIcon };

interface ModeOption {
  value: AnnotationExecutionMode;
  labelKey: string;
  icon: ModeOptionIcon;
}

const localModeOptions: ModeOption[] = [
  { value: "wd14", labelKey: "annotationRun.modeWd14", icon: { kind: "lucide", icon: Tags } },
  {
    value: "lmStudio",
    labelKey: "annotationRun.modeLmStudio",
    icon: { kind: "lucide", icon: Server }
  },
  {
    value: "ollama",
    labelKey: "annotationRun.modeOllama",
    icon: { kind: "lucide", icon: Server }
  },
  {
    value: "textgen",
    labelKey: "annotationRun.modeTextgen",
    icon: { kind: "lucide", icon: Server }
  }
];

const cloudModeOptions: ModeOption[] = [
  {
    value: "gemini",
    labelKey: "annotationRun.modeGemini",
    icon: { kind: "provider", provider: "gemini" }
  },
  {
    value: "openai",
    labelKey: "annotationRun.modeOpenAi",
    icon: { kind: "provider", provider: "openai" }
  },
  {
    value: "anthropic",
    labelKey: "annotationRun.modeAnthropic",
    icon: { kind: "provider", provider: "anthropic" }
  },
  {
    value: "grok",
    labelKey: "annotationRun.modeGrok",
    icon: { kind: "provider", provider: "grok" }
  },
  {
    value: "doubao",
    labelKey: "annotationRun.modeDoubao",
    icon: { kind: "provider", provider: "doubao" }
  },
  {
    value: "qwen",
    labelKey: "annotationRun.modeQwen",
    icon: { kind: "provider", provider: "qwen" }
  },
  {
    value: "deepseek",
    labelKey: "annotationRun.modeDeepSeek",
    icon: { kind: "provider", provider: "deepseek" }
  },
  {
    value: "zhipu",
    labelKey: "annotationRun.modeZhipu",
    icon: { kind: "provider", provider: "zhipu" }
  }
];

const conflictOptions: Array<{
  value: AnnotationConflictStrategy;
  labelKey: string;
  icon: LucideIcon;
}> = [
  { value: "skip", labelKey: "annotationRun.conflictSkip", icon: ChevronsRight },
  { value: "overwrite", labelKey: "annotationRun.conflictOverwrite", icon: FilePen },
  {
    value: "mergePrefix",
    labelKey: "annotationRun.conflictMergePrefix",
    icon: ArrowLeftToLine
  },
  {
    value: "mergeSuffix",
    labelKey: "annotationRun.conflictMergeSuffix",
    icon: ArrowRightToLine
  }
];

function ModeIcon({ icon }: { icon: ModeOptionIcon }) {
  if (icon.kind === "provider") {
    return <ProviderIcon provider={icon.provider} />;
  }

  const Icon = icon.icon;
  return <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />;
}

interface AnnotationExecutionDialogProps {
  datasetName: string;
  datasetPathLabel: string;
  hasSelectedImage: boolean;
  selectedImageCount: number;
  onClose: () => void;
  onConfirm: (options: {
    mode: AnnotationExecutionMode;
    scope: AnnotationExecutionScope;
    conflictStrategy: AnnotationConflictStrategy;
  }) => void;
}

export function AnnotationExecutionDialog({
  datasetName,
  datasetPathLabel,
  hasSelectedImage,
  selectedImageCount,
  onClose,
  onConfirm
}: AnnotationExecutionDialogProps) {
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [scope, setScope] = useState<AnnotationExecutionScope>(
    hasSelectedImage ? "selected" : "empty"
  );
  const [mode, setMode] = useState<AnnotationExecutionMode>("wd14");
  const [conflictStrategy, setConflictStrategy] =
    useState<AnnotationConflictStrategy>("skip");
  const scopeOptions: Array<{
    value: AnnotationExecutionScope;
    label: string;
    icon: LucideIcon;
    disabled?: boolean;
  }> = [
    {
      value: "selected",
      label: t("annotationRun.scopeSelected", { count: selectedImageCount }),
      icon: SquareDashedMousePointer,
      disabled: !hasSelectedImage
    },
    { value: "all", label: t("annotationRun.scopeAll"), icon: SquareDashedText },
    { value: "empty", label: t("annotationRun.scopeEmpty"), icon: SquareDashed }
  ];
  const modeSelectOptions: AppSelectOption<AnnotationExecutionMode>[] = [
    ...localModeOptions.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      leading: <ModeIcon icon={option.icon} />
    })),
    ...cloudModeOptions.map((option, index) => ({
      value: option.value,
      label: t(option.labelKey),
      leading: <ModeIcon icon={option.icon} />,
      separatorBefore: index === 0
    }))
  ];
  const scopeSelectOptions: AppSelectOption<AnnotationExecutionScope>[] =
    scopeOptions.map((option) => {
      const Icon = option.icon;
      return {
        value: option.value,
        label: option.label,
        disabled: option.disabled,
        leading: (
          <Icon
            className="h-4 w-4 shrink-0"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )
      };
    });
  const conflictSelectOptions: AppSelectOption<AnnotationConflictStrategy>[] =
    conflictOptions.map((option) => {
      const Icon = option.icon;
      return {
        value: option.value,
        label: t(option.labelKey),
        leading: (
          <Icon
            className="h-4 w-4 shrink-0"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )
      };
    });

  useEffect(() => {
    if (!hasSelectedImage && scope === "selected") {
      setScope("empty");
    }
  }, [hasSelectedImage, scope]);

  return (
    <AnimatedPortal open={open}>
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5"
    >
      <section
        className="flex w-full max-w-[460px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-execution-title"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-5">
          <div className="min-w-0 flex-1">
            <h2
              id="annotation-execution-title"
              className="m-0 flex min-w-0 items-baseline gap-2 text-[15px] font-semibold text-neutral-950"
            >
              <span className="shrink-0">{t("annotationRun.title")}</span>
              <span className="min-w-0 truncate text-[12px] font-normal text-neutral-500">
                {datasetPathLabel || datasetName}
              </span>
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

        <div className="space-y-3 bg-neutral-50/42 p-5">
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("annotationRun.mode")}
              </div>
              <AppSelect
                value={mode}
                options={modeSelectOptions}
                onChange={setMode}
              />
            </div>
            <div className="mx-4 border-t border-neutral-100" />
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("annotationRun.scope")}
              </div>
              <AppSelect
                value={scope}
                options={scopeSelectOptions}
                onChange={setScope}
              />
            </div>
            <div className="mx-4 border-t border-neutral-100" />
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("annotationRun.conflict")}
              </div>
              <AppSelect
                value={conflictStrategy}
                options={conflictSelectOptions}
                onChange={setConflictStrategy}
              />
            </div>
          </section>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800"
              onClick={() => onConfirm({ mode, scope, conflictStrategy })}
            >
              {t("annotationRun.start")}
            </button>
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
