import { CheckCircle2, FileWarning, Search } from "lucide-react";

import { useDatasetStore } from "../../stores/datasetStore";

const copy = {
  title: "\u5bfc\u5165\u62a5\u544a",
  successWithoutAnnotations: "\u6210\u529f\uff08\u65e0\u6807\u6ce8\uff09",
  successWithAnnotations: "\u6210\u529f\uff08\u6709\u6807\u6ce8\uff09",
  failed: "\u5931\u8d25",
  failedFiles: "\u5931\u8d25\u7684\u6587\u4ef6\u548c\u539f\u56e0",
  noFailures: "\u6ca1\u6709\u5931\u8d25\u6587\u4ef6",
  browseDataset: "\u6d4f\u89c8\u6570\u636e\u96c6"
};

export function ImportReportView() {
  const report = useDatasetStore((state) => state.importReport);
  const isLoading = useDatasetStore((state) => state.isLoading);
  const browseImportedDataset = useDatasetStore((state) => state.browseImportedDataset);

  if (!report) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-5">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <CheckCircle2 size={21} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-3xl font-semibold text-slate-950">{copy.title}</h2>
            {report.rootPath ? (
              <div className="mt-1 truncate text-sm text-slate-500">{report.rootPath}</div>
            ) : null}
          </div>
        </div>

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white/68 p-4">
            <div className="text-2xl font-semibold text-slate-950">
              {report.successWithoutAnnotations}
            </div>
            <div className="mt-1 text-sm text-slate-500">{copy.successWithoutAnnotations}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white/68 p-4">
            <div className="text-2xl font-semibold text-slate-950">
              {report.successWithAnnotations}
            </div>
            <div className="mt-1 text-sm text-slate-500">{copy.successWithAnnotations}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white/68 p-4">
            <div className="text-2xl font-semibold text-slate-950">{report.failed}</div>
            <div className="mt-1 text-sm text-slate-500">{copy.failed}</div>
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <FileWarning size={16} />
            {copy.failedFiles}
          </div>
          {report.failures.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white/70">
              {report.failures.map((failure) => (
                <div
                  key={`${failure.filePath}:${failure.reason}`}
                  className="border-b border-slate-100 px-3 py-2 last:border-b-0"
                >
                  <div className="truncate text-sm text-slate-800">{failure.filePath}</div>
                  <div className="mt-1 text-xs text-rose-700">{failure.reason}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white/60 px-3 py-2 text-sm text-slate-500">
              {copy.noFailures}
            </div>
          )}
        </section>
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-200 pt-4">
        <button
          className="no-drag inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void browseImportedDataset()}
          disabled={isLoading}
        >
          <Search size={16} />
          {copy.browseDataset}
        </button>
      </div>
    </div>
  );
}
