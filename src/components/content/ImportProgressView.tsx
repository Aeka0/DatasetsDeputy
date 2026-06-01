import { Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDatasetStore } from "../../stores/datasetStore";

export function ImportProgressView() {
  const { t } = useTranslation();
  const progress = useDatasetStore((state) => state.importProgress);
  const cancelImport = useDatasetStore((state) => state.cancelImport);

  if (!progress || progress.done) {
    return null;
  }

  const percent =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 text-[13px]">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-neutral-500" />
          <div>
            <div className="text-[15px] font-semibold leading-6 text-neutral-900">
              {t("import.title")}
            </div>
            <div className="mt-0.5 leading-5 text-neutral-500">
              {progress.phase === "scanning"
                ? t("import.scanning")
                : t("import.progress", {
                    processed: progress.processed,
                    total: progress.total
                  })}
            </div>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-neutral-700 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex justify-between leading-5 text-neutral-500">
          <span>
            {t("import.summary", {
              imported: progress.imported,
              skipped: progress.skipped,
              failed: progress.failed
            })}
          </span>
          <span>{percent}%</span>
        </div>

        {progress.currentPath ? (
          <div className="mt-2 truncate leading-5 text-neutral-400">{progress.currentPath}</div>
        ) : null}

        <div className="mt-4 flex justify-end border-t border-neutral-100 pt-3">
          <button
            type="button"
            className="no-drag inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void cancelImport()}
          >
            <XCircle size={15} />
            {t("import.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
