import { FolderOpen, Grid3X3, Info, RefreshCw, Search, Table2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";
import type { AnnotationProfile, DatasetImage, DatasetProject } from "../../types";
import { DatasetGrid } from "../grid/DatasetGrid";
import { DatasetTable } from "../table/DatasetTable";

type WorkspaceTab = "overview" | "grid" | "table";

const tabs: Array<{ id: WorkspaceTab; labelKey: string; icon: typeof Info }> = [
  { id: "overview", labelKey: "workspace.overview", icon: Info },
  { id: "grid", labelKey: "workspace.grid", icon: Grid3X3 },
  { id: "table", labelKey: "workspace.table", icon: Table2 }
];

function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
}

function findProjectTrail(
  projects: DatasetProject[],
  projectId: string | undefined,
  parents: DatasetProject[] = []
): DatasetProject[] {
  if (!projectId) return [];

  for (const project of projects) {
    const trail = [...parents, project];
    if (project.id === projectId) return trail;

    const childTrail = findProjectTrail(project.children ?? [], projectId, trail);
    if (childTrail.length) return childTrail;
  }

  return [];
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getVisibleImages(
  images: DatasetImage[],
  selectedProject: DatasetProject | undefined,
  search: string
) {
  const projectIds = selectedProject?.imageIds ?? [];
  const query = search.trim().toLowerCase();

  return images.filter((image) => {
    const inProject = projectIds.length === 0 || projectIds.includes(image.id);
    if (!inProject) return false;
    if (!query) return true;

    return [image.fileName, ...image.annotations.map((annotation) => annotation.content)]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function PropertyRow({
  label,
  value,
  mono,
  action
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[28px] items-center gap-3 text-[13px]">
      <dt className="w-[86px] shrink-0 text-slate-500">{label}</dt>
      <dd className={cn("m-0 min-w-0 truncate text-slate-900", mono && "font-mono text-[12px]")}>
        {value}
      </dd>
      {action ? <span className="inline-flex h-6 items-center">{action}</span> : null}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 first:mt-0">
      {children}
    </div>
  );
}

function DatasetOverview({
  images,
  selectedProject,
  profiles,
  isCheckingProblemItems,
  checkProblemItems
}: {
  images: DatasetImage[];
  selectedProject: DatasetProject | undefined;
  profiles: AnnotationProfile[];
  isCheckingProblemItems: boolean;
  checkProblemItems: (project?: DatasetProject) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const totalSize = images.reduce((sum, image) => sum + (image.fileSize ?? 0), 0);
  const annotatedImages = images.filter((image) =>
    image.annotations.some((annotation) => annotation.content.trim())
  ).length;
  const problemItems = images.filter((image) => image.sourceMissing).length;
  const canCheckProblemItems =
    Boolean(selectedProject?.datasetId) &&
    !["asset-database-group", "database-group", "workspace-folder-group"].includes(
      selectedProject?.id ?? ""
    );
  const profileById = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const annotationTypeNames = Array.from(
    new Set(
      images.flatMap((image) =>
        image.annotations.map(
          (annotation) => profileById.get(annotation.profileId) ?? `#${annotation.profileId}`
        )
      )
    )
  ).join(", ");
  const latestUpdate = images
    .map((image) => image.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-4">
      <div className="max-w-[540px]">
        <SectionHeader>{t("workspace.dataset")}</SectionHeader>
        <dl className="space-y-0.5">
          <PropertyRow label={t("workspace.name")} value={selectedProject?.name ?? "-"} />
          <PropertyRow label={t("workspace.path")} value={selectedProject?.path ?? "-"} mono />
          <PropertyRow
            label={t("workspace.latestUpdate")}
            value={latestUpdate ? new Date(latestUpdate).toLocaleString() : "-"}
          />
        </dl>

        <div className="my-3 h-px bg-slate-200/70" />

        <SectionHeader>{t("workspace.statistics")}</SectionHeader>
        <dl className="space-y-0.5">
          <PropertyRow label={t("workspace.imageCount")} value={images.length.toLocaleString()} />
          <PropertyRow label={t("workspace.annotated")} value={`${annotatedImages} / ${images.length}`} />
          <PropertyRow
            label={t("workspace.problemItems")}
            value={problemItems.toLocaleString()}
            action={
              <button
                type="button"
                className="no-drag inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50"
                disabled={isCheckingProblemItems || !canCheckProblemItems}
                onClick={() => void checkProblemItems(selectedProject)}
                title={t("workspace.checkProblemItems")}
              >
                <RefreshCw
                  size={14}
                  className={cn(isCheckingProblemItems && "animate-spin")}
                />
              </button>
            }
          />
          <PropertyRow label={t("workspace.annotationTypes")} value={annotationTypeNames || "-"} />
          <PropertyRow label={t("workspace.fileSize")} value={formatBytes(totalSize)} />
        </dl>
      </div>
    </div>
  );
}

export function DatasetWorkspace() {
  const { t } = useTranslation();
  const {
    images,
    projects,
    profiles,
    workspaceTab: activeTab,
    selectedProjectId,
    selectedImageIds,
    search,
    isCheckingProblemItems,
    setSearch,
    setWorkspaceTab,
    checkProblemItems
  } = useDatasetStore();
  const selectedProject = flattenProjects(projects).find(
    (project) => project.id === selectedProjectId
  );
  const selectedProjectTrail = useMemo(
    () => findProjectTrail(projects, selectedProjectId),
    [projects, selectedProjectId]
  );
  const titlePathPrefix =
    selectedProjectTrail.length > 1
      ? `${selectedProjectTrail
          .slice(0, -1)
          .map((project) => project.name)
          .join("/")}/`
      : "";
  const visibleImages = useMemo(
    () => getVisibleImages(images, selectedProject, search),
    [images, search, selectedProject]
  );
  const selectedVisibleImageCount = useMemo(() => {
    const visibleImageIds = new Set(visibleImages.map((image) => image.id));
    return selectedImageIds.filter((imageId) => visibleImageIds.has(imageId)).length;
  }, [selectedImageIds, visibleImages]);
  const visibleProblemItemCount = useMemo(
    () => visibleImages.filter((image) => image.sourceMissing).length,
    [visibleImages]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex min-h-11 items-center gap-3 border-b border-slate-100 px-1.5 pb-3 pt-0.5">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex min-w-0 items-center gap-2 text-[14px] text-slate-900">
            <FolderOpen size={16} className="shrink-0 text-slate-500" />
            <span className="min-w-0 flex-1 truncate leading-5">
              {titlePathPrefix ? (
                <span className="font-normal text-slate-500">{titlePathPrefix}</span>
              ) : null}
              <span className="font-semibold">{selectedProject?.name}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-normal",
                visibleProblemItemCount > 0
                  ? "bg-orange-100 text-orange-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {visibleProblemItemCount > 0
                ? `${visibleProblemItemCount}/${visibleImages.length}`
                : t("toolbar.datasetCount", { count: visibleImages.length })}
            </span>
            {selectedVisibleImageCount > 0 ? (
              <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-normal text-white">
                {t("toolbar.selectedCount", { count: selectedVisibleImageCount })}
              </span>
            ) : null}
          </h2>
        </div>
        <div className="relative w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="glass-input h-8 w-full pl-9 pr-3 text-[13px] placeholder:text-slate-400"
            placeholder={t("toolbar.searchPlaceholder")}
          />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1 border-b border-slate-100 px-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              className={cn(
                "no-drag flex h-9 items-center gap-2 border-b-2 px-3 text-[13px] transition",
                isActive
                  ? "border-slate-900 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              )}
              onClick={() => setWorkspaceTab(tab.id)}
            >
              <Icon size={15} />
              <span>{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <DatasetOverview
          images={visibleImages}
          selectedProject={selectedProject}
          profiles={profiles}
          isCheckingProblemItems={isCheckingProblemItems}
          checkProblemItems={checkProblemItems}
        />
      ) : activeTab === "grid" ? (
        <DatasetGrid images={visibleImages} />
      ) : (
        <DatasetTable images={visibleImages} />
      )}
    </div>
  );
}
