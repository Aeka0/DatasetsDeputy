import { Files, ImageIcon, Search } from "lucide-react";
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
      <div className="mb-3 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-sm font-medium text-slate-900">
            {selectedProject?.name}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-slate-500">
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
            className="h-9 w-full rounded-lg border border-slate-200 bg-white/72 pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-3 focus:ring-slate-100"
            placeholder={t("toolbar.searchPlaceholder")}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 pb-4">
          {visibleImages.map((image) => (
            <button
              key={image.id}
              className="no-drag group overflow-hidden rounded-xl border border-slate-200/80 bg-white/68 p-1.5 text-left transition hover:bg-white"
              onClick={() => selectImage(image.id)}
            >
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-100">
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
                <div className="truncate text-sm text-slate-800">{image.fileName}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
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
