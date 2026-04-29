import { Files, FolderOpen, ImageIcon, Search } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject } from "../../types";

const copy = {
  annotationCount: "\u4efd\u6807\u6ce8"
};

function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
}

export function DatasetGrid() {
  const { t } = useTranslation();
  const { images, projects, selectedProjectId, search, setSearch, selectImage } =
    useDatasetStore();
  const selectedProject = flattenProjects(projects).find(
    (project) => project.id === selectedProjectId
  );
  const datasetAnnotationTypeCount = useMemo(
    () =>
      new Set(
        images.flatMap((image) =>
          image.annotations.map((annotation) => annotation.profileId)
        )
      ).size,
    [images]
  );

  const visibleImages = useMemo(() => {
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
  }, [images, search, selectedProject]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex h-11 items-center gap-3 border-b border-slate-100 px-1.5 pb-3 pt-0.5">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex items-center gap-2 truncate text-[14px] font-semibold text-slate-900">
            <FolderOpen size={16} className="shrink-0 text-slate-500" />
            {selectedProject?.name}
          </h2>
          <p className="m-0 mt-0.5 text-[12px] text-slate-500">
            {t("toolbar.datasetCount", { count: visibleImages.length })}
          </p>
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

      <div className="min-h-0 flex-1 overflow-auto px-1.5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4">
          {visibleImages.map((image) => (
            <button
              key={image.id}
              className="no-drag group overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => selectImage(image.id)}
            >
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100">
                {image.thumbnailPath ? (
                  <img
                    src={resolveAssetSrc(image.thumbnailPath)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <ImageIcon size={30} className="text-slate-300" />
                )}
              </div>
              <div className="px-1.5 pb-1.5 pt-2">
                <div className="truncate text-[13px] text-slate-800">{image.fileName}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                  <Files size={12} />
                  <span className="truncate">
                    {image.annotations.filter((annotation) => annotation.content.trim()).length}/
                    {datasetAnnotationTypeCount} {copy.annotationCount}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
