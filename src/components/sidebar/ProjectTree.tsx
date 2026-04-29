import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject } from "../../types";

const copy = {
  removeDataset: "\u79fb\u9664\u6570\u636e\u96c6"
};

const sidebarLabelClass = "text-[12px] leading-4";

function ProjectNode({
  project,
  depth = 0,
  expandedIds,
  toggleExpanded,
  openContextMenu
}: {
  project: DatasetProject;
  depth?: number;
  expandedIds: Set<string>;
  toggleExpanded: (project: DatasetProject) => void;
  openContextMenu: (event: MouseEvent, project: DatasetProject) => void;
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
          "no-drag flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left transition",
          sidebarLabelClass,
          isSelected
            ? "bg-white/62 text-black"
            : "text-black hover:bg-slate-900/[0.045]"
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onContextMenu={(event) => openContextMenu(event, project)}
        onClick={() => {
          selectProject(project.id);
          if (hasChildren) {
            toggleExpanded(project);
          }
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown size={15} className="shrink-0 text-black" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-black" />
          )
        ) : (
          <span className="w-[15px] shrink-0" />
        )}
        {isSelected ? (
          <FolderOpen size={16} className="shrink-0 text-black" />
        ) : (
          <Folder size={16} className="shrink-0 text-black" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", sidebarLabelClass)}>
          {project.name}
        </span>
        <span className="shrink-0 rounded-full bg-white/72 px-1.5 py-0.5 text-[11px] leading-none text-black ring-1 ring-white/70">
          {imageCount || images.length}
        </span>
      </button>

      {hasChildren && isExpanded ? (
        <div className="mt-1.5 space-y-1">
          {project.children?.map((child) => (
            <ProjectNode
              key={child.id}
              project={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              openContextMenu={openContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTree() {
  const { t } = useTranslation();
  const { projects, importFolder, isLoading, removeDataset } = useDatasetStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    project: DatasetProject;
  }>();

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

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

  const openContextMenu = (event: MouseEvent, project: DatasetProject) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      project
    });
  };

  return (
    <aside className="fluent-sidebar flex h-full w-[248px] shrink-0 flex-col">
      <div className="no-drag px-3 pt-3">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md border border-white/70 bg-white/54 px-3 text-[13px] font-medium text-black transition hover:bg-white/72 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void importFolder()}
          disabled={isLoading}
        >
          <Plus size={16} />
          {t("actions.importFolder")}
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-3">
        <div
          className={cn(
            "mb-2 flex items-center gap-2 px-2 font-medium uppercase tracking-[0.04em] text-black",
            sidebarLabelClass
          )}
        >
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
              openContextMenu={openContextMenu}
            />
          ))}
        </div>
      </div>
      {contextMenu ? (
        <div
          className="no-drag fixed z-50 min-w-40 rounded-md border border-slate-200 bg-white p-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flex h-7 w-full items-center rounded px-3 text-left text-[12px] text-slate-700 transition hover:bg-slate-100"
            onClick={() => {
              const project = contextMenu.project;
              setContextMenu(undefined);
              void removeDataset(project);
            }}
          >
            {copy.removeDataset}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
