import { ArrowLeft, Database, FolderOpen } from "lucide-react";

import { useDatasetStore } from "../../stores/datasetStore";

const copy = {
  back: "\u8fd4\u56de",
  title: "\u60a8\u60f3\u5982\u4f55\u5904\u7406\u6570\u636e\u96c6\uff1f",
  database: "\u6570\u636e\u5e93",
  databaseDescription:
    "\u4f7f\u7528SQLite\u8fdb\u884c\u9ad8\u6027\u80fd\u6570\u636e\u96c6\u7ba1\u7406\uff0c\u9002\u7528\u4e8e\u540c\u65f6\u8bad\u7ec3\u591a\u79cd\u6a21\u578b\uff0c\u9700\u8981\u4e00\u5f20\u56fe\u50cf\u5bf9\u5e94\u591a\u79cd\u6807\u6ce8\uff0c\u5e76\u6839\u636e\u9700\u6c42\u7075\u6d3b\u5bfc\u51fa\u8bad\u7ec3\u96c6\u7684\u60c5\u51b5\u3002",
  folder: "\u6587\u4ef6\u5939",
  folderDescription:
    "\u4f7f\u7528\u672c\u5de5\u5177\u6765\u8f85\u52a9\u6570\u636e\u96c6\u6587\u4ef6\u5939\u7684\u7ba1\u7406\u548c\u6807\u6ce8\uff0c\u8d34\u8fd1\u539f\u751f\u7cfb\u7edf\u8d44\u6e90\u7ba1\u7406\u5668\u7684\u903b\u8f91\uff0c\u4e00\u5207\u6539\u52a8\u57fa\u4e8e\u5bf9\u5de5\u4f5c\u8def\u5f84\u4e0b\u6587\u4ef6\u7684\u4fee\u6539\u3002",
  databasePoints: [
    "\u57fa\u4e8eSQLite\u7684\u9ad8\u6027\u80fd\u6570\u636e\u5e93\u7ba1\u7406",
    "\u6807\u6ce8\u548c\u6307\u4ee4\u7531\u6570\u636e\u5e93\u7edf\u4e00\u50a8\u5b58",
    "\u56fe\u7247\u53ef\u6765\u81ea\u4efb\u610f\u8def\u5f84",
    "\u652f\u6301\u5355\u56fe\u7247\u5bf9\u5e94\u591a\u4e2a\u6807\u6ce8\u7c7b\u578b",
    "\u5728\u8bad\u7ec3\u524d\u6839\u636e\u9700\u6c42\u7075\u6d3b\u5bfc\u51fa",
    "\u4e0d\u4f1a\u968f\u6587\u4ef6\u5939\u53d8\u52a8\u800c\u66f4\u65b0",
    "\u79fb\u9664\u540e\u4f1a\u5220\u9664\u7a0b\u5e8f\u4e2d\u7684\u6570\u636e\u5e93\u4fe1\u606f"
  ],
  folderPoints: [
    "\u57fa\u4e8eWindows\u8def\u5f84\u7684\u6587\u4ef6\u7ba1\u7406",
    "\u6807\u6ce8\u548c\u6307\u4ee4\u50a8\u5b58\u4e3a\u76f8\u540c\u76ee\u5f55\u4e0b\u7684txt\u6587\u4ef6",
    "\u5bfc\u5165\u8def\u5f84\u4f5c\u4e3a\u552f\u4e00\u5de5\u4f5c\u8def\u5f84",
    "\u5355\u4e2a\u56fe\u7247\u4ec5\u5bf9\u5e94\u5355\u4e2a\u6807\u6ce8",
    "\u6587\u4ef6\u5939\u5373\u6210\u54c1\uff0c\u65e0\u5bfc\u51fa\u6b65\u9aa4",
    "\u8f6f\u4ef6\u5916\u90e8\u7684\u66f4\u6539\u4f1a\u52a8\u6001\u5f71\u54cd\u5185\u5bb9",
    "\u79fb\u9664\u65f6\u53ea\u79fb\u9664\u5de5\u4f5c\u8def\u5f84\uff0c\u4e0d\u53d8\u52a8\u6587\u4ef6"
  ]
};

export function ImportWizardView() {
  const importFolder = useDatasetStore((state) => state.importFolder);
  const mountFolder = useDatasetStore((state) => state.mountFolder);
  const closeImportWizard = useDatasetStore((state) => state.closeImportWizard);
  const isLoading = useDatasetStore((state) => state.isLoading);

  return (
    <div className="relative flex h-full min-h-0 items-center px-6 py-5">
      <button
        type="button"
        className="no-drag absolute left-5 top-4 inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        onClick={closeImportWizard}
      >
        <ArrowLeft size={15} />
        {copy.back}
      </button>
      <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-col">
        <header className="shrink-0 pb-8 text-center">
          <h1 className="m-0 text-[26px] font-normal leading-9 text-slate-950">
            {copy.title}
          </h1>
        </header>

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-5 overflow-auto">
          <button
            type="button"
            className="no-drag group flex min-h-[360px] min-w-0 flex-col justify-center rounded-md bg-transparent px-5 py-8 text-left transition-[background-color,transform] duration-500 ease-in-out hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
            onClick={() => void importFolder()}
          >
            <div className="flex items-center gap-3">
              <Database size={24} className="text-slate-900 transition group-hover:scale-105" />
              <h2 className="m-0 text-[19px] font-normal leading-7 text-slate-950">
                {copy.database}
              </h2>
            </div>
            <p className="mt-5 text-[14px] leading-7 text-slate-600">
              {copy.databaseDescription}
            </p>
            <ul className="mt-6 list-disc space-y-2 pl-5 text-[13px] leading-6 text-slate-500 marker:text-slate-400">
              {copy.databasePoints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </button>

          <div className="h-72 w-px self-center bg-slate-200" aria-hidden />

          <button
            type="button"
            className="no-drag group flex min-h-[360px] min-w-0 flex-col justify-center rounded-md bg-transparent px-5 py-8 text-left transition-[background-color,transform] duration-500 ease-in-out hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
            onClick={() => void mountFolder()}
          >
            <div className="flex items-center gap-3">
              <FolderOpen size={24} className="text-slate-900 transition group-hover:scale-105" />
              <h2 className="m-0 text-[19px] font-normal leading-7 text-slate-950">
                {copy.folder}
              </h2>
            </div>
            <p className="mt-5 text-[14px] leading-7 text-slate-600">
              {copy.folderDescription}
            </p>
            <ul className="mt-6 list-disc space-y-2 pl-5 text-[13px] leading-6 text-slate-500 marker:text-slate-400">
              {copy.folderPoints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </button>
        </div>
      </div>
    </div>
  );
}
