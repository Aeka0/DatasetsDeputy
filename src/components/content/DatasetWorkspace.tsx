import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  Ellipsis,
  FolderOpen,
  Grid3X3,
  HardDrive,
  ImageIcon,
  ImagePlus,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../../lib/cn";
import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { formatDialogMenuLabel } from "../../lib/menuLabels";
import { findProjectTrail, flattenProjects, getProjectDisplayName } from "../../lib/projects";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import { useDatasetStore, type ViewFilterMode } from "../../stores/datasetStore";
import type {
  AnnotationChange,
  AnnotationProfile,
  DatasetImage,
  DatasetProject,
  FolderImageImportPreview,
  FolderImageImportSummary
} from "../../types";
import { DatasetGrid } from "../grid/DatasetGrid";
import { DatasetTable } from "../table/DatasetTable";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";

type WorkspaceTab = "overview" | "grid" | "table";
type ImageContextMenuState = {
  image: DatasetImage;
  left: number;
  top: number;
};

function ProjectPathBreadcrumb({
  trail,
  fallbackPath,
  onSelectProject,
  className,
  currentClassName = "font-semibold text-neutral-950",
  ancestorClassName = "font-normal text-neutral-500",
  showRealFolderPath = false
}: {
  trail: DatasetProject[];
  fallbackPath?: string;
  onSelectProject: (id: string) => void;
  className?: string;
  currentClassName?: string;
  ancestorClassName?: string;
  showRealFolderPath?: boolean;
}) {
  const { t } = useTranslation();
  const shouldShowRealFolderPath =
    showRealFolderPath && trail.some((project) => project.sourceKind === "folder");
  const getDisplayName = (project: DatasetProject, index: number) => {
    if (shouldShowRealFolderPath) {
      return index === 0 ? project.path || project.name : project.name || project.path;
    }

    return getProjectDisplayName(project, () => t("tree.looseFiles"));
  };

  if (!trail.length) {
    return fallbackPath ? (
      <span className={cn("truncate", className)} title={showRealFolderPath ? fallbackPath : undefined}>
        {fallbackPath}
      </span>
    ) : null;
  }

  return (
    <span
      className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5", className)}
      aria-label={t("aria.currentFolderPath")}
    >
      {trail.map((project, index) => {
        const isCurrent = index === trail.length - 1;
        const label = getDisplayName(project, index);
        const title = shouldShowRealFolderPath ? project.path : undefined;

        return (
          <span key={project.id} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 ? <span className="shrink-0 text-neutral-400">/</span> : null}
            {isCurrent ? (
              <span className={cn("max-w-[220px] truncate", currentClassName)} title={title}>
                {label}
              </span>
            ) : (
              <button
                type="button"
                className={cn(
                  "no-drag max-w-[220px] truncate rounded-[3px] border-0 bg-transparent p-0 text-left underline-offset-2 outline-none transition hover:text-neutral-900 hover:underline focus-visible:ring-2 focus-visible:ring-neutral-300",
                  ancestorClassName
                )}
                title={title}
                onClick={() => onSelectProject(project.id)}
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}

const tabs: Array<{ id: WorkspaceTab; labelKey: string; icon: typeof Info }> = [
  { id: "grid", labelKey: "workspace.grid", icon: Grid3X3 },
  { id: "table", labelKey: "workspace.table", icon: Table2 },
  { id: "overview", labelKey: "workspace.overview", icon: Info }
];


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

function getImageDraftChange(
  image: DatasetImage,
  profileId: number | undefined,
  tableDraftProfileId: number | undefined,
  annotationDrafts: Record<number, string>,
  instructionDrafts: Record<number, string>
) {
  if (profileId === undefined || tableDraftProfileId !== profileId) return undefined;

  const annotation = getAnnotationForProfile(image, profileId);
  const content = annotationDrafts[image.id] ?? "";
  const instruction = instructionDrafts[image.id] ?? "";
  const contentChanged = content !== (annotation?.content ?? "");
  const instructionChanged = instruction !== (annotation?.instruction ?? "");

  if (!contentChanged && !instructionChanged) return undefined;

  const change: AnnotationChange = {
    imageId: image.id,
    profileId
  };

  if (contentChanged) {
    change.content = content;
  }
  if (instructionChanged) {
    change.instruction = instruction;
  }

  return change;
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
  const { t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const needsProfile = preview.annotationCount > 0 || preview.instructionCount > 0;
  const canImport = preview.imageCount > 0 && (!needsProfile || selectedProfileId !== undefined);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const locationLabel =
    sourceKind === "database"
      ? t("folderImport.sourceLocation")
      : sourceKind === "asset"
      ? t("folderImport.assetStorage")
      : t("folderImport.targetFolder");
  const locationValue =
    sourceKind === "database"
      ? getCommonPath(preview.imagePaths)
      : sourceKind === "asset"
      ? t("folderImport.assetStorageValue")
      : preview.targetFolderPath;
  const locationNote =
    sourceKind === "database"
      ? t("folderImport.databaseNote")
      : sourceKind === "asset"
      ? t("folderImport.assetNote")
      : "";

  return (
    <AnimatedPortal open={open}>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/25 px-4">
      <div
        className="no-drag w-full max-w-lg rounded-lg border border-neutral-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-12 items-center justify-between border-b border-neutral-100 px-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900">
            <ImagePlus size={17} />
            {t("folderImport.title")}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            onClick={close}
            disabled={isImporting}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 text-[13px]">
          <section>
            <div className="font-medium text-neutral-600">{locationLabel}</div>
            <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-[12px] leading-5 text-neutral-700">
              {locationValue}
            </div>
            {locationNote ? (
              <div className="mt-1 text-[12px] leading-5 text-neutral-500">{locationNote}</div>
            ) : null}
          </section>

          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-neutral-950">
                {preview.imageCount}
              </div>
              <div className="mt-1 text-neutral-500">{t("folderImport.imageCount")}</div>
            </div>
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-neutral-950">
                {preview.annotationCount}
              </div>
              <div className="mt-1 text-neutral-500">{t("folderImport.annotationCount")}</div>
            </div>
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="text-[22px] font-semibold leading-7 text-neutral-950">
                {preview.instructionCount}
              </div>
              <div className="mt-1 text-neutral-500">{t("folderImport.instructionCount")}</div>
            </div>
          </section>

          <section>
            <label className="block font-medium text-neutral-600">
              {t("folderImport.annotationType")}
            </label>
            <div className="relative mt-2">
              <button
                type="button"
                className="glass-input no-drag flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] disabled:cursor-not-allowed disabled:text-neutral-400"
                disabled={profiles.length === 0 || isImporting}
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {selectedProfile?.name ?? t("folderImport.noProfiles")}
                </span>
                <ChevronDown size={15} className="shrink-0 text-neutral-400" />
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
                        className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-100"
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
                {t("folderImport.noProfiles")}
              </div>
            ) : null}
          </section>

          {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</div> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
            onClick={close}
            disabled={isImporting}
          >
            {t("folderImport.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={!canImport || isImporting}
          >
            <ImagePlus size={15} />
            {isImporting ? t("folderImport.importing") : t("folderImport.confirm")}
          </button>
        </div>
      </div>
    </div>
    </AnimatedPortal>
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
  const { open, close } = useAnimatedPortalClose(onClose);

  return (
    <AnimatedPortal open={open}>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/25 px-4">
      <div className="no-drag w-full max-w-sm rounded-lg border border-neutral-200 bg-white shadow-xl">
        <div className="flex h-12 items-center justify-between border-b border-neutral-100 px-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-neutral-900">
            <Pencil size={16} />
            {t("itemMenu.renameTitle")}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            onClick={close}
            disabled={isSaving}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">
          <label className="block text-[13px] font-medium text-neutral-600">
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
        <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
            onClick={close}
            disabled={isSaving}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={!value.trim() || isSaving}
          >
            {isSaving ? t("itemMenu.renaming") : t("itemMenu.rename")}
          </button>
        </div>
      </div>
    </div>
    </AnimatedPortal>
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
  const { open, close } = useAnimatedPortalClose(onClose);
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

  return (
    <AnimatedPortal open={open}>
    <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/24 px-4">
      <div className="w-full max-w-[420px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl">
        <h2 className="m-0 text-[15px] font-semibold leading-6 text-neutral-950">
          {t("itemMenu.deleteTitle")}
        </h2>
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[12px] leading-5">
          <div className="truncate font-medium text-neutral-900">{image.fileName}</div>
          <div className="truncate text-neutral-500">{image.path}</div>
        </div>
        <div className="mt-4 space-y-3 text-[13px] leading-5">
          <div>
            <div className="font-medium text-neutral-950">{t("deleteDetails.deletedTitle")}</div>
            <div className="mt-1 text-rose-400">{deletedDescription}</div>
          </div>
          {!isFolderImage ? (
            <div>
              <div className="font-medium text-neutral-950">{t("deleteDetails.keptTitle")}</div>
              <div className="mt-1 text-neutral-600">{keptDescription}</div>
            </div>
          ) : null}
        </div>
        {error ? <div className="mt-3 text-[12px] text-red-600">{error}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
            onClick={close}
            disabled={isDeleting}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-neutral-950 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? t("itemMenu.deleting") : t("itemMenu.confirmDelete")}
          </button>
        </div>
      </div>
    </div>
    </AnimatedPortal>
  );
}

function DatasetOverview({
  images,
  selectedProject,
  profiles,
  isCheckingProblemItems,
  checkProblemItems,
  createAnnotationProfile,
  renameAnnotationProfile,
  duplicateAnnotationProfile,
  deleteAnnotationProfile,
  addAppLog
}: {
  images: DatasetImage[];
  selectedProject: DatasetProject | undefined;
  profiles: AnnotationProfile[];
  isCheckingProblemItems: boolean;
  checkProblemItems: (project?: DatasetProject) => Promise<unknown>;
  createAnnotationProfile: (name: string) => Promise<number | undefined>;
  renameAnnotationProfile: (profileId: number, newName: string) => Promise<void>;
  duplicateAnnotationProfile: (profileId: number, newName: string) => Promise<void>;
  deleteAnnotationProfile: (profileId: number) => Promise<void>;
  addAppLog: (message: string, level?: "info" | "warning" | "error") => void;
}) {
  const { t } = useTranslation();
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createProfileError, setCreateProfileError] = useState("");
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false);

  const [profileMenuId, setProfileMenuId] = useState<number>();
  const [renamingProfileId, setRenamingProfileId] = useState<number>();
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<{ id: number; name: string }>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (profileMenuId === undefined) return;
    const close = () => setProfileMenuId(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuId]);

  const selectedProjectName = selectedProject
    ? getProjectDisplayName(selectedProject, () => t("tree.looseFiles"))
    : undefined;
  const totalSize = images.reduce((sum, image) => sum + (image.fileSize ?? 0), 0);
  const problemItems = images.filter((image) => image.sourceMissing).length;
  const canCheckProblemItems =
    Boolean(selectedProject?.datasetId) &&
    !["asset-database-group", "database-group", "workspace-folder-group"].includes(
      selectedProject?.id ?? ""
    );
  const canManageProfiles =
    Boolean(selectedProject?.datasetId) &&
    selectedProject?.sourceKind !== "folder" &&
    !isVirtualProjectRoot(selectedProject);
  const imageProfileIds = new Set(
    images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
  );
  const imageDatasetIds = new Set(images.map((image) => image.datasetId).filter(Boolean));
  if (selectedProject?.datasetId) {
    imageDatasetIds.add(selectedProject.datasetId);
  }

  const matchedProfiles = profiles.filter(
    (profile) =>
      imageProfileIds.has(profile.id) ||
      (profile.datasetId !== undefined && imageDatasetIds.has(profile.datasetId))
  );
  const matchedProfileIds = new Set(matchedProfiles.map((profile) => profile.id));
  const inferredProfiles: AnnotationProfile[] = Array.from(imageProfileIds)
    .filter((profileId) => !matchedProfileIds.has(profileId))
    .map((profileId) => ({
      id: profileId,
      name: `#${profileId}`,
      datasetId: selectedProject?.datasetId
    }));
  const overviewProfiles = [...matchedProfiles, ...inferredProfiles];
  const annotationTypeStats = overviewProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    annotatedCount: images.filter((image) =>
      image.annotations.some(
        (annotation) => annotation.profileId === profile.id && annotation.content.trim()
      )
    ).length
  }));
  const latestUpdate = images
    .map((image) => image.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  const avgCompletion =
    annotationTypeStats.length > 0 && images.length > 0
      ? annotationTypeStats.reduce(
          (sum, s) => sum + s.annotatedCount / images.length,
          0
        ) / annotationTypeStats.length
      : 0;
  const avgCompleteness =
    avgCompletion >= 1
      ? "100"
      : (Math.floor(avgCompletion * 1000) / 10).toFixed(1);

  const trimmedNewProfileName = newProfileName.trim();
  const normalizedNewProfileName = trimmedNewProfileName.toLocaleLowerCase();
  const newProfileNameExists = profiles.some(
    (profile) =>
      profile.datasetId === selectedProject?.datasetId &&
      profile.name.trim().toLocaleLowerCase() === normalizedNewProfileName
  );
  const newProfileError =
    newProfileNameExists ? t("image.profileNameExists") : createProfileError;

  const trimmedRenameValue = renameValue.trim();
  const renameNameExists =
    trimmedRenameValue.toLocaleLowerCase() !== "" &&
    profiles.some(
      (profile) =>
        profile.id !== renamingProfileId &&
        profile.datasetId === selectedProject?.datasetId &&
        profile.name.trim().toLocaleLowerCase() === trimmedRenameValue.toLocaleLowerCase()
    );

  const handleCreateProfile = async () => {
    if (!trimmedNewProfileName || newProfileNameExists || isSubmittingProfile) return;
    setIsSubmittingProfile(true);
    setCreateProfileError("");
    try {
      await createAnnotationProfile(trimmedNewProfileName);
      setIsCreatingProfile(false);
      setNewProfileName("");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("image.createTypeFailed");
      setCreateProfileError(message);
      addAppLog(t("appLog.profileCreateFailed", { message }), "error");
    } finally {
      setIsSubmittingProfile(false);
    }
  };

  const handleRenameProfile = async () => {
    if (!trimmedRenameValue || renameNameExists || isRenaming || !renamingProfileId) return;
    setIsRenaming(true);
    setRenameError("");
    try {
      await renameAnnotationProfile(renamingProfileId, trimmedRenameValue);
      setRenamingProfileId(undefined);
      setRenameValue("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t("image.createTypeFailed"));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDuplicateProfile = async (profileId: number, sourceName: string) => {
    setProfileMenuId(undefined);
    let copyName = `${sourceName} copy`;
    let counter = 2;
    const existingNames = new Set(
      profiles.map((p) => p.name.trim().toLocaleLowerCase())
    );
    while (existingNames.has(copyName.toLocaleLowerCase())) {
      copyName = `${sourceName} copy ${counter}`;
      counter += 1;
    }
    try {
      await duplicateAnnotationProfile(profileId, copyName);
      addAppLog(t("appLog.profileDuplicated", { sourceName, copyName }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("errors.unknown");
      addAppLog(t("appLog.profileDuplicateFailed", { message }), "error");
    }
  };

  const handleDeleteProfile = async () => {
    if (!deletingProfile || isDeleting) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteAnnotationProfile(deletingProfile.id);
      addAppLog(t("appLog.profileDeleted", { name: deletingProfile.name }));
      setDeletingProfile(undefined);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("errors.unknown"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="hover-scrollbar min-h-0 flex-1 overflow-auto px-1.5 pb-4">
      <div className="max-w-[720px] py-2 px-1">
        <div className="mb-8">
          <h3 className="m-0 text-[24px] font-semibold leading-8 tracking-tight text-neutral-950">
            {selectedProjectName ?? "-"}
          </h3>
          
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-neutral-500">
            <div className="flex shrink-0 items-center gap-1.5">
              <HardDrive size={14} className="text-neutral-400" />
              <span>{formatBytes(totalSize)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Clock size={14} className="text-neutral-400" />
              <span>{latestUpdate ? new Date(latestUpdate).toLocaleString() : "-"}</span>
            </div>
            {selectedProject?.sourceKind === "folder" ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <FolderOpen size={14} className="shrink-0 text-neutral-400" />
                <span className="truncate font-mono font-medium text-neutral-600" title={selectedProject.path}>
                  {selectedProject.path}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[20px] font-semibold tabular-nums text-neutral-950">
              {images.length.toLocaleString()}
            </span>
            <span className="text-[12px] text-neutral-500">{t("workspace.imageCount")}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[20px] font-semibold tabular-nums text-neutral-950">
              {avgCompleteness}%
            </span>
            <span className="text-[12px] text-neutral-500">
              {t("workspace.annotationCompleteness")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-[20px] font-semibold tabular-nums",
                  problemItems > 0 ? "text-orange-600" : "text-neutral-950"
                )}
              >
                {problemItems.toLocaleString()}
              </span>
              <span className="text-[12px] text-neutral-500">{t("workspace.problemItems")}</span>
            </div>
            <button
              type="button"
              className="no-drag ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-wait disabled:opacity-50"
              disabled={isCheckingProblemItems || !canCheckProblemItems}
              onClick={() => void checkProblemItems(selectedProject)}
              title={t("workspace.checkProblemItems")}
            >
              <RefreshCw
                size={13}
                className={cn(isCheckingProblemItems && "animate-spin")}
              />
            </button>
          </div>
        </div>

        <div className="mt-8">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-400">
            {t("workspace.annotationTypesCount", { count: annotationTypeStats.length })}
          </div>
          {annotationTypeStats.length > 0 ? (
            <div className="-mx-2 border-t border-neutral-200/70">
              {annotationTypeStats.map((profile) => {
                const completion =
                  images.length > 0 ? profile.annotatedCount / images.length : 0;
                const pct =
                  completion >= 1
                    ? "100"
                    : (Math.floor(completion * 1000) / 10).toFixed(1);
                const isMenuOpen = profileMenuId === profile.id;
                const isBeingRenamed = renamingProfileId === profile.id;

                return (
                  <div 
                    key={profile.id} 
                    className="group relative flex items-center gap-4 border-b border-neutral-100/70 px-2 py-2.5 transition-colors hover:bg-neutral-50/50"
                  >
                    {isBeingRenamed ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          value={renameValue}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                            setRenameError("");
                          }}
                          className="glass-input h-7 min-w-0 flex-1 px-2 text-[13px]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleRenameProfile();
                            }
                            if (e.key === "Escape") {
                              setRenamingProfileId(undefined);
                              setRenameError("");
                            }
                          }}
                          disabled={isRenaming}
                        />
                        <button
                          type="button"
                          className="no-drag inline-flex h-7 items-center rounded-md border border-neutral-200 bg-white px-2 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!trimmedRenameValue || renameNameExists || isRenaming}
                          onClick={() => void handleRenameProfile()}
                        >
                          {t("actions.save")}
                        </button>
                        <button
                          type="button"
                          className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900"
                          onClick={() => {
                            setRenamingProfileId(undefined);
                            setRenameError("");
                          }}
                          disabled={isRenaming}
                        >
                          <X size={14} />
                        </button>
                        {(renameError || renameNameExists) ? (
                          <span className="text-[12px] text-red-600">
                            {renameNameExists ? t("image.profileNameExists") : renameError}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <span className="w-[140px] shrink-0 truncate text-[13px] font-medium text-neutral-600 transition-colors group-hover:text-neutral-900">
                          {profile.name}
                        </span>
                        <div className="annotation-completeness-track h-1 w-36 shrink-0 overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className="annotation-completeness-fill h-full rounded-full bg-neutral-400 transition-all duration-500 group-hover:bg-neutral-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-[72px] shrink-0 text-right text-[12px] tabular-nums text-neutral-500">
                          {profile.annotatedCount.toLocaleString()}
                          <span className="text-neutral-400">
                            /{images.length.toLocaleString()}
                          </span>
                        </span>
                        <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-neutral-700">
                          {pct}%
                        </span>
                        {canManageProfiles ? (
                          <div className="relative">
                            <button
                              type="button"
                              className={cn(
                                "no-drag inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900",
                                isMenuOpen ? "bg-neutral-100 text-neutral-900" : "opacity-0 group-hover:opacity-100"
                              )}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setProfileMenuId(isMenuOpen ? undefined : profile.id);
                              }}
                            >
                              <Ellipsis size={15} />
                            </button>
                            {isMenuOpen ? (
                              <div
                                className="app-dropdown-menu no-drag absolute right-0 top-8 z-50 min-w-[148px] rounded-lg py-1.5"
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <div className="app-dropdown-backdrop" />
                                <button
                                  type="button"
                                  className="app-dropdown-item flex h-8 w-full items-center gap-2.5 px-3 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                                  onClick={() => {
                                    setProfileMenuId(undefined);
                                    setRenamingProfileId(profile.id);
                                    setRenameValue(profile.name);
                                    setRenameError("");
                                  }}
                                >
                                  <Pencil size={13} />
                                  {formatDialogMenuLabel(t("workspace.renameAnnotationType"))}
                                </button>
                                <button
                                  type="button"
                                  className="app-dropdown-item flex h-8 w-full items-center gap-2.5 px-3 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                                  onClick={() =>
                                    void handleDuplicateProfile(profile.id, profile.name)
                                  }
                                >
                                  <Copy size={13} />
                                  {t("workspace.duplicateAnnotationType")}
                                </button>
                                <div className="app-dropdown-separator my-1 h-px bg-neutral-200" />
                                <button
                                  type="button"
                                  className="app-dropdown-item flex h-8 w-full items-center gap-2.5 px-3 text-left text-[12px] font-medium text-red-600 transition hover:bg-neutral-100"
                                  onClick={() => {
                                    setProfileMenuId(undefined);
                                    setDeletingProfile({
                                      id: profile.id,
                                      name: profile.name
                                    });
                                    setDeleteError("");
                                  }}
                                >
                                  <Trash2 size={13} />
                                  {formatDialogMenuLabel(t("workspace.deleteAnnotationType"))}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {canManageProfiles ? (
            <div className="mt-2 -mx-2">
              {isCreatingProfile ? (
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    value={newProfileName}
                    onChange={(event) => {
                      setNewProfileName(event.target.value);
                      setCreateProfileError("");
                    }}
                    className="glass-input h-7 min-w-0 flex-1 px-2 text-[13px]"
                    placeholder={t("image.newTypeName")}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleCreateProfile();
                      }
                      if (event.key === "Escape") {
                        setIsCreatingProfile(false);
                        setNewProfileName("");
                        setCreateProfileError("");
                      }
                    }}
                    disabled={isSubmittingProfile}
                  />
                  <button
                    type="button"
                    className="no-drag inline-flex h-7 items-center rounded-md border border-neutral-200 bg-white px-2 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      !trimmedNewProfileName || newProfileNameExists || isSubmittingProfile
                    }
                    onClick={() => void handleCreateProfile()}
                  >
                    {t("image.createType")}
                  </button>
                  <button
                    type="button"
                    className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900"
                    onClick={() => {
                      setIsCreatingProfile(false);
                      setNewProfileName("");
                      setCreateProfileError("");
                    }}
                    disabled={isSubmittingProfile}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="no-drag flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-neutral-500 transition hover:bg-neutral-50/50 hover:text-neutral-900"
                  onClick={() => {
                    setIsCreatingProfile(true);
                    setNewProfileName("");
                    setCreateProfileError("");
                  }}
                >
                  <Plus size={14} />
                  <span>{t("workspace.addAnnotationType")}</span>
                </button>
              )}
              {newProfileError ? (
                <div className="px-2 pt-1 text-[12px] text-red-600">{newProfileError}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <AnimatedPortal open={Boolean(deletingProfile)}>
        {deletingProfile ? (
            <div className="no-drag fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/24 px-4">
              <div className="w-full max-w-[400px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl">
                <h2 className="m-0 text-[15px] font-semibold leading-6 text-neutral-950">
                  {t("workspace.deleteAnnotationTypeTitle")}
                </h2>
                <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[13px] font-medium text-neutral-900">
                  {deletingProfile.name}
                </div>
                <p className="mt-3 text-[13px] leading-5 text-neutral-600">
                  {t("workspace.deleteAnnotationTypeDescription")}
                </p>
                {deleteError ? (
                  <div className="mt-3 text-[12px] text-red-600">{deleteError}</div>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                    onClick={() => setDeletingProfile(undefined)}
                    disabled={isDeleting}
                  >
                    {t("actions.cancel")}
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-md bg-neutral-950 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleDeleteProfile()}
                    disabled={isDeleting}
                  >
                    {isDeleting
                      ? t("itemMenu.deleting")
                      : t("workspace.confirmDeleteAnnotationType")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
      </AnimatedPortal>
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
    createAnnotationProfile,
    renameAnnotationProfile,
    duplicateAnnotationProfile,
    deleteAnnotationProfile,
    selectProject,
    selectImage,
    applyTableDraft,
    markTableCellSaved,
    saveAnnotationChanges,
    renameDatasetImage,
    deleteDatasetImage
  } = useDatasetStore(
    useShallow((state) => ({
      images: state.images,
      projects: state.projects,
      profiles: state.profiles,
      workspaceTab: state.workspaceTab,
      selectedProjectId: state.selectedProjectId,
      selectedImageIds: state.selectedImageIds,
      search: state.search,
      viewFilterMode: state.viewFilterMode,
      viewFilterProjectId: state.viewFilterProjectId,
      viewFilterImageIds: state.viewFilterImageIds,
      activeProfileId: state.activeProfileId,
      tableDraftProfileId: state.tableDraftProfileId,
      tableAnnotationDrafts: state.tableAnnotationDrafts,
      tableInstructionDrafts: state.tableInstructionDrafts,
      isCheckingProblemItems: state.isCheckingProblemItems,
      setSearch: state.setSearch,
      setViewFilter: state.setViewFilter,
      setWorkspaceTab: state.setWorkspaceTab,
      refreshImages: state.refreshImages,
      addAppLog: state.addAppLog,
      checkProblemItems: state.checkProblemItems,
      createAnnotationProfile: state.createAnnotationProfile,
      renameAnnotationProfile: state.renameAnnotationProfile,
      duplicateAnnotationProfile: state.duplicateAnnotationProfile,
      deleteAnnotationProfile: state.deleteAnnotationProfile,
      selectProject: state.selectProject,
      selectImage: state.selectImage,
      applyTableDraft: state.applyTableDraft,
      markTableCellSaved: state.markTableCellSaved,
      saveAnnotationChanges: state.saveAnnotationChanges,
      renameDatasetImage: state.renameDatasetImage,
      deleteDatasetImage: state.deleteDatasetImage
    }))
  );
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
  const [isSavingImageChanges, setIsSavingImageChanges] = useState(false);
  const selectedProject = flattenProjects(projects).find(
    (project) => project.id === selectedProjectId
  );
  const selectedProjectTrail = useMemo(
    () => findProjectTrail(projects, selectedProjectId),
    [projects, selectedProjectId]
  );
  const visibleImages = useMemo(
    () => getVisibleImages(images, selectedProject, search, viewFilterMode, viewFilterImageIds),
    [images, search, selectedProject, viewFilterImageIds, viewFilterMode]
  );
  const overviewImages = useMemo(
    () => getVisibleImages(images, selectedProject, "", viewFilterMode, viewFilterImageIds),
    [images, selectedProject, viewFilterImageIds, viewFilterMode]
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
  const contextMenuProfileId =
    selectedProject?.sourceKind === "folder"
      ? getEffectiveProfileId(images, selectedProject, activeProfileId)
      : tableProfiles.some((profile) => profile.id === activeProfileId)
      ? activeProfileId
      : tableProfiles[0]?.id;
  const contextMenuImage = imageContextMenu
    ? images.find((image) => image.id === imageContextMenu.image.id) ?? imageContextMenu.image
    : undefined;
  const contextMenuChange = contextMenuImage
    ? getImageDraftChange(
        contextMenuImage,
        contextMenuProfileId,
        tableDraftProfileId,
        tableAnnotationDrafts,
        tableInstructionDrafts
      )
    : undefined;
  const contextMenuImageIsDirty = Boolean(contextMenuChange);
  const canImportImagesToFolder =
    isImportableDatasetChild(selectedProject) && Boolean(selectedProject?.datasetId);
  const workspaceViewTransitionKey = `${selectedProjectId ?? "none"}:${activeTab}:${
    shouldShowFilterEmptyState ? "filter-empty" : "content"
  }`;

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
      top: Math.min(event.clientY, window.innerHeight - 168)
    });
  };

  const discardImageChanges = (image: DatasetImage) => {
    if (contextMenuProfileId === undefined) return;

    const annotation = getAnnotationForProfile(image, contextMenuProfileId);
    applyTableDraft(contextMenuProfileId, image.id, {
      content: annotation?.content ?? "",
      instruction: annotation?.instruction ?? ""
    });
    setImageContextMenu(undefined);
  };

  const saveImageChanges = async (image: DatasetImage) => {
    if (!contextMenuChange || isSavingImageChanges) return;

    setIsSavingImageChanges(true);
    try {
      await saveAnnotationChanges([contextMenuChange]);
      if (contextMenuChange.content !== undefined) {
        markTableCellSaved(`${image.id}:annotation`);
      }
      if (contextMenuChange.instruction !== undefined) {
        markTableCellSaved(`${image.id}:instruction`);
      }
      setImageContextMenu(undefined);
    } catch (error) {
      addAppLog(
        t("appLog.menuActionFailed", {
          message: formatAppError(error)
        }),
        "error"
      );
    } finally {
      setIsSavingImageChanges(false);
    }
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
        t("folderImport.previewDone", {
          imageCount: preview.imageCount,
          annotationCount: preview.annotationCount,
          instructionCount: preview.instructionCount
        })
      );
    } catch (error) {
      const payload = error as { code?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setFolderImportError(`${t("folderImport.selectFailed")}：${message}`);
        addAppLog(`${t("folderImport.selectFailed")}：${message}`, "error");
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
        t("folderImport.importDone", {
          imported: summary.imported,
          skipped: summary.skipped,
          failed: summary.failed,
          annotationCount: summary.annotationCount,
          instructionCount: summary.instructionCount
        })
      );
      setFolderImportPreview(undefined);
    } catch (error) {
      const message = formatAppError(error);
      setFolderImportError(`${t("folderImport.importFailed")}：${message}`);
      addAppLog(`${t("folderImport.importFailed")}：${message}`, "error");
    } finally {
      setIsImportingImages(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex min-h-11 items-center gap-3 border-b border-neutral-100 px-1.5 pb-3 pt-0.5">
        <div className="min-w-0 flex-1">
          <h2
            key={selectedProjectId ?? "none"}
            className="workspace-heading-transition m-0 flex min-w-0 items-center gap-2 text-[14px] text-neutral-900"
          >
            <FolderOpen size={16} className="shrink-0 text-neutral-500" />
            <ProjectPathBreadcrumb
              trail={selectedProjectTrail}
              fallbackPath={selectedProject?.path}
              onSelectProject={selectProject}
              className="min-w-0 flex-1 leading-5"
            />
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-normal",
                visibleProblemItemCount > 0
                  ? "bg-orange-100 text-orange-700"
                  : "bg-neutral-100 text-neutral-500"
              )}
            >
              {visibleProblemItemCount > 0
                ? `${visibleProblemItemCount}/${visibleImages.length}`
                : t("toolbar.datasetCount", { count: visibleImages.length })}
            </span>
            {selectedVisibleImageCount > 0 ? (
              <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-normal text-white">
                {t("toolbar.selectedCount", { count: selectedVisibleImageCount })}
              </span>
            ) : null}
          </h2>
        </div>
        <button
          type="button"
          className="no-drag inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void prepareFolderImageImport()}
          disabled={!canImportImagesToFolder || isPreparingFolderImport}
          title={
            canImportImagesToFolder
              ? t("folderImport.button")
              : t("folderImport.unsupported")
          }
        >
          <ImagePlus size={15} />
          <span>{t("folderImport.button")}</span>
        </button>
        <div className="relative w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            size={15}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="glass-input h-8 w-full pl-9 pr-8 text-[13px] placeholder:text-neutral-400"
            placeholder={t("toolbar.searchPlaceholder")}
          />
          {search ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition hover:text-neutral-700"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1 border-b border-neutral-100 px-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              className={cn(
                "no-drag flex h-9 items-center gap-2 border-b-2 px-3 text-[13px] transition",
                isActive
                  ? "border-neutral-900 text-neutral-950"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              )}
              onClick={() => setWorkspaceTab(tab.id)}
            >
              <Icon size={15} />
              <span>{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div
        key={workspaceViewTransitionKey}
        className="workspace-view-transition flex min-h-0 flex-1 flex-col"
      >
        {activeTab === "overview" ? (
          <DatasetOverview
            images={overviewImages}
            selectedProject={selectedProject}
            profiles={profiles}
            isCheckingProblemItems={isCheckingProblemItems}
            checkProblemItems={checkProblemItems}
            createAnnotationProfile={createAnnotationProfile}
            renameAnnotationProfile={renameAnnotationProfile}
            duplicateAnnotationProfile={duplicateAnnotationProfile}
            deleteAnnotationProfile={deleteAnnotationProfile}
            addAppLog={addAppLog}
          />
        ) : shouldShowFilterEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-12 text-center">
            <ImageIcon size={44} className="mb-4 text-neutral-300" />
            <h2 className="m-0 text-xl font-semibold text-neutral-900">
              {t("workspace.noFilterMatches")}
            </h2>
            <p className="mt-2 max-w-md text-sm text-neutral-500">
              {t("workspace.filterHiddenHint")}
            </p>
          </div>
        ) : activeTab === "grid" ? (
          <DatasetGrid
            images={visibleImages}
            search={search}
            scrollResetKey={selectedProjectId}
            onImageContextMenu={openImageContextMenu}
          />
        ) : (
          <DatasetTable
            images={visibleImages}
            profiles={tableProfiles}
            search={search}
            scrollResetKey={selectedProjectId}
            onImageContextMenu={openImageContextMenu}
          />
        )}
      </div>

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
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
                disabled={!contextMenuImageIsDirty || isSavingImageChanges || !contextMenuImage}
                onClick={() => {
                  if (contextMenuImage) {
                    discardImageChanges(contextMenuImage);
                  }
                }}
              >
                <span>{t("itemMenu.discardChanges")}</span>
              </button>
              <button
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
                disabled={!contextMenuImageIsDirty || isSavingImageChanges || !contextMenuImage}
                onClick={() => {
                  if (contextMenuImage) {
                    void saveImageChanges(contextMenuImage);
                  }
                }}
              >
                <span>{t("itemMenu.saveChanges")}</span>
              </button>
              <div className="app-dropdown-separator my-1.5 h-px bg-neutral-200" />
              <button
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                onClick={() => startRenameImage(imageContextMenu.image)}
              >
                <span>{formatDialogMenuLabel(t("itemMenu.rename"))}</span>
              </button>
              <div className="app-dropdown-separator my-1.5 h-px bg-neutral-200" />
              <button
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-100"
                onClick={() => startDeleteImage(imageContextMenu.image)}
              >
                <span>{formatDialogMenuLabel(t("itemMenu.delete"))}</span>
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
