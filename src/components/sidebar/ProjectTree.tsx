import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject } from "../../types";

function ProjectNode({
  project,
  depth = 0,
  expandedIds,
  toggleExpanded
}: {
  project: DatasetProject;
  depth?: number;
  expandedIds: Set<string>;
  toggleExpanded: (project: DatasetProject) => void;
}) {
  const { selectedProjectId, selectProject, images } = useDatasetStore();
  const isSelected = selectedProjectId === project.id;
  const hasChildren = Boolean(project.children?.length);
  const isExpanded = expandedIds.has(project.id);
  const imageCount = project.imageIds.length;

  return (
    <div>
      <button
        className={cn(
          "no-drag flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
          isSelected
            ? "bg-white/46 text-slate-900"
            : "text-slate-600 hover:bg-white/28 hover:text-slate-900"
        )}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        onClick={() => {
          selectProject(project.id);
          if (hasChildren) {
            toggleExpanded(project);
          }
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown size={15} className="shrink-0 text-slate-500" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-slate-500" />
          )
        ) : (
          <span className="w-[15px] shrink-0" />
        )}
        {isSelected ? (
          <FolderOpen size={16} className="shrink-0 text-slate-700" />
        ) : (
          <Folder size={16} className="shrink-0 text-slate-500" />
        )}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span className="shrink-0 rounded-full bg-white/34 px-1.5 py-0.5 text-xs text-slate-500">
          {imageCount || images.length}
        </span>
      </button>

      {hasChildren && isExpanded ? (
        <div className="mt-1 space-y-1">
          {project.children?.map((child) => (
            <ProjectNode
              key={child.id}
              project={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTree() {
  const { t } = useTranslation();
  const { projects, importFolder, isLoading } = useDatasetStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const project of projects) {
        next.add(project.id);
      }
      return next;
    });
  }, [projects]);

  const toggleExpanded = (project: DatasetProject) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(project.id)) {
        next.delete(project.id);
      } else {
        next.add(project.id);
      }
      return next;
    });
  };

  return (
    <aside className="fluent-sidebar flex h-full w-[260px] shrink-0 flex-col border-r border-slate-200/50 bg-white/20">
      <div className="no-drag px-4 pt-4">
        <button
          className="flex w-full items-center gap-2 rounded-lg bg-white/34 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/52"
          onClick={() => void importFolder()}
          disabled={isLoading}
        >
          <Plus size={16} />
          {t("actions.importFolder")}
        </button>
      </div>

      <div className="mt-5 px-4 flex-1 overflow-y-auto">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs uppercase tracking-[0.08em] text-slate-500">
          <HardDrive size={14} />
          {t("tree.projects")}
        </div>
        <div className="no-drag space-y-1">
          {projects.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
