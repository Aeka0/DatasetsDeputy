import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDatasetStore } from "../../stores/datasetStore";

export function ImportProgressView() {
  const { t } = useTranslation();
  const progress = useDatasetStore((state) => state.importProgress);

  if (!progress || progress.done) {
    return null;
  }

  const percent =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-slate-500" />
          <div>
            <div className="text-[14px] font-semibold text-slate-900">{t("import.title")}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {progress.phase === "scanning"
                ? t("import.scanning")
                : t("import.progress", {
                    processed: progress.processed,
                    total: progress.total
                  })}
            </div>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-slate-700 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex justify-between text-xs text-slate-500">
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
          <div className="mt-2 truncate text-xs text-slate-400">{progress.currentPath}</div>
        ) : null}
      </div>
    </div>
  );
}
