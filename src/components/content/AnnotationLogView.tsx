import { Trash2 } from "lucide-react";

import { useDatasetStore } from "../../stores/datasetStore";

export function AnnotationLogView() {
  const logs = useDatasetStore((state) => state.appLogs);
  const clearAppLogs = useDatasetStore((state) => state.clearAppLogs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex min-h-11 items-center justify-between border-b border-slate-100 px-1.5 pb-3 pt-0.5">
        <div>
          <h2 className="m-0 text-[14px] font-semibold text-slate-900">Logs</h2>
          <div className="mt-0.5 text-[12px] text-slate-500">
            All log output is recorded in English.
          </div>
        </div>
        <button
          type="button"
          className="no-drag flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={logs.length === 0}
          onClick={clearAppLogs}
        >
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      <div
        className="selectable-text min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[12px] leading-5 text-slate-700"
        data-native-context-menu="true"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500">No logs yet.</div>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3">
                <span className="shrink-0 text-slate-400">
                  {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                </span>
                <span
                  className={
                    log.level === "error"
                      ? "shrink-0 text-red-600"
                      : log.level === "warning"
                        ? "shrink-0 text-amber-600"
                        : "shrink-0 text-emerald-600"
                  }
                >
                  {log.level.toUpperCase().padEnd(7, " ")}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
