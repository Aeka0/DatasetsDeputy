import { FolderOpen, Play } from "lucide-react";

import { useDatasetStore } from "../../stores/datasetStore";

const copy = {
  title: "\u5bfc\u5165\u6570\u636e\u96c6",
  folderPath: "\u6587\u4ef6\u5939\u8def\u5f84\uff1a",
  imageCount: "\u5f20\u56fe\u7247",
  imageFolderCount: "\u4e2a\u542b\u6709\u56fe\u7247\u7684\u5b50\u6587\u4ef6\u5939",
  annotatedImageCount: "\u5f20\u5e26\u6709\u6807\u6ce8",
  annotationTypeQuestion: "\u8bf7\u95ee\u8fd9\u4e9b\u6807\u6ce8\u7684\u7c7b\u578b\uff1f",
  annotationTypeRequired:
    "\u8bf7\u5148\u786e\u8ba4\u6807\u6ce8\u7c7b\u578b\u540d\u79f0",
  annotationTypePlaceholder:
    "\u4f8b\u5982\uff1adanbooru tags\u3001\u81ea\u7136\u8bed\u8a00\u63cf\u8ff0\u3001\u89d2\u8272\u6807\u7b7e",
  startImport: "\u5f00\u59cb\u5bfc\u5165"
};

export function ImportPreviewView() {
  const preview = useDatasetStore((state) => state.importPreview);
  const annotationType = useDatasetStore((state) => state.annotationType);
  const isLoading = useDatasetStore((state) => state.isLoading);
  const setAnnotationType = useDatasetStore((state) => state.setAnnotationType);
  const startPreparedImport = useDatasetStore((state) => state.startPreparedImport);

  if (!preview) {
    return null;
  }

  const needsAnnotationType = preview.annotatedImageCount > 0;
  const canStartImport =
    !isLoading &&
    preview.imageCount > 0 &&
    (!needsAnnotationType || annotationType.trim().length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col px-2 py-1">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex h-10 items-center gap-2 border-b border-slate-100 pb-3">
          <FolderOpen size={17} className="text-slate-600" />
          <h2 className="m-0 text-[14px] font-semibold text-slate-950">{copy.title}</h2>
        </div>

        <div className="mt-4 space-y-5">
          <section>
            <div className="text-[12px] font-medium text-slate-600">{copy.folderPath}</div>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
              {preview.folderPath}
            </div>
          </section>

          <section className="grid gap-3 text-slate-800 sm:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[18px] font-semibold text-slate-950">{preview.imageCount}</div>
              <div className="mt-1 text-[12px] text-slate-500">{copy.imageCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[18px] font-semibold text-slate-950">
                {preview.imageFolderCount}
              </div>
              <div className="mt-1 text-[12px] text-slate-500">{copy.imageFolderCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[18px] font-semibold text-slate-950">
                {preview.annotatedImageCount}
              </div>
              <div className="mt-1 text-[12px] text-slate-500">{copy.annotatedImageCount}</div>
            </div>
          </section>

          {preview.annotatedImageCount > 0 ? (
            <section className="max-w-xl">
              <label className="block text-[12px] font-medium text-slate-600">
                {copy.annotationTypeQuestion}
              </label>
              <input
                value={annotationType}
                onChange={(event) => setAnnotationType(event.target.value)}
                className="glass-input mt-2 h-8 w-full px-3 text-[13px] placeholder:text-slate-400"
                placeholder={copy.annotationTypePlaceholder}
              />
              {!annotationType.trim() ? (
                <div className="mt-1 text-xs text-slate-500">{copy.annotationTypeRequired}</div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-200 pt-3">
        <button
          className="no-drag inline-flex h-8 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void startPreparedImport()}
          disabled={!canStartImport}
        >
          <Play size={16} />
          {copy.startImport}
        </button>
      </div>
    </div>
  );
}
