import {
  Check,
  ChevronDown,
  FolderOpen,
  Grid3X3,
  ImageIcon,
  ImagePlus,
  Info,
  Pencil,
  RefreshCw,
  Search,
  Table2,
  X
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { formatAppError } from "../../lib/errors";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import { useDatasetStore, type ViewFilterMode } from "../../stores/datasetStore";
import type {
  AnnotationProfile,
  DatasetImage,
  DatasetProject,
  FolderImageImportPreview,
  FolderImageImportSummary
} from "../../types";
import { DatasetGrid } from "../grid/DatasetGrid";
import { DatasetTable } from "../table/DatasetTable";

type WorkspaceTab = "overview" | "grid" | "table";
type ImageContextMenuState = {
  image: DatasetImage;
  left: number;
  top: number;
};

const tabs: Array<{ id: WorkspaceTab; labelKey: string; icon: typeof Info }> = [
  { id: "overview", labelKey: "workspace.overview", icon: Info },
  { id: "grid", labelKey: "workspace.grid", icon: Grid3X3 },
  { id: "table", labelKey: "workspace.table", icon: Table2 }
];

const folderImageImportCopy = {
  button: "导入图片",
  title: "确认导入图片",
  targetFolder: "目标文件夹",
  sourceLocation: "原始图片位置",
  assetStorage: "资产库存储",
  databaseNote: "仅加入数据库索引，不移动或复制原文件。",
  assetNote: "图片会复制到应用资产库，原路径仅作为导入记录保留。",
  assetStorageValue: "应用受管资产库",
  imageCount: "图片数量",
  annotationCount: "检测到标注",
  instructionCount: "检测到指令",
  annotationType: "导入标注类型",
  noProfiles: "当前数据集没有可用的标注类型。",
  cancel: "取消",
  confirm: "确认导入",
  importing: "正在导入...",
  unsupported: "导入图片仅支持数据集子文件夹。",
  selectFailed: "选择图片失败",
  importFailed: "导入图片失败"
};

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

function isVirtualProjectRoot(project: DatasetProject | undefined) {
  return (
    project?.id === "asset-database-group" ||
    project?.id === "database-group" ||
    project?.id === "workspace-folder-group"
  );
}

function isDatasetRoot(project: DatasetProject | undefined) {
  return (
    project?.id.startsWith("asset-root:") ||
    project?.id.startsWith("dataset-root:") ||
    project?.id.startsWith("folder-root:")
  );
}

function isImportableDatasetChild(project: DatasetProject | undefined) {
  return (
    (project?.sourceKind === "folder" ||
      project?.sourceKind === "database" ||
      project?.sourceKind === "asset") &&
    !isVirtualProjectRoot(project) &&
    !isDatasetRoot(project)
  );
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
  search: string,
  viewFilterMode: ViewFilterMode,
  viewFilterImageIds: number[]
) {
  const projectIds = selectedProject?.imageIds ?? [];
  const filteredIds = viewFilterMode === "all" ? undefined : new Set(viewFilterImageIds);
  const query = search.trim().toLowerCase();

  return images.filter((image) => {
    const inProject = projectIds.length === 0 || projectIds.includes(image.id);
    if (!inProject) return false;
    if (filteredIds && !filteredIds.has(image.id)) return false;
    if (!query) return true;

    return [image.fileName, ...image.annotations.map((annotation) => annotation.content)]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function getProjectImages(images: DatasetImage[], selectedProject: DatasetProject | undefined) {
  const projectIds = selectedProject?.imageIds ?? [];
  return images.filter((image) => projectIds.length === 0 || projectIds.includes(image.id));
}

function getAnnotationForProfile(image: DatasetImage, profileId: number | undefined) {
  if (profileId === undefined) return undefined;
  return image.annotations.find((annotation) => annotation.profileId === profileId);
}

function getEffectiveProfileId(
  images: DatasetImage[],
  selectedProject: DatasetProject | undefined,
  activeProfileId: number | undefined
) {
  if (!selectedProject) return activeProfileId;
  const projectImages = images.filter((image) => selectedProject.imageIds.includes(image.id));

  if (selectedProject.sourceKind === "folder") {
    const projectProfileIds = new Set(
      projectImages.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
    );
    if (activeProfileId !== undefined && projectProfileIds.has(activeProfileId)) {
      return activeProfileId;
    }
    return projectImages.at(0)?.annotations.at(0)?.profileId;
  }

  return activeProfileId;
}

function hasEffectiveAnnotation(image: DatasetImage, profileId: number | undefined) {
  if (profileId === undefined) {
    return image.annotations.some((annotation) => annotation.content.trim());
  }
  return Boolean(getAnnotationForProfile(image, profileId)?.content.trim());
}

function hasUnsavedChange(
  image: DatasetImage,
  profileId: number | undefined,
  tableDraftProfileId: number | undefined,
  annotationDrafts: Record<number, string>,
  instructionDrafts: Record<number, string>
) {
  if (profileId === undefined || tableDraftProfileId !== profileId) return false;

  const annotation = getAnnotationForProfile(image, profileId);
  return (
    (annotationDrafts[image.id] ?? "") !== (annotation?.content ?? "") ||
    (instructionDrafts[image.id] ?? "") !== (annotation?.instruction ?? "")
  );
}

function createViewFilterImageIds({
  mode,
  images,
  selectedProject,
  activeProfileId,
  tableDraftProfileId,
  annotationDrafts,
  instructionDrafts
}: {
  mode: ViewFilterMode;
  images: DatasetImage[];
  selectedProject: DatasetProject | undefined;
  activeProfileId: number | undefined;
  tableDraftProfileId: number | undefined;
  annotationDrafts: Record<number, string>;
  instructionDrafts: Record<number, string>;
}) {
  if (mode === "all") return [];

  const projectIds = new Set(selectedProject?.imageIds ?? []);
  const profileId = getEffectiveProfileId(images, selectedProject, activeProfileId);
  return images
    .filter((image) => projectIds.size === 0 || projectIds.has(image.id))
    .filter((image) =>
      mode === "unannotated"
        ? !hasEffectiveAnnotation(image, profileId)
        : hasUnsavedChange(
            image,
            profileId,
            tableDraftProfileId,
            annotationDrafts,
            instructionDrafts
          )
    )
    .map((image) => image.id);
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

function getDirectoryFromPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
}

function getCommonPath(paths: string[]) {
  const directories = paths.map(getDirectoryFromPath).filter(Boolean);
  if (directories.length === 0) return "-";

  const [firstDirectory, ...restDirectories] = directories;
  const parts = firstDirectory.split("/");
  let end = parts.length;

  for (const directory of restDirectories) {
    const currentParts = directory.split("/");
    end = Math.min(end, currentParts.length);
    for (let index = 0; index < end; index += 1) {
      if (parts[index].toLocaleLowerCase() !== currentParts[index].toLocaleLowerCase()) {
        end = index;
        break;
      }
    }
  }

  return parts.slice(0, end).join("/") || firstDirectory;
}

function FolderImageImportDialog({
  preview,
  sourceKind,
  profiles,
  selectedProfileId,
  isImporting,
  error,
  onProfileChange,
  onClose,
  onConfirm
}: {
  preview: FolderImageImportPreview;
  sourceKind?: DatasetProject["sourceKind"];
  profiles: AnnotationProfile[];
  selectedProfileId?: number;
  isImporting: boolean;
  error: string;
  onProfileChange: (profileId: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const needsProfile = preview.annotationCount > 0 || preview.instructionCount > 0;
  const canImport = preview.imageCount > 0 && (!needsProfile || selectedProfileId !== undefined);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const locationLabel =
    sourceKind === "database"
      ? folderImageImportCopy.sourceLocation
      : sourceKind === "asset"
      ? folderImageImportCopy.assetStorage
      : folderImageImportCopy.targetFolder;
  const locationValue =
    sourceKind === "database"
      ? getCommonPath(preview.imagePaths)
      : sourceKind === "asset"
      ? folderImageImportCopy.assetStorageValue
      : preview.targetFolderPath;
  const locationNote =
    sourceKind === "database"
      ? folderImageImportCopy.databaseNote
      : sourceKind === "asset"
      ? folderImageImportCopy.assetNote
      : "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-4">
      <div
        className="no-drag w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
            <ImagePlus size={17} />
            {folderImageImportCopy.title}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            disabled={isImporting}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 text-[13px]">
          <section>
            <div className="font-medium text-slate-600">{locationLabel}</div>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[12px] leading-5 text-slate-700">
              {locationValue}
            </div>
            {locationNote ? (
              <div className="mt-1 text-[12px] leading-5 text-slate-500">{locationNote}</div>
            ) : null}
          </section>

          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-slate-950">
                {preview.imageCount}
              </div>
              <div className="mt-1 text-slate-500">{folderImageImportCopy.imageCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-slate-950">
                {preview.annotationCount}
              </div>
              <div className="mt-1 text-slate-500">{folderImageImportCopy.annotationCount}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-slate-950">
                {preview.instructionCount}
              </div>
              <div className="mt-1 text-slate-500">{folderImageImportCopy.instructionCount}</div>
            </div>
          </section>

          <section>
            <label className="block font-medium text-slate-600">
              {folderImageImportCopy.annotationType}
            </label>
            <div className="relative mt-2">
              <button
                type="button"
                className="glass-input no-drag flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={profiles.length === 0 || isImporting}
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {selectedProfile?.name ?? folderImageImportCopy.noProfiles}
                </span>
                <ChevronDown size={15} className="shrink-0 text-slate-400" />
              </button>
              {profileMenuOpen ? (
                <div className="app-dropdown-menu no-drag absolute left-0 top-10 z-[70] w-full rounded-lg py-2">
                  <div className="app-dropdown-backdrop" />
                  {profiles.map((profile) => {
                    const isSelected = profile.id === selectedProfileId;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() => {
                          onProfileChange(profile.id);
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
            {profiles.length === 0 ? (
              <div className="mt-1 text-[12px] text-red-600">
                {folderImageImportCopy.noProfiles}
              </div>
            ) : null}
          </section>

          {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</div> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={onClose}
            disabled={isImporting}
          >
            {folderImageImportCopy.cancel}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={!canImport || isImporting}
          >
            <ImagePlus size={15} />
            {isImporting ? folderImageImportCopy.importing : folderImageImportCopy.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ImageRenameDialog({
  image,
  value,
  error,
  isSaving,
  onChange,
  onClose,
  onConfirm
}: {
  image: DatasetImage;
  value: string;
  error: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-4">
      <div className="no-drag w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
            <Pencil size={16} />
            {t("itemMenu.renameTitle")}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            disabled={isSaving}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">
          <label className="block text-[13px] font-medium text-slate-600">
            {t("itemMenu.nameLabel")}
          </label>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="glass-input mt-2 h-9 w-full px-3 text-[13px]"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirm();
              }
            }}
            disabled={isSaving}
            placeholder={image.fileName}
          />
          {error ? <div className="mt-2 text-[12px] text-red-600">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={onClose}
            disabled={isSaving}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={!value.trim() || isSaving}
          >
            {isSaving ? t("itemMenu.renaming") : t("itemMenu.rename")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ImageDeleteDialog({
  image,
  error,
  isDeleting,
  onClose,
  onConfirm
}: {
  image: DatasetImage;
  error: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const editedAnnotationTypeCount = new Set(
    image.annotations
      .filter((annotation) => annotation.content.trim() || annotation.instruction.trim())
      .map((annotation) => annotation.profileId)
  ).size;
  const isFolderImage = image.sourceKind === "folder";
  const isAssetImage = image.sourceKind === "asset";
  const deletedDescription = isFolderImage
    ? t("itemMenu.deletedFolderImage")
    : isAssetImage
    ? t("itemMenu.deletedAssetImage", { count: editedAnnotationTypeCount })
    : t("itemMenu.deletedDatabaseImage", { count: editedAnnotationTypeCount });
  const keptDescription = isFolderImage
    ? t("itemMenu.keptFolderImage")
    : isAssetImage
    ? t("itemMenu.keptAssetImage")
    : t("itemMenu.keptDatabaseImage");

  return createPortal(
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/24 px-4">
      <div className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h2 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">
          {t("itemMenu.deleteTitle")}
        </h2>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-5">
          <div className="truncate font-medium text-slate-900">{image.fileName}</div>
          <div className="truncate text-slate-500">{image.path}</div>
        </div>
        <div className="mt-4 space-y-3 text-[13px] leading-5">
          <div>
            <div className="font-medium text-slate-950">{t("deleteDetails.deletedTitle")}</div>
            <div className="mt-1 text-rose-400">{deletedDescription}</div>
          </div>
          {!isFolderImage ? (
            <div>
              <div className="font-medium text-slate-950">{t("deleteDetails.keptTitle")}</div>
              <div className="mt-1 text-slate-600">{keptDescription}</div>
            </div>
          ) : null}
        </div>
        {error ? <div className="mt-3 text-[12px] text-red-600">{error}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={onClose}
            disabled={isDeleting}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-slate-950 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? t("itemMenu.deleting") : t("itemMenu.confirmDelete")}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
          {selectedProject?.sourceKind === "folder" ? (
            <PropertyRow label={t("workspace.path")} value={selectedProject.path} mono />
          ) : null}
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
    viewFilterMode,
    viewFilterProjectId,
    viewFilterImageIds,
    activeProfileId,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    isCheckingProblemItems,
    setSearch,
    setViewFilter,
    setWorkspaceTab,
    refreshImages,
    addAppLog,
    checkProblemItems,
    selectImage,
    renameDatasetImage,
    deleteDatasetImage
  } = useDatasetStore();
  const [folderImportPreview, setFolderImportPreview] = useState<FolderImageImportPreview>();
  const [folderImportProfileId, setFolderImportProfileId] = useState<number>();
  const [folderImportError, setFolderImportError] = useState("");
  const [isPreparingFolderImport, setIsPreparingFolderImport] = useState(false);
  const [isImportingImages, setIsImportingImages] = useState(false);
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState>();
  const [renameImage, setRenameImage] = useState<DatasetImage>();
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenamingImage, setIsRenamingImage] = useState(false);
  const [deleteImage, setDeleteImage] = useState<DatasetImage>();
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingImage, setIsDeletingImage] = useState(false);
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
    () => getVisibleImages(images, selectedProject, search, viewFilterMode, viewFilterImageIds),
    [images, search, selectedProject, viewFilterImageIds, viewFilterMode]
  );
  const projectImageCount = useMemo(
    () => getProjectImages(images, selectedProject).length,
    [images, selectedProject]
  );
  const shouldShowFilterEmptyState =
    activeTab !== "overview" &&
    viewFilterMode !== "all" &&
    visibleImages.length === 0 &&
    projectImageCount > 0;
  const selectedVisibleImageCount = useMemo(() => {
    const visibleImageIds = new Set(visibleImages.map((image) => image.id));
    return selectedImageIds.filter((imageId) => visibleImageIds.has(imageId)).length;
  }, [selectedImageIds, visibleImages]);
  const visibleProblemItemCount = useMemo(
    () => visibleImages.filter((image) => image.sourceMissing).length,
    [visibleImages]
  );
  const folderImportProfiles = useMemo(
    () => profiles.filter((profile) => profile.datasetId === selectedProject?.datasetId),
    [profiles, selectedProject?.datasetId]
  );
  const tableProfiles = useMemo(() => {
    const projectImages = getProjectImages(images, selectedProject);
    const projectProfileIds = new Set(
      projectImages.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
    );
    const projectDatasetIds = new Set(projectImages.map((image) => image.datasetId).filter(Boolean));
    if (selectedProject?.datasetId) {
      projectDatasetIds.add(selectedProject.datasetId);
    }

    const matchedProfiles = profiles.filter(
      (profile) =>
        projectProfileIds.has(profile.id) ||
        (profile.datasetId !== undefined && projectDatasetIds.has(profile.datasetId))
    );
    const matchedProfileIds = new Set(matchedProfiles.map((profile) => profile.id));
    const inferredProfiles: AnnotationProfile[] = Array.from(projectProfileIds)
      .filter((profileId) => !matchedProfileIds.has(profileId))
      .map((profileId) => ({
        id: profileId,
        name: `Profile ${profileId}`,
        datasetId: selectedProject?.datasetId
      }));

    const projectProfiles = [...matchedProfiles, ...inferredProfiles];
    return projectProfiles.length > 0 ? projectProfiles : profiles;
  }, [images, profiles, selectedProject]);
  const canImportImagesToFolder =
    isImportableDatasetChild(selectedProject) && Boolean(selectedProject?.datasetId);

  useEffect(() => {
    if (viewFilterMode === "all" || viewFilterProjectId === selectedProjectId) return;

    setViewFilter(
      viewFilterMode,
      selectedProjectId,
      createViewFilterImageIds({
        mode: viewFilterMode,
        images,
        selectedProject,
        activeProfileId,
        tableDraftProfileId,
        annotationDrafts: tableAnnotationDrafts,
        instructionDrafts: tableInstructionDrafts
      })
    );
  }, [
    activeProfileId,
    images,
    selectedProject,
    selectedProjectId,
    setViewFilter,
    tableAnnotationDrafts,
    tableDraftProfileId,
    tableInstructionDrafts,
    viewFilterMode,
    viewFilterProjectId
  ]);

  useEffect(() => {
    if (!imageContextMenu) return;

    const close = () => setImageContextMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [imageContextMenu]);

  const openImageContextMenu = (
    image: DatasetImage,
    event: ReactMouseEvent<HTMLElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    selectImage(image.id);
    setImageContextMenu({
      image,
      left: Math.min(event.clientX, window.innerWidth - 180),
      top: Math.min(event.clientY, window.innerHeight - 96)
    });
  };

  const startRenameImage = (image: DatasetImage) => {
    setImageContextMenu(undefined);
    setRenameImage(image);
    setRenameName(image.fileName);
    setRenameError("");
  };

  const confirmRenameImage = async () => {
    if (!renameImage || isRenamingImage) return;

    setIsRenamingImage(true);
    setRenameError("");
    try {
      await renameDatasetImage(renameImage, renameName);
      setRenameImage(undefined);
    } catch (error) {
      setRenameError(formatAppError(error));
    } finally {
      setIsRenamingImage(false);
    }
  };

  const startDeleteImage = (image: DatasetImage) => {
    setImageContextMenu(undefined);
    setDeleteImage(image);
    setDeleteError("");
  };

  const confirmDeleteImage = async () => {
    if (!deleteImage || isDeletingImage) return;

    setIsDeletingImage(true);
    setDeleteError("");
    try {
      await deleteDatasetImage(deleteImage);
      setDeleteImage(undefined);
    } catch (error) {
      setDeleteError(formatAppError(error));
    } finally {
      setIsDeletingImage(false);
    }
  };

  const prepareFolderImageImport = async () => {
    if (!hasTauriRuntime() || !selectedProject?.datasetId || !canImportImagesToFolder) return;

    setIsPreparingFolderImport(true);
    setFolderImportError("");
    try {
      const preview = await invokeCommand<FolderImageImportPreview>("prepare_folder_image_import", {
        datasetId: selectedProject.datasetId,
        targetFolderPath: selectedProject.path
      });
      const defaultProfileId =
        folderImportProfiles.find((profile) => profile.id === folderImportProfileId)?.id ??
        folderImportProfiles[0]?.id;
      setFolderImportPreview(preview);
      setFolderImportProfileId(defaultProfileId);
      addAppLog(
        `图片导入预览完成：选择 ${preview.imageCount} 张图片，检测到 ${preview.annotationCount} 份标注和 ${preview.instructionCount} 份指令。`
      );
    } catch (error) {
      const payload = error as { code?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setFolderImportError(`${folderImageImportCopy.selectFailed}：${message}`);
        addAppLog(`${folderImageImportCopy.selectFailed}：${message}`, "error");
      }
    } finally {
      setIsPreparingFolderImport(false);
    }
  };

  const confirmFolderImageImport = async () => {
    if (!folderImportPreview || !selectedProject?.datasetId) return;

    setIsImportingImages(true);
    setFolderImportError("");
    try {
      const summary = await invokeCommand<FolderImageImportSummary>("import_images_to_folder", {
        datasetId: selectedProject.datasetId,
        targetFolderPath: folderImportPreview.targetFolderPath,
        imagePaths: folderImportPreview.imagePaths,
        profileId: folderImportProfileId
      });
      await refreshImages();
      addAppLog(
        `图片导入完成：导入 ${summary.imported} 张，跳过 ${summary.skipped} 张，失败 ${summary.failed} 张；导入标注 ${summary.annotationCount} 份，指令 ${summary.instructionCount} 份。`
      );
      setFolderImportPreview(undefined);
    } catch (error) {
      const message = formatAppError(error);
      setFolderImportError(`${folderImageImportCopy.importFailed}：${message}`);
      addAppLog(`${folderImageImportCopy.importFailed}：${message}`, "error");
    } finally {
      setIsImportingImages(false);
    }
  };

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
        <button
          type="button"
          className="no-drag inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void prepareFolderImageImport()}
          disabled={!canImportImagesToFolder || isPreparingFolderImport}
          title={
            canImportImagesToFolder
              ? folderImageImportCopy.button
              : folderImageImportCopy.unsupported
          }
        >
          <ImagePlus size={15} />
          <span>{folderImageImportCopy.button}</span>
        </button>
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
      ) : shouldShowFilterEmptyState ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-12 text-center">
          <ImageIcon size={44} className="mb-4 text-slate-300" />
          <h2 className="m-0 text-xl font-semibold text-slate-900">
            {t("workspace.noFilterMatches")}
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            {t("workspace.filterHiddenHint")}
          </p>
        </div>
      ) : activeTab === "grid" ? (
        <DatasetGrid images={visibleImages} onImageContextMenu={openImageContextMenu} />
      ) : (
        <DatasetTable
          images={visibleImages}
          profiles={tableProfiles}
          onImageContextMenu={openImageContextMenu}
        />
      )}

      {imageContextMenu
        ? createPortal(
            <div
              className="app-dropdown-menu no-drag fixed z-50 min-w-[184px] rounded-lg py-2"
              style={{ left: imageContextMenu.left, top: imageContextMenu.top }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="app-dropdown-backdrop" />
              <button
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => startRenameImage(imageContextMenu.image)}
              >
                <span>{t("itemMenu.rename")}</span>
              </button>
              <div className="app-dropdown-separator my-1.5 h-px bg-slate-200" />
              <button
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => startDeleteImage(imageContextMenu.image)}
              >
                <span>{t("itemMenu.delete")}</span>
              </button>
            </div>,
            document.body
          )
        : null}

      {renameImage ? (
        <ImageRenameDialog
          image={renameImage}
          value={renameName}
          error={renameError}
          isSaving={isRenamingImage}
          onChange={(value) => {
            setRenameName(value);
            setRenameError("");
          }}
          onClose={() => {
            if (!isRenamingImage) {
              setRenameImage(undefined);
              setRenameError("");
            }
          }}
          onConfirm={() => void confirmRenameImage()}
        />
      ) : null}

      {deleteImage ? (
        <ImageDeleteDialog
          image={deleteImage}
          error={deleteError}
          isDeleting={isDeletingImage}
          onClose={() => {
            if (!isDeletingImage) {
              setDeleteImage(undefined);
              setDeleteError("");
            }
          }}
          onConfirm={() => void confirmDeleteImage()}
        />
      ) : null}

      {folderImportPreview ? (
        <FolderImageImportDialog
          preview={folderImportPreview}
          sourceKind={selectedProject?.sourceKind}
          profiles={folderImportProfiles}
          selectedProfileId={folderImportProfileId}
          isImporting={isImportingImages}
          error={folderImportError}
          onProfileChange={setFolderImportProfileId}
          onClose={() => {
            if (!isImportingImages) {
              setFolderImportPreview(undefined);
              setFolderImportError("");
            }
          }}
          onConfirm={() => void confirmFolderImageImport()}
        />
      ) : null}
    </div>
  );
}
