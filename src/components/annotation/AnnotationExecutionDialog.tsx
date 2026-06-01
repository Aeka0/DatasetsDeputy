import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { Button } from "../ui/Button";

export type AnnotationExecutionScope = "selected" | "all" | "empty";
export type AnnotationConflictStrategy = "overwrite" | "skip" | "mergePrefix" | "mergeSuffix";
export type AnnotationExecutionMode =
  | "gemini"
  | "openai"
  | "anthropic"
  | "grok"
  | "lmStudio"
  | "ollama"
  | "textgen"
  | "wd14";

const modeOptions: Array<{ value: AnnotationExecutionMode; labelKey: string }> = [
  { value: "wd14", labelKey: "annotationRun.modeWd14" },
  { value: "gemini", labelKey: "annotationRun.modeGemini" },
  { value: "openai", labelKey: "annotationRun.modeOpenAi" },
  { value: "anthropic", labelKey: "annotationRun.modeAnthropic" },
  { value: "grok", labelKey: "annotationRun.modeGrok" },
  { value: "lmStudio", labelKey: "annotationRun.modeLmStudio" },
  { value: "ollama", labelKey: "annotationRun.modeOllama" },
  { value: "textgen", labelKey: "annotationRun.modeTextgen" }
];

const conflictOptions: Array<{ value: AnnotationConflictStrategy; labelKey: string }> = [
  { value: "skip", labelKey: "annotationRun.conflictSkip" },
  { value: "overwrite", labelKey: "annotationRun.conflictOverwrite" },
  { value: "mergePrefix", labelKey: "annotationRun.conflictMergePrefix" },
  { value: "mergeSuffix", labelKey: "annotationRun.conflictMergeSuffix" }
];

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
  const [openMenu, setOpenMenu] = useState<"mode" | "scope" | "conflict" | undefined>();
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 0 });
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
  const conflictButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedModeLabel =
    modeOptions.find((option) => option.value === mode)?.labelKey ?? "annotationRun.modeWd14";
  const scopeOptions: Array<{
    value: AnnotationExecutionScope;
    label: string;
    disabled?: boolean;
  }> = [
    {
      value: "selected",
      label: t("annotationRun.scopeSelected", { count: selectedImageCount }),
      disabled: !hasSelectedImage
    },
    { value: "all", label: t("annotationRun.scopeAll") },
    { value: "empty", label: t("annotationRun.scopeEmpty") }
  ];
  const selectedScopeLabel =
    scopeOptions.find((option) => option.value === scope)?.label ?? t("annotationRun.scopeEmpty");
  const selectedConflictLabel =
    conflictOptions.find((option) => option.value === conflictStrategy)?.labelKey ??
    "annotationRun.conflictSkip";

  const openSelectMenu = (
    menu: "mode" | "scope" | "conflict",
    button: HTMLButtonElement
  ) => {
    const rect = button.getBoundingClientRect();
    setMenuPosition({
      left: rect.left,
      top: rect.bottom + 6,
      width: rect.width
    });
    setOpenMenu((current) => (current === menu ? undefined : menu));
  };

  useEffect(() => {
    if (!hasSelectedImage && scope === "selected") {
      setScope("empty");
    }
  }, [hasSelectedImage, scope]);

  useEffect(() => {
    if (!openMenu) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        (modeButtonRef.current?.contains(event.target) ||
          scopeButtonRef.current?.contains(event.target) ||
          conflictButtonRef.current?.contains(event.target) ||
          menuRef.current?.contains(event.target))
      ) {
        return;
      }
      setOpenMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(undefined);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

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
              <button
                ref={modeButtonRef}
                type="button"
                className="glass-input no-drag flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
                onClick={(event) => openSelectMenu("mode", event.currentTarget)}
              >
                <span className="min-w-0 truncate">{t(selectedModeLabel)}</span>
                <ChevronDown size={14} className="shrink-0 text-neutral-400" />
              </button>
            </div>
            <div className="mx-4 border-t border-neutral-100" />
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("annotationRun.scope")}
              </div>
              <button
                ref={scopeButtonRef}
                type="button"
                className="glass-input no-drag flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
                onClick={(event) => openSelectMenu("scope", event.currentTarget)}
              >
                <span className="min-w-0 truncate">{selectedScopeLabel}</span>
                <ChevronDown size={14} className="shrink-0 text-neutral-400" />
              </button>
            </div>
            <div className="mx-4 border-t border-neutral-100" />
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("annotationRun.conflict")}
              </div>
              <button
                ref={conflictButtonRef}
                type="button"
                className="glass-input no-drag flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
                onClick={(event) => openSelectMenu("conflict", event.currentTarget)}
              >
                <span className="min-w-0 truncate">{t(selectedConflictLabel)}</span>
                <ChevronDown size={14} className="shrink-0 text-neutral-400" />
              </button>
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
      {openMenu
        ? createPortal(
        <div
          ref={menuRef}
          className="app-dropdown-menu no-drag fixed z-[1010] rounded-lg py-2"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuPosition.width
          }}
        >
          <div className="app-dropdown-backdrop" />
          {openMenu === "mode" ? modeOptions.map((option) => {
            const isSelected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition hover:bg-neutral-100 ${
                  isSelected ? "text-neutral-950" : "text-neutral-600"
                }`}
                onClick={() => {
                  setMode(option.value);
                  setOpenMenu(undefined);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
              </button>
            );
          }) : null}
          {openMenu === "scope" ? scopeOptions.map((option) => {
            const isSelected = option.value === scope;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-45 ${
                  isSelected ? "text-neutral-950" : "text-neutral-600"
                }`}
                onClick={() => {
                  if (option.disabled) return;
                  setScope(option.value);
                  setOpenMenu(undefined);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          }) : null}
          {openMenu === "conflict" ? conflictOptions.map((option) => {
            const isSelected = option.value === conflictStrategy;
            return (
              <button
                key={option.value}
                type="button"
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition hover:bg-neutral-100 ${
                  isSelected ? "text-neutral-950" : "text-neutral-600"
                }`}
                onClick={() => {
                  setConflictStrategy(option.value);
                  setOpenMenu(undefined);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
              </button>
            );
          }) : null}
        </div>,
          document.body
        )
        : null}
    </div>
    </AnimatedPortal>
  );
}
