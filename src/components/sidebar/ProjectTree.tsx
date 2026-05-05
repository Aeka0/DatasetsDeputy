import {
  ChevronDown,
  ChevronRight,
  Database,
  DatabaseZap,
  Folder,
  FolderOpen,
  Folders,
  Loader2,
  Plus
} from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
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
  openContextMenu,
  problemImageIds
}: {
  project: DatasetProject;
  depth?: number;
  expandedIds: Set<string>;
  toggleExpanded: (project: DatasetProject) => void;
  openContextMenu: (event: MouseEvent, project: DatasetProject) => void;
  problemImageIds: Set<number>;
}) {
  const { selectedProjectId, selectProject } = useDatasetStore();
  const isSelected = selectedProjectId === project.id;
  const hasChildren = Boolean(project.children?.length);
  const isExpanded = expandedIds.has(project.id);
  const imageCount = project.imageIds.length;
  const isImportingNode = project.id.startsWith("importing-");
  const isAssetDatabaseNode = project.id === "asset-database-group" || project.id.startsWith("asset-root:");
  const isDynamicDatabaseNode = project.id === "database-group" || project.id.startsWith("dataset-root:");
  const isWorkspaceFolderGroup = project.id === "workspace-folder-group";
  const isGroupNode =
    project.id === "asset-database-group" ||
    project.id === "database-group" ||
    isWorkspaceFolderGroup;
  const datasetCount = project.children?.filter((child) => !child.id.startsWith("importing-")).length ?? 0;
  const problemCount = isGroupNode
    ? 0
    : project.imageIds.filter((imageId) => problemImageIds.has(imageId)).length;
  const displayCount = isGroupNode ? datasetCount : imageCount;
  const canOpenContextMenu = !isImportingNode;
  const indentation = isGroupNode ? 4 : 8 + depth * 10;

  const handleRowActivate = () => {
    if (isImportingNode) return;
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
          "project-tree-row no-drag flex h-8 w-full items-stretch gap-1 pr-2.5 text-left transition",
          isGroupNode ? "rounded-[3px]" : "rounded-md",
          sidebarLabelClass,
          isImportingNode
            ? "cursor-not-allowed text-black/36"
            : isSelected
            ? "project-tree-row-selected bg-white/62 text-black"
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
          {isImportingNode ? (
            project.sourceKind === "folder" ? (
              <Folder size={16} className="shrink-0 text-black/36" />
            ) : project.sourceKind === "database" ? (
              <DatabaseZap size={16} className="shrink-0 text-black/36" />
            ) : (
              <Database size={16} className="shrink-0 text-black/36" />
            )
          ) : isDynamicDatabaseNode ? (
            <DatabaseZap size={16} className="shrink-0 text-black" />
          ) : isAssetDatabaseNode ? (
            <Database size={16} className="shrink-0 text-black" />
          ) : isWorkspaceFolderGroup ? (
            <Folders size={16} className="shrink-0 text-black" />
          ) : isSelected ? (
            <FolderOpen size={16} className="shrink-0 text-black" />
          ) : (
            <Folder size={16} className="shrink-0 text-black" />
          )}
          <span className={cn("min-w-0 flex-1 truncate", sidebarLabelClass)}>{project.name}</span>
          {isImportingNode ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-black/40" />
          ) : (
            <span
              className={cn(
                "project-tree-count shrink-0 px-1.5 py-0.5 text-[11px] leading-none ring-1",
                problemCount > 0
                  ? "bg-orange-100 text-orange-700 ring-orange-200/80"
                  : "bg-white/72 text-black ring-white/70",
                isGroupNode ? "rounded-[3px]" : "rounded-full"
              )}
            >
              {problemCount > 0 ? `${problemCount}/${displayCount}` : displayCount}
            </span>
          )}
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
              problemImageIds={problemImageIds}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectTree() {
  const { t } = useTranslation();
  const {
    images,
    projects,
    openImportWizard,
    isLoading,
    pendingImportKind,
    refreshImages,
    checkProblemItems,
    removeDataset,
    renameDatasetFolder,
    createDatasetSubfolder
  } = useDatasetStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    project: DatasetProject;
  }>();
  const [pendingRemoval, setPendingRemoval] = useState<DatasetProject>();
  const [pendingRename, setPendingRename] = useState<DatasetProject>();
  const [pendingNewChild, setPendingNewChild] = useState<DatasetProject>();
  const [renameValue, setRenameValue] = useState("");
  const [newChildName, setNewChildName] = useState("");

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
      next.add("asset-database-group");
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

  const submitNewChild = async () => {
    if (!pendingNewChild) return;
    await createDatasetSubfolder(pendingNewChild, newChildName);
    setPendingNewChild(undefined);
    setNewChildName("");
  };

  const setProjectExpanded = (project: DatasetProject, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(project.id);
      } else {
        next.delete(project.id);
      }
      return next;
    });
  };

  const isVirtualRoot = (project: DatasetProject) =>
    project.id === "asset-database-group" ||
    project.id === "database-group" ||
    project.id === "workspace-folder-group";
  const isDatasetRoot = (project: DatasetProject) =>
    project.id.startsWith("asset-root:") ||
    project.id.startsWith("dataset-root:") ||
    project.id.startsWith("folder-root:");
  const isWorkspaceFolderChild = (project: DatasetProject) =>
    project.sourceKind === "folder" && !isVirtualRoot(project) && !project.id.startsWith("folder-root:");
  const canCreateChildFolder = (project: DatasetProject) => isDatasetRoot(project) && Boolean(project.path);
  const runProjectCheck = async (project: DatasetProject) => {
    setContextMenu(undefined);
    if (isVirtualRoot(project)) {
      for (const child of project.children ?? []) {
        await checkProblemItems(child);
      }
      return;
    }
    await checkProblemItems(project);
  };

  const assetProjects = projects.filter((project) => project.sourceKind === "asset");
  const databaseProjects = projects.filter(
    (project) => project.sourceKind !== "asset" && project.sourceKind !== "folder"
  );
  const folderProjects = projects.filter((project) => project.sourceKind === "folder");
  const problemImageIds = useMemo(
    () => new Set(images.filter((image) => image.sourceMissing).map((image) => image.id)),
    [images]
  );
  const importingProject: DatasetProject | undefined = pendingImportKind
    ? {
        id: `importing-${pendingImportKind}`,
        name:
          pendingImportKind === "folder"
            ? t("tree.importingFolder")
            : pendingImportKind === "asset"
            ? t("tree.importingAssetDatabase")
            : t("tree.importingDynamicDatabase"),
        path: "",
        imageIds: [],
        sourceKind: pendingImportKind,
        datasetId: `importing-${pendingImportKind}`
      }
    : undefined;
  const assetDatabaseChildren =
    importingProject?.sourceKind === "asset"
      ? [...assetProjects, importingProject]
      : assetProjects;
  const databaseChildren =
    importingProject?.sourceKind === "database"
      ? [...databaseProjects, importingProject]
      : databaseProjects;
  const folderChildren =
    importingProject?.sourceKind === "folder" ? [...folderProjects, importingProject] : folderProjects;
  const assetDatabaseGroup: DatasetProject = {
    id: "asset-database-group",
    name: t("tree.assetDatabases"),
    path: "",
    imageIds: assetProjects.flatMap((project) => project.imageIds),
    children: assetDatabaseChildren,
    sourceKind: "asset",
    datasetId: "asset-database-group"
  };
  const databaseGroup: DatasetProject = {
    id: "database-group",
    name: t("tree.dynamicDatabases"),
    path: "",
    imageIds: databaseProjects.flatMap((project) => project.imageIds),
    children: databaseChildren,
    sourceKind: "database",
    datasetId: "database-group"
  };
  const workspaceFolderGroup: DatasetProject = {
    id: "workspace-folder-group",
    name: t("tree.workspaceFolders"),
    path: "",
    imageIds: folderProjects.flatMap((project) => project.imageIds),
    children: folderChildren,
    sourceKind: "folder",
    datasetId: "workspace-folder-group"
  };

  return (
    <aside className="fluent-sidebar flex h-full w-[248px] shrink-0 flex-col">
      <div className="no-drag px-3 pt-3">
        <button
          className="project-tree-import-button flex h-8 w-full items-center justify-center gap-2 rounded-md border border-white/70 bg-white/54 px-3 text-[13px] font-medium text-black transition hover:bg-white/72 disabled:cursor-not-allowed disabled:opacity-50"
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
            project={assetDatabaseGroup}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            openContextMenu={openContextMenu}
            problemImageIds={problemImageIds}
          />
          <ProjectNode
            project={databaseGroup}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            openContextMenu={openContextMenu}
            problemImageIds={problemImageIds}
          />
          <ProjectNode
            project={workspaceFolderGroup}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            openContextMenu={openContextMenu}
            problemImageIds={problemImageIds}
          />
        </div>
      </div>
      {contextMenu
        ? createPortal(
            <div
              className="app-dropdown-menu no-drag fixed z-50 min-w-[184px] rounded-lg py-2"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="app-dropdown-backdrop" />
              <button
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!contextMenu.project.children?.length}
                onClick={() => {
                  const project = contextMenu.project;
                  setContextMenu(undefined);
                  setProjectExpanded(project, !expandedIds.has(project.id));
                }}
              >
                {expandedIds.has(contextMenu.project.id) ? t("tree.collapse") : t("tree.expand")}
              </button>
              <button
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  setContextMenu(undefined);
                  void refreshImages();
                }}
              >
                {t("tree.refresh")}
              </button>
              <button
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => void runProjectCheck(contextMenu.project)}
              >
                {t("tree.checkProblems")}
              </button>
              {canCreateChildFolder(contextMenu.project) ? (
                <button
                  className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                  onClick={() => {
                    setPendingNewChild(contextMenu.project);
                    setNewChildName("");
                    setContextMenu(undefined);
                  }}
                >
                  {t("tree.newChildFolder")}
                </button>
              ) : null}
              {!isVirtualRoot(contextMenu.project) && !isDatasetRoot(contextMenu.project) ? (
                <>
                  <div className="app-dropdown-separator my-1.5 h-px bg-slate-200" />
                  <button
                    className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                    onClick={() => startRename(contextMenu.project)}
                  >
                    {t("tree.renameFolder")}
                  </button>
                </>
              ) : null}
              {!isVirtualRoot(contextMenu.project) && !isDatasetRoot(contextMenu.project) ? (
                <button
                  className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                  onClick={() => {
                    const project = contextMenu.project;
                    setContextMenu(undefined);
                    setPendingRemoval(project);
                  }}
                >
                  {t("tree.delete")}
                </button>
              ) : null}
              <button
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                hidden={isVirtualRoot(contextMenu.project) || !isDatasetRoot(contextMenu.project)}
                onClick={() => {
                  const project = contextMenu.project;
                  setContextMenu(undefined);
                  setPendingRemoval(project);
                }}
              >
                {contextMenu.project.sourceKind === "folder"
                  ? t("tree.removeWorkspaceFolderPath")
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
      {pendingNewChild ? (
        <div
          className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/24 px-4"
          onClick={() => setPendingNewChild(undefined)}
        >
          <form
            className="w-full max-w-[360px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitNewChild();
            }}
          >
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">
              {t("tree.newChildFolderTitle")}
            </h2>
            <label className="mt-4 block text-[12px] font-medium text-slate-600">
              {t("tree.renameNameLabel")}
            </label>
            <input
              autoFocus
              value={newChildName}
              onChange={(event) => setNewChildName(event.target.value)}
              className="glass-input mt-1 h-9 w-full px-3 text-[13px]"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50"
                onClick={() => setPendingNewChild(undefined)}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-slate-950 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!newChildName.trim()}
              >
                {t("actions.create")}
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
              {isWorkspaceFolderChild(pendingRemoval)
                ? t("tree.confirmDeleteWorkspaceSubfolderTitle")
                : pendingRemoval.sourceKind === "folder"
                ? t("tree.confirmFolderTitle")
                : pendingRemoval.sourceKind === "asset"
                ? t("tree.confirmAssetTitle")
                : t("tree.confirmTitle")}
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-slate-600">
              {isWorkspaceFolderChild(pendingRemoval) ? (
                <>
                  {t("tree.confirmDeleteWorkspaceSubfolderDescriptionPrefix")}
                  <span className="text-rose-400">
                    {t("tree.confirmDeleteWorkspaceSubfolderDescriptionScope")}
                  </span>
                  {t("tree.confirmDeleteWorkspaceSubfolderDescriptionSuffix")}
                </>
              ) : pendingRemoval.sourceKind === "folder" ? (
                t("tree.confirmFolderDescription")
              ) : pendingRemoval.sourceKind === "asset" ? (
                <>
                  {t("tree.confirmAssetDescriptionPrefix")}
                  <span className="text-rose-400">{t("tree.confirmAssetDescriptionScope")}</span>
                  {t("tree.confirmAssetDescriptionSuffix")}
                </>
              ) : (
                <>
                  {t("tree.confirmDescriptionPrefix")}
                  <span className="text-rose-400">{t("tree.confirmDescriptionScope")}</span>
                  {t("tree.confirmDescriptionSuffix")}
                </>
              )}
            </p>
            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
              <div className="truncate font-medium text-slate-900">{pendingRemoval.name}</div>
              {pendingRemoval.sourceKind === "folder" ? (
                <div className="truncate">{pendingRemoval.path}</div>
              ) : null}
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
                {isWorkspaceFolderChild(pendingRemoval)
                  ? t("tree.confirmDelete")
                  : t("tree.confirmRemove")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
