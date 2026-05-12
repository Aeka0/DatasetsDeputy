import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronDown, FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { findProject, findProjectTrail, getProjectDisplayName } from "../../lib/projects";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject, ExportDatasetRequest } from "../../types";
import { AnimatedPortal } from "../ui/AnimatedPortal";

function firstExportableProject(projects: DatasetProject[]): DatasetProject | undefined {
  for (const project of projects) {
    if (
      project.datasetId &&
      project.id !== "asset-database-group" &&
      project.id !== "database-group" &&
      project.id !== "workspace-folder-group" &&
      project.imageIds.length > 0
    ) {
      return project;
    }

    const child = firstExportableProject(project.children ?? []);
    if (child) return child;
  }

  return undefined;
}

function getDatasetScopeLabel(
  project: DatasetProject | undefined,
  trail: DatasetProject[],
  fallback: string,
  getDisplayName: (project: DatasetProject) => string
) {
  if (!project) return fallback;
  if (project.sourceKind === "folder") return project.path;
  return trail.length > 1 ? trail.map(getDisplayName).join("/") : getDisplayName(project);
}

export function ExportDialog() {
  const { t } = useTranslation();
  const {
    projects,
    profiles,
    selectedProjectId,
    showExportDialog,
    exportPreview,
    exportProgress,
    closeExportDialog,
    prepareExportDataset,
    startExportDataset
  } = useDatasetStore(
    useShallow((state) => ({
      projects: state.projects,
      profiles: state.profiles,
      selectedProjectId: state.selectedProjectId,
      showExportDialog: state.showExportDialog,
      exportPreview: state.exportPreview,
      exportProgress: state.exportProgress,
      closeExportDialog: state.closeExportDialog,
      prepareExportDataset: state.prepareExportDataset,
      startExportDataset: state.startExportDataset
    }))
  );
  const [outputDir, setOutputDir] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<number>();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [error, setError] = useState("");

  const selectedProject = useMemo(() => {
    const project = findProject(projects, selectedProjectId);
    if (
      project?.datasetId &&
      project.id !== "asset-database-group" &&
      project.id !== "database-group" &&
      project.id !== "workspace-folder-group"
    ) {
      return project;
    }
    return firstExportableProject(projects);
  }, [projects, selectedProjectId]);
  const selectedProjectTrail = useMemo(
    () => findProjectTrail(projects, selectedProject?.id),
    [projects, selectedProject?.id]
  );
  const isFolderDataset = selectedProject?.sourceKind === "folder";
  const availableProfiles = useMemo(
    () =>
      selectedProject?.datasetId
        ? profiles.filter((profile) => profile.datasetId === selectedProject.datasetId)
        : [],
    [profiles, selectedProject?.datasetId]
  );
  const isExporting = Boolean(exportProgress && !exportProgress.done);
  const selectedProfile = availableProfiles.find((profile) => profile.id === selectedProfileId);
  const progressPercent =
    exportProgress && exportProgress.total > 0
      ? Math.round((exportProgress.processed / exportProgress.total) * 100)
      : 0;
  const getDisplayName = (project: DatasetProject) =>
    getProjectDisplayName(project, () => t("tree.looseFiles"));

  useEffect(() => {
    if (!showExportDialog) return;
    setError("");
    setSelectedProfileId((current) =>
      availableProfiles.some((profile) => profile.id === current)
        ? current
        : availableProfiles[0]?.id
    );
  }, [availableProfiles, showExportDialog]);

  const request = useMemo<ExportDatasetRequest | undefined>(() => {
    if (!selectedProject?.datasetId || !outputDir) return undefined;
    if (!isFolderDataset && !selectedProfileId) return undefined;

    return {
      outputDir,
      datasetId: selectedProject.datasetId,
      imageIds: selectedProject.imageIds,
      profileId: isFolderDataset ? undefined : selectedProfileId
    };
  }, [isFolderDataset, outputDir, selectedProfileId, selectedProject]);

  useEffect(() => {
    if (!request || isExporting) return;

    let cancelled = false;
    prepareExportDataset(request)
      .then(() => {
        if (!cancelled) setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(formatAppError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [isExporting, prepareExportDataset, request]);

  const chooseOutputDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("export.selectFolder")
      });

      if (!selected || Array.isArray(selected)) return;
      setOutputDir(selected);
      setError("");
    } catch {
      // dialog cancelled or failed
    }
  };

  const startExport = async () => {
    if (!request) return;
    try {
      setError("");
      await startExportDataset(request);
    } catch (caught) {
      setError(formatAppError(caught));
    }
  };

  return (
    <AnimatedPortal open={showExportDialog}>
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
      <section
        className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h2 className="m-0 shrink-0 text-[15px] font-semibold text-neutral-950">
              {t("export.title")}
            </h2>
            <div className="min-w-0 flex-1 truncate rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 font-mono text-[12px] leading-4 text-neutral-600">
              {getDatasetScopeLabel(
                selectedProject,
                selectedProjectTrail,
                t("export.noDataset"),
                getDisplayName
              )}
            </div>
          </div>
          <button
            type="button"
            className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t("menu.close")}
            title={t("menu.close")}
            disabled={isExporting}
            onClick={closeExportDialog}
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 bg-neutral-50/42 p-5">
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("export.outputPath")}
              </div>
              <button
                type="button"
                className="glass-input no-drag flex h-8 min-w-0 items-center gap-2 px-2.5 text-left text-[13px]"
                disabled={isExporting}
                onClick={() => void chooseOutputDir()}
              >
                <FolderOpen size={14} className="shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate">
                  {outputDir || t("export.chooseOutputPath")}
                </span>
              </button>
            </div>
            <div className="grid min-h-12 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-t border-neutral-100 px-4 py-3">
              <div className="text-[13px] font-semibold text-neutral-900">
                {t("export.profile")}
              </div>
              <div className="relative">
                <button
                  type="button"
                  className="glass-input no-drag flex h-8 w-full items-center gap-2 px-2.5 text-left text-[13px] disabled:cursor-not-allowed disabled:text-neutral-400"
                  disabled={isFolderDataset || isExporting}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {isFolderDataset
                      ? t("export.folderProfile")
                      : selectedProfile?.name ?? "-"}
                  </span>
                  <ChevronDown size={14} className="shrink-0 text-neutral-400" />
                </button>
                {profileMenuOpen && !isFolderDataset ? (
                  <div className="app-dropdown-menu no-drag absolute left-0 top-9 z-[70] w-full rounded-lg py-2">
                    <div className="app-dropdown-backdrop" />
                    {availableProfiles.map((profile) => {
                      const isSelected = profile.id === selectedProfileId;
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                          onClick={() => {
                            setSelectedProfileId(profile.id);
                            setProfileMenuOpen(false);
                          }}
                        >
                          <span className="flex w-4 shrink-0 justify-center">
                            {isSelected ? <Check size={14} /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-[13px]">
            <div className="grid gap-2 text-neutral-600">
              <div className="flex justify-between gap-4">
                <span>{t("export.finalOutputPath")}</span>
                <span className="min-w-0 truncate text-right text-neutral-900">
                  {exportPreview?.outputDir ?? "-"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>{t("export.estimatedSize")}</span>
                <span className="text-neutral-900">
                  {formatBytes(exportPreview?.estimatedSizeBytes)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>{t("export.imageCount")}</span>
                <span className="text-neutral-900">{exportPreview?.imageCount ?? "-"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>{t("export.annotationCount")}</span>
                <span className="text-neutral-900">{exportPreview?.annotationCount ?? "-"}</span>
              </div>
            </div>
          </section>

          {exportProgress ? (
            <section className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
              <div className="mb-2 flex justify-between text-[12px] text-neutral-600">
                <span>
                  {exportProgress.done
                    ? t("export.progressDone")
                    : t("export.progressExporting")}
                </span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-neutral-900 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="mt-2 text-[12px] text-neutral-500">
                {t("export.progressCount", {
                  processed: exportProgress.processed,
                  total: exportProgress.total
                })}
              </div>
            </section>
          ) : null}

          {error || exportProgress?.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error || exportProgress?.error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isExporting}
              onClick={closeExportDialog}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!request || isExporting || Boolean(error)}
              onClick={() => void startExport()}
            >
              {isExporting ? t("export.exporting") : t("export.start")}
            </button>
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
