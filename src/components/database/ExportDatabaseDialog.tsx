import { save } from "@tauri-apps/plugin-dialog";
import { Check, ChevronDown, Database, FileArchive, FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { findProjectTrail, getProjectDisplayName } from "../../lib/projects";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatabaseExportRequest, DatasetProject } from "../../types";
import { AnimatedPortal } from "../ui/AnimatedPortal";

function databaseProjects(projects: DatasetProject[]) {
  return projects.filter(
    (project) =>
      project.datasetId &&
      (project.sourceKind === "database" || project.sourceKind === "asset") &&
      project.imageIds.length > 0
  );
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "database";
}

export function ExportDatabaseDialog() {
  const { t } = useTranslation();
  const {
    projects,
    selectedProjectId,
    showExportDatabaseDialog,
    databaseExportProgress,
    closeExportDatabaseDialog,
    startExportDatabase
  } = useDatasetStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      showExportDatabaseDialog: state.showExportDatabaseDialog,
      databaseExportProgress: state.databaseExportProgress,
      closeExportDatabaseDialog: state.closeExportDatabaseDialog,
      startExportDatabase: state.startExportDatabase
    }))
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>();
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false);
  const [includeImages, setIncludeImages] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [error, setError] = useState("");

  const datasets = useMemo(() => databaseProjects(projects), [projects]);
  const selectedFromTree = useMemo(() => {
    const trail = findProjectTrail(projects, selectedProjectId);
    return trail.find(
      (project) => project.datasetId && (project.sourceKind === "database" || project.sourceKind === "asset")
    );
  }, [projects, selectedProjectId]);
  const selectedDataset = datasets.find((project) => project.datasetId === selectedDatasetId);
  const isExporting = Boolean(databaseExportProgress && !databaseExportProgress.done);
  const progressPercent =
    databaseExportProgress && databaseExportProgress.total > 0
      ? Math.round((databaseExportProgress.processed / databaseExportProgress.total) * 100)
      : 0;

  useEffect(() => {
    if (!showExportDatabaseDialog) return;
    setError("");
    setOutputPath("");
    setDatasetMenuOpen(false);
    setSelectedDatasetId((current) => {
      if (datasets.some((project) => project.datasetId === current)) return current;
      if (selectedFromTree?.datasetId) return selectedFromTree.datasetId;
      return datasets[0]?.datasetId;
    });
  }, [datasets, selectedFromTree?.datasetId, showExportDatabaseDialog]);

  const chooseOutputPath = async () => {
    const extension = includeImages ? "zip" : "sqlite";
    const defaultName = `${sanitizeFileName(
      selectedDataset ? getProjectDisplayName(selectedDataset, () => t("tree.looseFiles")) : "database"
    )}.${extension}`;
    try {
      const selected = await save({
        title: t("databaseExport.selectOutput"),
        defaultPath: defaultName,
        filters: [
          {
            name: includeImages ? t("databaseExport.zipFilter") : t("databaseExport.sqliteFilter"),
            extensions: [extension]
          }
        ]
      });
      if (!selected) return;
      setOutputPath(selected);
      setError("");
    } catch {
      // 用户取消文件对话框时无需提示。
    }
  };

  const request = useMemo<DatabaseExportRequest | undefined>(() => {
    if (!selectedDatasetId || !outputPath) return undefined;
    return {
      datasetId: selectedDatasetId,
      outputPath,
      includeImages
    };
  }, [includeImages, outputPath, selectedDatasetId]);

  const start = async () => {
    if (!request) return;
    try {
      setError("");
      await startExportDatabase(request);
    } catch (caught) {
      setError(formatAppError(caught));
    }
  };

  return (
    <AnimatedPortal open={showExportDatabaseDialog}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex w-full max-w-[540px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-[15px] font-semibold text-neutral-950">
                {t("databaseExport.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {t("databaseExport.description")}
              </p>
            </div>
            <button
              type="button"
              className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t("menu.close")}
              title={t("menu.close")}
              disabled={isExporting}
              onClick={closeExportDatabaseDialog}
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </header>

          <div className="space-y-3 bg-neutral-50/42 p-5">
            <section className="rounded-lg border border-neutral-200 bg-white">
              <div className="grid min-h-12 grid-cols-[116px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
                <div className="text-[13px] font-semibold text-neutral-900">
                  {t("databaseExport.dataset")}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    className="glass-input no-drag flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px]"
                    disabled={isExporting}
                    onClick={() => setDatasetMenuOpen((open) => !open)}
                  >
                    <Database size={14} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {selectedDataset
                        ? getProjectDisplayName(selectedDataset, () => t("tree.looseFiles"))
                        : t("databaseExport.noDataset")}
                    </span>
                    <ChevronDown size={14} className="shrink-0 text-neutral-400" />
                  </button>
                  {datasetMenuOpen ? (
                    <div className="app-dropdown-menu no-drag absolute left-0 top-9 z-[70] w-full rounded-lg py-2">
                      <div className="app-dropdown-backdrop" />
                      {datasets.map((project) => {
                        const isSelected = project.datasetId === selectedDatasetId;
                        return (
                          <button
                            key={project.datasetId}
                            type="button"
                            className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                            onClick={() => {
                              setSelectedDatasetId(project.datasetId);
                              setDatasetMenuOpen(false);
                            }}
                          >
                            <span className="flex w-4 shrink-0 justify-center">
                              {isSelected ? <Check size={14} /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {getProjectDisplayName(project, () => t("tree.looseFiles"))}
                            </span>
                            <span className="shrink-0 text-[11px] text-neutral-400">
                              {project.sourceKind}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid min-h-12 grid-cols-[116px_minmax(0,1fr)] items-center gap-3 border-t border-neutral-100 px-4 py-3">
                <div className="text-[13px] font-semibold text-neutral-900">
                  {t("databaseExport.mode")}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`no-drag flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-[13px] transition ${
                      !includeImages
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                    }`}
                    disabled={isExporting}
                    onClick={() => {
                      setIncludeImages(false);
                      setOutputPath("");
                    }}
                  >
                    <Database size={14} />
                    {t("databaseExport.modeDatabaseOnly")}
                  </button>
                  <button
                    type="button"
                    className={`no-drag flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-[13px] transition ${
                      includeImages
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                    }`}
                    disabled={isExporting}
                    onClick={() => {
                      setIncludeImages(true);
                      setOutputPath("");
                    }}
                  >
                    <FileArchive size={14} />
                    {t("databaseExport.modeWithImages")}
                  </button>
                </div>
              </div>

              <div className="grid min-h-12 grid-cols-[116px_minmax(0,1fr)] items-center gap-3 border-t border-neutral-100 px-4 py-3">
                <div className="text-[13px] font-semibold text-neutral-900">
                  {t("databaseExport.outputPath")}
                </div>
                <button
                  type="button"
                  className="glass-input no-drag flex h-8 min-w-0 items-center gap-2 px-2.5 text-left text-[13px]"
                  disabled={isExporting || !selectedDataset}
                  onClick={() => void chooseOutputPath()}
                >
                  <FolderOpen size={14} className="shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {outputPath || t("databaseExport.chooseOutputPath")}
                  </span>
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-[12px] text-neutral-600">
              {includeImages ? t("databaseExport.withImagesHint") : t("databaseExport.databaseOnlyHint")}
            </section>

            {databaseExportProgress ? (
              <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <div className="mb-2 flex justify-between text-[12px] text-neutral-600">
                  <span>
                    {databaseExportProgress.done
                      ? t("databaseExport.progressDone")
                      : t(`databaseExport.phase.${databaseExportProgress.phase}`)}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-neutral-900 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between gap-4 text-[12px] text-neutral-500">
                  <span>
                    {t("databaseExport.progressCount", {
                      processed: databaseExportProgress.processed,
                      total: databaseExportProgress.total
                    })}
                  </span>
                  <span>{formatBytes(databaseExportProgress.writtenSizeBytes)}</span>
                </div>
              </section>
            ) : null}

            {error || databaseExportProgress?.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {error || databaseExportProgress?.error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isExporting}
                onClick={closeExportDatabaseDialog}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!request || isExporting || Boolean(error)}
                onClick={() => void start()}
              >
                {isExporting ? t("databaseExport.exporting") : t("databaseExport.start")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </AnimatedPortal>
  );
}
