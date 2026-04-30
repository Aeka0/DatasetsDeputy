import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/Button";

export type AnnotationExecutionScope = "selected" | "all" | "empty";
export type AnnotationConflictStrategy = "overwrite" | "skip";

interface AnnotationExecutionDialogProps {
  datasetName: string;
  hasSelectedImage: boolean;
  selectedImageCount: number;
  onClose: () => void;
  onConfirm: (options: {
    scope: AnnotationExecutionScope;
    conflictStrategy: AnnotationConflictStrategy;
  }) => void;
}

export function AnnotationExecutionDialog({
  datasetName,
  hasSelectedImage,
  selectedImageCount,
  onClose,
  onConfirm
}: AnnotationExecutionDialogProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<AnnotationExecutionScope>(
    hasSelectedImage ? "selected" : "empty"
  );
  const [conflictStrategy, setConflictStrategy] =
    useState<AnnotationConflictStrategy>("skip");

  useEffect(() => {
    if (!hasSelectedImage && scope === "selected") {
      setScope("empty");
    }
  }, [hasSelectedImage, scope]);

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 px-5"
      onClick={onClose}
    >
      <section
        className="flex w-full max-w-[460px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-execution-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <div className="min-w-0">
            <h2
              id="annotation-execution-title"
              className="m-0 text-[15px] font-semibold text-slate-950"
            >
              {t("annotationRun.title")}
            </h2>
            <div className="mt-0.5 truncate text-[12px] text-slate-500">{datasetName}</div>
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

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50"
              onClick={onClose}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800"
              onClick={() => onConfirm({ scope, conflictStrategy })}
            >
              {t("annotationRun.start")}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
