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
    <div className="flex h-full min-h-0 flex-col px-3 py-2 text-[13px]">
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="flex items-start gap-2 border-b border-slate-100 pb-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">
              {copy.title}
            </h2>
            {report.rootPath ? (
              <div className="mt-0.5 truncate leading-5 text-slate-500">{report.rootPath}</div>
            ) : null}
          </div>
        </div>

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-[22px] font-semibold leading-7 text-slate-950">
              {report.successWithoutAnnotations}
            </div>
            <div className="mt-1 leading-5 text-slate-500">{copy.successWithoutAnnotations}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-[22px] font-semibold leading-7 text-slate-950">
              {report.successWithAnnotations}
            </div>
            <div className="mt-1 leading-5 text-slate-500">{copy.successWithAnnotations}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-[22px] font-semibold leading-7 text-slate-950">{report.failed}</div>
            <div className="mt-1 leading-5 text-slate-500">{copy.failed}</div>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-center gap-2 font-medium leading-5 text-slate-700">
            <FileWarning size={16} />
            {copy.failedFiles}
          </div>
          {report.failures.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white">
              {report.failures.map((failure) => (
                <div
                  key={`${failure.filePath}:${failure.reason}`}
                  className="border-b border-slate-100 px-3 py-2 last:border-b-0"
                >
                  <div className="truncate leading-5 text-slate-800">{failure.filePath}</div>
                  <div className="mt-1 leading-5 text-rose-700">{failure.reason}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 leading-5 text-slate-500">
              {copy.noFailures}
            </div>
          )}
        </section>
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-200 pt-3">
        <button
          className="no-drag inline-flex h-9 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
