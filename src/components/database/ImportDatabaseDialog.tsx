import { open } from "@tauri-apps/plugin-dialog";
import { Database, FileArchive, FolderOpen, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { formatAppError } from "../../lib/errors";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatabaseImportRequest, DatabaseImportResult } from "../../types";
import { AnimatedPortal } from "../ui/AnimatedPortal";

function isZipPath(path: string) {
  return path.toLocaleLowerCase().endsWith(".zip");
}

export function ImportDatabaseDialog() {
  const { t } = useTranslation();
  const {
    showImportDatabaseDialog,
    isLoading,
    closeImportDatabaseDialog,
    importDatabase
  } = useDatasetStore(
    useShallow((state) => ({
      showImportDatabaseDialog: state.showImportDatabaseDialog,
      isLoading: state.isLoading,
      closeImportDatabaseDialog: state.closeImportDatabaseDialog,
      importDatabase: state.importDatabase
    }))
  );
  const [sourcePath, setSourcePath] = useState("");
  const [imageTargetDir, setImageTargetDir] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DatabaseImportResult>();

  const sourceIsZip = isZipPath(sourcePath);
  const request = useMemo<DatabaseImportRequest | undefined>(() => {
    if (!sourcePath) return undefined;
    if (sourceIsZip && !imageTargetDir) return undefined;
    return {
      sourcePath,
      imageTargetDir: sourceIsZip ? imageTargetDir : undefined
    };
  }, [imageTargetDir, sourceIsZip, sourcePath]);

  const chooseSourcePath = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: t("databaseImport.selectSource"),
        filters: [
          {
            name: t("databaseImport.sourceFilter"),
            extensions: ["sqlite", "zip"]
          }
        ]
      });
      if (!selected || Array.isArray(selected)) return;
      setSourcePath(selected);
      setImageTargetDir("");
      setResult(undefined);
      setError("");
    } catch {
      // 用户取消文件对话框时无需提示。
    }
  };

  const chooseImageTargetDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("databaseImport.selectImageTarget")
      });
      if (!selected || Array.isArray(selected)) return;
      setImageTargetDir(selected);
      setResult(undefined);
      setError("");
    } catch {
      // 用户取消文件对话框时无需提示。
    }
  };

  const start = async () => {
    if (!request) return;
    try {
      setError("");
      setResult(undefined);
      const importResult = await importDatabase(request);
      setResult(importResult);
    } catch (caught) {
      setError(formatAppError(caught));
    }
  };

  const close = () => {
    if (isLoading) return;
    closeImportDatabaseDialog();
    setSourcePath("");
    setImageTargetDir("");
    setResult(undefined);
    setError("");
  };

  return (
    <AnimatedPortal open={showImportDatabaseDialog}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex w-full max-w-[540px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-[15px] font-semibold text-neutral-950">
                {t("databaseImport.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {t("databaseImport.description")}
              </p>
            </div>
            <button
              type="button"
              className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t("menu.close")}
              title={t("menu.close")}
              disabled={isLoading}
              onClick={close}
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </header>

          <div className="space-y-3 bg-neutral-50/42 p-5">
            <section className="rounded-lg border border-neutral-200 bg-white">
              <div className="grid min-h-12 grid-cols-[120px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
                <div className="text-[13px] font-semibold text-neutral-900">
                  {t("databaseImport.sourcePath")}
                </div>
                <button
                  type="button"
                  className="glass-input no-drag flex h-8 min-w-0 items-center gap-2 px-2.5 text-left text-[13px]"
                  disabled={isLoading}
                  onClick={() => void chooseSourcePath()}
                >
                  {sourceIsZip ? (
                    <FileArchive size={14} className="shrink-0 text-neutral-400" />
                  ) : (
                    <Database size={14} className="shrink-0 text-neutral-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {sourcePath || t("databaseImport.chooseSourcePath")}
                  </span>
                </button>
              </div>

              {sourceIsZip ? (
                <div className="grid min-h-12 grid-cols-[120px_minmax(0,1fr)] items-center gap-3 border-t border-neutral-100 px-4 py-3">
                  <div className="text-[13px] font-semibold text-neutral-900">
                    {t("databaseImport.imageTargetDir")}
                  </div>
                  <button
                    type="button"
                    className="glass-input no-drag flex h-8 min-w-0 items-center gap-2 px-2.5 text-left text-[13px]"
                    disabled={isLoading}
                    onClick={() => void chooseImageTargetDir()}
                  >
                    <FolderOpen size={14} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {imageTargetDir || t("databaseImport.chooseImageTargetDir")}
                    </span>
                  </button>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-[12px] text-neutral-600">
              {sourceIsZip ? t("databaseImport.zipHint") : t("databaseImport.sqliteHint")}
            </section>

            {result ? (
              <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800">
                {t("databaseImport.complete", {
                  imageCount: result.imageCount,
                  copiedImageCount: result.copiedImageCount
                })}
              </section>
            ) : null}

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                onClick={close}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!request || isLoading}
                onClick={() => void start()}
              >
                {isLoading ? t("databaseImport.importing") : t("databaseImport.start")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </AnimatedPortal>
  );
}
