import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";

export type AnnotationExecutionScope = "selected" | "all" | "empty";
export type AnnotationConflictStrategy = "overwrite" | "skip";
export type AnnotationExecutionMode = "gemini" | "wd14";

const modeOptions: Array<{ value: AnnotationExecutionMode; labelKey: string }> = [
  { value: "gemini", labelKey: "annotationRun.modeGemini" },
  { value: "wd14", labelKey: "annotationRun.modeWd14" }
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
  const [scope, setScope] = useState<AnnotationExecutionScope>(
    hasSelectedImage ? "selected" : "empty"
  );
  const [mode, setMode] = useState<AnnotationExecutionMode>("gemini");
  const [conflictStrategy, setConflictStrategy] =
    useState<AnnotationConflictStrategy>("skip");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modeMenuPosition, setModeMenuPosition] = useState({ left: 0, top: 0, width: 0 });
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const selectedModeLabel =
    modeOptions.find((option) => option.value === mode)?.labelKey ?? "annotationRun.modeGemini";

  useEffect(() => {
    if (!hasSelectedImage && scope === "selected") {
      setScope("empty");
    }
  }, [hasSelectedImage, scope]);

  useEffect(() => {
    if (!modeMenuOpen) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        (modeButtonRef.current?.contains(event.target) ||
          modeMenuRef.current?.contains(event.target))
      ) {
        return;
      }
      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 px-5"
    >
      <section
        className="flex w-full max-w-[460px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-execution-title"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5">
          <div className="min-w-0 flex-1">
            <h2
              id="annotation-execution-title"
              className="m-0 flex min-w-0 items-baseline gap-2 text-[15px] font-semibold text-slate-950"
            >
              <span className="shrink-0">{t("annotationRun.title")}</span>
              <span className="min-w-0 truncate text-[12px] font-normal text-slate-500">
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
            onClick={onClose}
          >
            <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          </Button>
        </header>

        <div className="space-y-3 bg-slate-50/42 p-5">
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-slate-900">
                {t("annotationRun.mode")}
              </div>
              <button
                ref={modeButtonRef}
                type="button"
                className="glass-input no-drag flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setModeMenuPosition({
                    left: rect.left,
                    top: rect.bottom + 6,
                    width: rect.width
                  });
                  setModeMenuOpen((open) => !open);
                }}
              >
                <span className="min-w-0 truncate">{t(selectedModeLabel)}</span>
                <ChevronDown size={14} className="shrink-0 text-slate-400" />
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-900">
              {t("annotationRun.scope")}
            </div>
            <div className="space-y-2 px-4 py-3">
              <label
                className={`flex min-h-8 items-center gap-2 text-[13px] ${
                  hasSelectedImage ? "text-slate-700" : "text-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="annotation-scope"
                  value="selected"
                  disabled={!hasSelectedImage}
                  checked={scope === "selected"}
                  onChange={() => setScope("selected")}
                />
                {t("annotationRun.scopeSelected", { count: selectedImageCount })}
              </label>
              <label className="flex min-h-8 items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="radio"
                  name="annotation-scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                {t("annotationRun.scopeAll")}
              </label>
              <label className="flex min-h-8 items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="radio"
                  name="annotation-scope"
                  value="empty"
                  checked={scope === "empty"}
                  onChange={() => setScope("empty")}
                />
                {t("annotationRun.scopeEmpty")}
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-900">
              {t("annotationRun.conflict")}
            </div>
            <div className="space-y-2 px-4 py-3">
              <label className="flex min-h-8 items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="radio"
                  name="annotation-conflict"
                  value="overwrite"
                  checked={conflictStrategy === "overwrite"}
                  onChange={() => setConflictStrategy("overwrite")}
                />
                {t("annotationRun.conflictOverwrite")}
              </label>
              <label className="flex min-h-8 items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="radio"
                  name="annotation-conflict"
                  value="skip"
                  checked={conflictStrategy === "skip"}
                  onChange={() => setConflictStrategy("skip")}
                />
                {t("annotationRun.conflictSkip")}
              </label>
            </div>
          </section>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800"
              onClick={() => onConfirm({ mode, scope, conflictStrategy })}
            >
              {t("annotationRun.start")}
            </button>
          </div>
        </div>
      </section>
      {modeMenuOpen
        ? createPortal(
        <div
          ref={modeMenuRef}
          className="app-dropdown-menu no-drag fixed z-[60] rounded-lg py-2"
          style={{
            left: modeMenuPosition.left,
            top: modeMenuPosition.top,
            width: modeMenuPosition.width
          }}
        >
          <div className="app-dropdown-backdrop" />
          {modeOptions.map((option) => {
            const isSelected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                className={`app-dropdown-item flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition hover:bg-slate-100 ${
                  isSelected ? "text-slate-950" : "text-slate-600"
                }`}
                onClick={() => {
                  setMode(option.value);
                  setModeMenuOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
              </button>
            );
          })}
        </div>,
          document.body
        )
        : null}
    </div>,
    document.body
  );
}
