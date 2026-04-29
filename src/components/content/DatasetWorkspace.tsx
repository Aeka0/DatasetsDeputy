import {
  FolderOpen,
  Grid3X3,
  Images,
  Info,
  ListChecks,
  Search,
  Table2
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage, DatasetProject } from "../../types";
import { DatasetGrid } from "../grid/DatasetGrid";
import { DatasetTable } from "../table/DatasetTable";

type WorkspaceTab = "overview" | "grid" | "table";

const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof Info }> = [
  { id: "overview", label: "\u4fe1\u606f\u6982\u89c8", icon: Info },
  { id: "grid", label: "\u7f51\u683c\u89c6\u56fe", icon: Grid3X3 },
  { id: "table", label: "\u8868\u683c\u89c6\u56fe", icon: Table2 }
];

function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
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

    return [
      image.fileName,
      ...image.annotations.map((annotation) => annotation.content)
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function DatasetOverview({
  images,
  selectedProject
}: {
  images: DatasetImage[];
  selectedProject: DatasetProject | undefined;
}) {
  const totalSize = images.reduce((sum, image) => sum + (image.fileSize ?? 0), 0);
  const annotatedImages = images.filter(
    (image) => image.annotations.some((annotation) => annotation.content.trim())
  ).length;
  const annotationTypes = new Set(
    images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
  ).size;
  const latestUpdate = images
    .map((image) => image.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  const metrics = [
    {
      label: "\u56fe\u7247\u6570\u91cf",
      value: images.length.toLocaleString(),
      detail: selectedProject?.name ?? "-"
    },
    {
      label: "\u5df2\u6807\u6ce8\u56fe\u7247",
      value: annotatedImages.toLocaleString(),
      detail: `${images.length ? Math.round((annotatedImages / images.length) * 100) : 0}%`
    },
    {
      label: "\u6807\u6ce8\u7c7b\u578b",
      value: annotationTypes.toLocaleString(),
      detail: "\u5f53\u524d\u6570\u636e\u96c6"
    },
    {
      label: "\u6587\u4ef6\u4f53\u79ef",
      value: formatBytes(totalSize),
      detail: "\u5df2\u7d22\u5f15\u56fe\u7247"
    }
  ];

  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-4">
      <div className="grid grid-cols-4 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-[12px] text-slate-500">{metric.label}</div>
            <div className="mt-2 truncate text-[22px] font-semibold text-slate-950">
              {metric.value}
            </div>
            <div className="mt-1 truncate text-[12px] text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[1.2fr_0.8fr] gap-3">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
            <ListChecks size={16} className="text-slate-500" />
            <span>{"\u6570\u636e\u96c6\u4fe1\u606f"}</span>
          </div>
          <dl className="mt-4 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-3 text-[13px]">
            <dt className="text-slate-500">{"\u540d\u79f0"}</dt>
            <dd className="m-0 truncate text-slate-900">{selectedProject?.name ?? "-"}</dd>
            <dt className="text-slate-500">{"\u8def\u5f84"}</dt>
            <dd className="m-0 truncate text-slate-900">{selectedProject?.path ?? "-"}</dd>
            <dt className="text-slate-500">{"\u6700\u8fd1\u66f4\u65b0"}</dt>
            <dd className="m-0 truncate text-slate-900">
              {latestUpdate ? new Date(latestUpdate).toLocaleString() : "-"}
            </dd>
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
            <Images size={16} className="text-slate-500" />
            <span>{"\u56fe\u7247\u72b6\u6001"}</span>
          </div>
          <div className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">{"\u6709\u5c3a\u5bf8\u4fe1\u606f"}</span>
              <span className="font-medium text-slate-900">
                {images.filter((image) => image.width && image.height).length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">{"\u6709\u6807\u6ce8\u5185\u5bb9"}</span>
              <span className="font-medium text-slate-900">
                {images.filter((image) =>
                  image.annotations.some((annotation) => annotation.content.trim())
                ).length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">{"\u6709 AI \u6307\u4ee4"}</span>
              <span className="font-medium text-slate-900">
                {images.filter((image) =>
                  image.annotations.some((annotation) => annotation.instruction.trim())
                ).length}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function DatasetWorkspace() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const { images, projects, selectedProjectId, search, setSearch } = useDatasetStore();
  const selectedProject = flattenProjects(projects).find(
    (project) => project.id === selectedProjectId
  );
  const visibleImages = useMemo(
    () => getVisibleImages(images, selectedProject, search),
    [images, search, selectedProject]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex min-h-11 items-center gap-3 border-b border-slate-100 px-1.5 pb-3 pt-0.5">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex min-w-0 items-center gap-2 text-[14px] font-semibold text-slate-900">
            <FolderOpen size={16} className="shrink-0 text-slate-500" />
            <span className="truncate">{selectedProject?.name}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
              {t("toolbar.datasetCount", { count: visibleImages.length })}
            </span>
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
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <DatasetOverview images={visibleImages} selectedProject={selectedProject} />
      ) : activeTab === "grid" ? (
        <DatasetGrid images={visibleImages} />
      ) : (
        <DatasetTable images={visibleImages} />
      )}
    </div>
  );
}
