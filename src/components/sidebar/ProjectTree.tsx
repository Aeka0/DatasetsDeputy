import { ChevronDown, ChevronRight, Database, Folder, FolderOpen, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject } from "../../types";

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
  const { selectedProjectId, selectProject } = useDatasetStore();
  const isSelected = selectedProjectId === project.id;
  const hasChildren = Boolean(project.children?.length);
  const isExpanded = expandedIds.has(project.id);
  const imageCount = project.imageIds.length;
  const isDatabaseNode = project.id === "database-group" || project.id.startsWith("dataset-root:");
  const isGroupNode = project.id === "database-group" || project.id === "workspace-folder-group";
  const canOpenContextMenu =
    !isGroupNode && (project.sourceKind !== "folder" || project.id.startsWith("folder-root:"));
  const indentation = isGroupNode ? 4 : 8 + depth * 10;

  const handleRowActivate = () => {
    if (isGroupNode) {
      toggleExpanded(project);
      return;
    }
    if (!hasChildren) {
      selectProject(project.id);
      return;
    }
    if (!isSelected) {
      selectProject(project.id);
      return;
    }
    toggleExpanded(project);
  };

  return (
    <div>
      <div
        className={cn(
          "no-drag flex h-8 w-full items-stretch gap-1 rounded-md pr-2.5 text-left transition",
          sidebarLabelClass,
          isSelected
            ? "bg-white/62 text-black"
            : "text-black hover:bg-slate-900/[0.045]"
        )}
        style={{ paddingLeft: `${indentation}px` }}
        onContextMenu={(event) => {
          if (canOpenContextMenu) {
            openContextMenu(event, project);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="no-drag group flex w-[22px] shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "折叠子文件夹" : "展开子文件夹"}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(project);
            }}
          >
            {isExpanded ? (
              <ChevronDown
                size={15}
                className="shrink-0 text-black/50 transition-[color,opacity] duration-150 ease-out group-hover:text-black"
              />
            ) : (
              <ChevronRight
                size={15}
                className="shrink-0 text-black/50 transition-[color,opacity] duration-150 ease-out group-hover:text-black"
              />
            )}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className="no-drag flex min-w-0 flex-1 items-center gap-2 rounded border-0 bg-transparent p-0 text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/20"
          onClick={handleRowActivate}
        >
          {isDatabaseNode ? (
            <Database size={16} className="shrink-0 text-black" />
          ) : isSelected ? (
            <FolderOpen size={16} className="shrink-0 text-black" />
          ) : (
            <Folder size={16} className="shrink-0 text-black" />
          )}
          <span className={cn("min-w-0 flex-1 truncate", sidebarLabelClass)}>{project.name}</span>
          <span className="shrink-0 rounded-full bg-white/72 px-1.5 py-0.5 text-[11px] leading-none text-black ring-1 ring-white/70">
            {imageCount}
          </span>
        </button>
      </div>

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
  const { projects, openImportWizard, isLoading, removeDataset, renameDatasetFolder } =
    useDatasetStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    project: DatasetProject;
  }>();
  const [pendingRemoval, setPendingRemoval] = useState<DatasetProject>();
  const [pendingRename, setPendingRename] = useState<DatasetProject>();
  const [renameValue, setRenameValue] = useState("");

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
      next.add("database-group");
      next.add("workspace-folder-group");
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
    const menuWidth = 184;
    const menuHeight = 80;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      project
    });
  };

  const startRename = (project: DatasetProject) => {
    setContextMenu(undefined);
    setPendingRename(project);
    setRenameValue(project.name);
  };

  const submitRename = async () => {
    if (!pendingRename) return;
    await renameDatasetFolder(pendingRename, renameValue);
    setPendingRename(undefined);
    setRenameValue("");
  };

  const databaseProjects = projects.filter((project) => project.sourceKind !== "folder");
  const folderProjects = projects.filter((project) => project.sourceKind === "folder");
  const databaseGroup: DatasetProject = {
    id: "database-group",
    name: t("tree.projects"),
    path: "",
    imageIds: databaseProjects.flatMap((project) => project.imageIds),
    children: databaseProjects,
    sourceKind: "database",
    datasetId: "database-group"
  };
  const workspaceFolderGroup: DatasetProject = {
    id: "workspace-folder-group",
    name: t("tree.workspaceFolders"),
    path: "",
    imageIds: folderProjects.flatMap((project) => project.imageIds),
    children: folderProjects,
    sourceKind: "folder",
    datasetId: "workspace-folder-group"
  };

  return (
    <aside className="fluent-sidebar flex h-full w-[248px] shrink-0 flex-col">
      <div className="no-drag px-3 pt-3">
        <button
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-white/70 bg-white/54 px-3 text-[13px] font-medium text-black transition hover:bg-white/72 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={openImportWizard}
          disabled={isLoading}
        >
          <Plus size={16} />
          <span className="truncate">{t("actions.importDataset")}</span>
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-3">
        <div className="no-drag space-y-1">
          <ProjectNode
            project={databaseGroup}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            openContextMenu={openContextMenu}
          />
          <ProjectNode
            project={workspaceFolderGroup}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            openContextMenu={openContextMenu}
          />
        </div>
      </div>
      {contextMenu
        ? createPortal(
            <div
              className="no-drag fixed z-50 min-w-[184px] rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {contextMenu.project.sourceKind !== "folder" ? (
                <>
                  <button
                    className="flex h-8 w-full items-center rounded px-3 text-left text-[12px] text-slate-700 transition hover:bg-slate-100"
                    onClick={() => startRename(contextMenu.project)}
                  >
                    {contextMenu.project.id.startsWith("dataset-root:")
                      ? t("tree.renameDataset")
                      : t("tree.renameFolder")}
                  </button>
                  <div className="my-1 h-px bg-slate-200" />
                </>
              ) : null}
              <button
                className="flex h-8 w-full items-center rounded px-3 text-left text-[12px] text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  const project = contextMenu.project;
                  setContextMenu(undefined);
                  setPendingRemoval(project);
                }}
              >
                {contextMenu.project.sourceKind === "folder"
                  ? t("tree.removeFolder")
                  : t("tree.removeDataset")}
              </button>
            </div>,
            document.body
          )
        : null}
      {pendingRename ? (
        <div
          className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/24 px-4"
          onClick={() => setPendingRename(undefined)}
        >
          <form
            className="w-full max-w-[360px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">
              {t("tree.renameTitle")}
            </h2>
            <label className="mt-4 block text-[12px] font-medium text-slate-600">
              {t("tree.renameNameLabel")}
            </label>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="glass-input mt-1 h-9 w-full px-3 text-[13px]"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50"
                onClick={() => setPendingRename(undefined)}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-slate-950 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!renameValue.trim()}
              >
                {t("actions.save")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {pendingRemoval ? (
        <div
          className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/24 px-4"
          onClick={() => setPendingRemoval(undefined)}
        >
          <div
            className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">
              {pendingRemoval.sourceKind === "folder"
                ? t("tree.confirmFolderTitle")
                : t("tree.confirmTitle")}
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-slate-600">
              {pendingRemoval.sourceKind === "folder"
                ? t("tree.confirmFolderDescription")
                : t("tree.confirmDescription")}
            </p>
            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
              <div className="truncate font-medium text-slate-900">{pendingRemoval.name}</div>
              <div className="truncate">{pendingRemoval.path}</div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50"
                onClick={() => setPendingRemoval(undefined)}
              >
                {t("actions.cancel")}
              </button>
              <button
                className="h-8 rounded-md bg-slate-950 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800"
                onClick={() => {
                  const project = pendingRemoval;
                  setPendingRemoval(undefined);
                  void removeDataset(project);
                }}
              >
                {t("tree.confirmRemove")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
