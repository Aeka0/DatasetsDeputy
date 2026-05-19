import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import i18next from "../i18n";
import { formatAppError } from "../lib/errors";
import { flattenProjects } from "../lib/projects";
import type { TableCellState } from "../lib/tableCellState";
import { hasTauriRuntime, invokeCommand } from "../lib/tauri";
import type { TableDraftMap } from "../lib/tableDrafts";
import type {
  AnnotationChange,
  AnnotationProfile,
  DatabaseExportProgress,
  DatabaseExportRequest,
  DatabaseImportRequest,
  DatabaseImportResult,
  DatasetImage,
  DatasetProject,
  DatasetSourceKind,
  ExportDatasetRequest,
  ExportPreset,
  ExportPreview,
  ExportProgress,
  ImportPreview,
  ImportProgress,
  ImportReport,
  ImportSummary,
  ProblemItemCheckSummary
} from "../types";

const now = new Date().toISOString();

const sampleProfiles: AnnotationProfile[] = [
  {
    id: 1,
    name: "Sample imported annotation",
    sourceKind: "database",
    datasetId: "database:sample"
  }
];

const sampleImages: DatasetImage[] = [
  {
    id: 1,
    path: "datasets/sample/aurora-field.png",
    datasetPath: "aurora-field.png",
    fileName: "aurora-field.png",
    width: 1536,
    height: 1024,
    fileSize: 2_742_912,
    fileHash: "demo-a1",
    importedAt: now,
    updatedAt: now,
    sourceKind: "database",
    datasetId: "database:sample",
    rootPath: "datasets/sample",
    annotations: [
      {
        id: 101,
        imageId: 1,
        profileId: 1,
        content: "A wide cinematic field under green aurora lights.",
        instruction: "",
        createdAt: now,
        updatedAt: now
      }
    ]
  },
  {
    id: 2,
    path: "datasets/sample/studio-portrait.png",
    datasetPath: "studio-portrait.png",
    fileName: "studio-portrait.png",
    width: 1024,
    height: 1536,
    fileSize: 3_241_020,
    fileHash: "demo-b2",
    importedAt: now,
    updatedAt: now,
    sourceKind: "database",
    datasetId: "database:sample",
    rootPath: "datasets/sample",
    annotations: [
      {
        id: 102,
        imageId: 2,
        profileId: 1,
        content: "A clean studio portrait with soft rim lighting.",
        instruction: "",
        createdAt: now,
        updatedAt: now
      }
    ]
  },
  {
    id: 3,
    path: "datasets/sample/product-glass.png",
    datasetPath: "product-glass.png",
    fileName: "product-glass.png",
    width: 1400,
    height: 1400,
    fileSize: 1_834_480,
    fileHash: "demo-c3",
    importedAt: now,
    updatedAt: now,
    sourceKind: "database",
    datasetId: "database:sample",
    rootPath: "datasets/sample",
    annotations: [
      {
        id: 103,
        imageId: 3,
        profileId: 1,
        content: "A minimal glass product render on a dark reflective surface.",
        instruction: "",
        createdAt: now,
        updatedAt: now
      }
    ]
  }
];

const sampleProjects: DatasetProject[] = [
  {
    id: "sample",
    name: "Sample Dataset",
    path: "datasets/sample",
    imageIds: [1, 2, 3],
    sourceKind: "database",
    datasetId: "database:sample",
    children: [
      {
        id: "sample-training",
        name: "training",
        path: "datasets/sample/training",
        imageIds: [1, 2],
        sourceKind: "database",
        datasetId: "database:sample"
      },
      {
        id: "sample-reference",
        name: "reference",
        path: "datasets/sample/reference",
        imageIds: [3],
        sourceKind: "database",
        datasetId: "database:sample"
      }
    ]
  }
];

let unlistenImportProgress: UnlistenFn | undefined;
let unlistenExportProgress: UnlistenFn | undefined;
let unlistenDatabaseExportProgress: UnlistenFn | undefined;
const thumbnailRequestsInFlight = new Set<number>();
const thumbnailRequestQueue: number[] = [];
let thumbnailQueueRunning = false;
const thumbnailBatchSize = 8;

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function getDirectory(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function getPathName(path: string, fallback: string) {
  const normalized = normalizePath(path);
  return normalized.split("/").filter(Boolean).at(-1) ?? fallback;
}

function replacePathFileName(path: string, fileName: string) {
  const directory = getDirectory(path);
  return directory ? `${directory}/${fileName}` : fileName;
}

function joinPath(parent: string, child: string) {
  const normalizedParent = normalizePath(parent);
  return normalizedParent ? `${normalizedParent}/${child}` : child;
}

function getChildProjectId(project: DatasetProject, childName: string) {
  const childPath = joinPath(project.path, childName);
  const sourceKind = getProjectSourceKind(project);
  if (sourceKind === "folder") {
    return `folder-folder:${childPath}`;
  }
  return `${sourceKind}-folder:${encodeURIComponent(project.datasetId ?? "")}:${childPath}`;
}

function getRenamedImageFileName(image: DatasetImage, name: string) {
  const trimmedName = name.trim();
  if (/\.[^./\\]+$/.test(trimmedName)) {
    return trimmedName;
  }

  const extension = image.fileName.match(/\.([^./\\]+)$/)?.[1];
  return extension ? `${trimmedName}.${extension}` : trimmedName;
}

function renamePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  const normalizedPath = normalizePath(path);
  const normalizedOldPrefix = normalizePath(oldPrefix);
  const normalizedNewPrefix = normalizePath(newPrefix);
  if (normalizedPath === normalizedOldPrefix) {
    return normalizedNewPrefix;
  }
  if (normalizedPath.startsWith(`${normalizedOldPrefix}/`)) {
    return `${normalizedNewPrefix}${normalizedPath.slice(normalizedOldPrefix.length)}`;
  }
  return path;
}

function renameProjectIdPrefix(
  id: string | undefined,
  oldPrefix: string,
  newPrefix: string
): string | undefined {
  if (!id) {
    return id;
  }

  if (id.startsWith("loose-files:")) {
    const renamedId = renameProjectIdPrefix(id.slice("loose-files:".length), oldPrefix, newPrefix);
    return renamedId ? `loose-files:${renamedId}` : id;
  }

  if (id.startsWith("folder:")) {
    const renamedPath = renamePathPrefix(id.slice("folder:".length), oldPrefix, newPrefix);
    return `folder:${renamedPath}`;
  }

  if (id.startsWith("folder-folder:")) {
    const renamedPath = renamePathPrefix(id.slice("folder-folder:".length), oldPrefix, newPrefix);
    return `folder-folder:${renamedPath}`;
  }

  const databaseFolderMatch = id.match(/^(database|asset)-folder:([^:]+):(.+)$/);
  if (!databaseFolderMatch) {
    return id;
  }

  const [, sourceKind, datasetId, path] = databaseFolderMatch;
  return `${sourceKind}-folder:${datasetId}:${renamePathPrefix(path, oldPrefix, newPrefix)}`;
}

function getCommonDirectory(images: DatasetImage[]) {
  if (images.length === 0) return "";

  const splitPaths = images.map((image) => getDirectory(image.path).split("/").filter(Boolean));
  const common: string[] = [];

  for (let index = 0; index < splitPaths[0].length; index += 1) {
    const part = splitPaths[0][index];
    if (splitPaths.every((parts) => parts[index] === part)) {
      common.push(part);
    } else {
      break;
    }
  }

  return common.join("/");
}

function getDatasetGroupKey(image: DatasetImage) {
  return Math.floor(image.id / 1_000_000);
}

function getImageDatasetId(image: DatasetImage) {
  return image.datasetId ?? `database:${getDatasetGroupKey(image)}`;
}

function getProjectSourceKind(project: DatasetProject | undefined) {
  return project?.sourceKind ?? (project?.id.startsWith("folder-root:") ? "folder" : "database");
}

function normalizeProfileName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function createProjectTree(
  images: DatasetImage[],
  rootName?: string,
  rootPath?: string
): DatasetProject[] {
  if (images.length === 0) return [];

  const groups = new Map<string, DatasetImage[]>();
  for (const image of images) {
    const key = getImageDatasetId(image);
    const current = groups.get(key);
    if (current) {
      current.push(image);
    } else {
      groups.set(key, [image]);
    }
  }

  return Array.from(groups.entries()).map(([groupKey, groupImages]) => {
    const sourceKind = groupImages[0]?.sourceKind ?? "database";
    const directImageIdsByPath = new Map<string, number[]>();
    const imageRoot = groupImages.find((image) => image.rootPath)?.rootPath;
    const groupRootPath = sourceKind === "folder" ? imageRoot : undefined;
    const groupRootName = sourceKind === "folder"
      ? getPathName(imageRoot ?? "", "Folder")
      : groupImages.find((image) => image.rootName)?.rootName ?? rootName;
    const normalizedGroupRoot = groupRootPath ? normalizePath(groupRootPath) : undefined;
    const groupMatchesImportRoot =
      sourceKind === "folder" &&
      normalizedGroupRoot &&
      groupImages.every((image) => normalizePath(image.path).startsWith(normalizedGroupRoot));
    const normalizedRoot = sourceKind === "folder"
      ? groupMatchesImportRoot
        ? normalizedGroupRoot
        : normalizePath(getCommonDirectory(groupImages))
      : "";

    const rootIdPrefix = sourceKind === "folder"
      ? "folder-root"
      : sourceKind === "asset"
      ? "asset-root"
      : "dataset-root";
    const fallbackRootName = sourceKind === "folder"
      ? "Folder"
      : sourceKind === "asset"
      ? "Asset Database"
      : "Dataset";
    const root: DatasetProject = {
      id: `${rootIdPrefix}:${groupKey}`,
      name: groupRootName || getPathName(normalizedRoot, fallbackRootName),
      path: normalizedRoot,
      imageIds: groupImages.map((image) => image.id),
      children: [],
      sourceKind,
      datasetId: groupKey
    };

    const ensureChild = (parent: DatasetProject, name: string, path: string) => {
      parent.children ??= [];
      let child = parent.children.find((item) => item.path === path);
      if (!child) {
        child = {
          id: sourceKind === "folder"
            ? `${sourceKind}-folder:${path}`
            : `${sourceKind}-folder:${encodeURIComponent(groupKey)}:${path}`,
          name,
          path,
          imageIds: [],
          children: [],
          sourceKind,
          datasetId: groupKey
        };
        parent.children.push(child);
      }
      return child;
    };

    const addDirectImage = (path: string, imageId: number) => {
      const ids = directImageIdsByPath.get(path);
      if (ids) {
        ids.push(imageId);
      } else {
        directImageIdsByPath.set(path, [imageId]);
      }
    };

    for (const image of groupImages) {
      const directory = sourceKind === "folder"
        ? getDirectory(image.path)
        : getDirectory(image.datasetPath ?? image.fileName);
      const relative = sourceKind === "folder"
        ? normalizedRoot && directory.startsWith(normalizedRoot)
          ? directory.slice(normalizedRoot.length).replace(/^\/+/, "")
          : ""
        : directory;

      if (!relative) {
        addDirectImage(root.path, image.id);
        continue;
      }

      let current = root;
      let currentPath = normalizedRoot;

      for (const part of relative.split("/").filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        current = ensureChild(current, part, currentPath);
        if (!current.imageIds.includes(image.id)) {
          current.imageIds.push(image.id);
        }
      }

      addDirectImage(current.path, image.id);
    }

    const addLooseFileNodes = (project: DatasetProject): DatasetProject => {
      const childFolders = project.children?.map(addLooseFileNodes) ?? [];
      const directImageIds = directImageIdsByPath.get(project.path) ?? [];
      const children = directImageIds.length > 0 && childFolders.length > 0
        ? [
            {
              id: `loose-files:${project.id}`,
              name: "loose-files",
              path: project.path,
              imageIds: directImageIds,
              sourceKind,
              datasetId: groupKey,
              treeNodeKind: "loose-files" as const
            },
            ...childFolders
          ]
        : childFolders;

      return {
        ...project,
        children: children.length ? children : undefined
      };
    };

    return addLooseFileNodes(root);
  });
}

type WorkspaceTab = "overview" | "grid" | "table";
type PendingImportKind = DatasetSourceKind;
type AppView = "workspace" | "initial" | "logs";
export type ViewFilterMode = "all" | "unannotated" | "unsaved";
const highlightCellStateStorageKey = "datasets-deputy.highlight-cell-state";
const autoSaveAfterAnnotationStorageKey = "datasets-deputy.auto-save-after-annotation";
const autoSaveAfterBatchStorageKey = "datasets-deputy.auto-save-after-batch";

export interface AppLogEntry {
  id: number;
  timestamp: string;
  level: "info" | "warning" | "error";
  message: string;
}

interface DatasetState {
  images: DatasetImage[];
  projects: DatasetProject[];
  profiles: AnnotationProfile[];
  presets: ExportPreset[];
  appView: AppView;
  workspaceTab: WorkspaceTab;
  appLogs: AppLogEntry[];
  selectedProjectId?: string;
  selectedImageId?: number;
  selectedImageIds: number[];
  selectionAnchorImageId?: number;
  previewImageId?: number;
  search: string;
  viewFilterMode: ViewFilterMode;
  viewFilterProjectId?: string;
  viewFilterImageIds: number[];
  tableDraftProfileId?: number;
  tableAnnotationDrafts: TableDraftMap;
  tableInstructionDrafts: TableDraftMap;
  tableProfileAnnotationDrafts: Record<number, TableDraftMap>;
  tableProfileInstructionDrafts: Record<number, TableDraftMap>;
  tableSavedCellKeys: string[];
  tableFailedCellKeys: string[];
  tableLatestCellStates: Record<string, TableCellState>;
  annotatingImageIds: number[];
  thumbnailCacheKey: number;
  highlightCellState: boolean;
  autoSaveAfterAnnotation: boolean;
  autoSaveAfterBatch: boolean;
  activeProfileId?: number;
  isLoading: boolean;
  isCheckingProblemItems: boolean;
  lastImport?: ImportSummary;
  importPreview?: ImportPreview;
  importProgress?: ImportProgress;
  importReport?: ImportReport;
  exportPreview?: ExportPreview;
  exportProgress?: ExportProgress;
  databaseExportProgress?: DatabaseExportProgress;
  pendingImportKind?: PendingImportKind;
  preparedImportKind?: Exclude<DatasetSourceKind, "folder">;
  showImportWizard: boolean;
  showExportDialog: boolean;
  showExportDatabaseDialog: boolean;
  showImportDatabaseDialog: boolean;
  annotationType: string;
  initImportEvents: () => Promise<void>;
  initExportEvents: () => Promise<void>;
  initDatabaseExportEvents: () => Promise<void>;
  load: () => Promise<void>;
  refreshImages: () => Promise<void>;
  ensureThumbnails: (imageIds: number[]) => Promise<void>;
  checkProblemItems: (project?: DatasetProject) => Promise<ProblemItemCheckSummary | undefined>;
  openImportWizard: () => void;
  closeImportWizard: () => void;
  importAssetDatabase: () => Promise<void>;
  importFolder: () => Promise<void>;
  mountFolder: () => Promise<void>;
  startPreparedImport: () => Promise<void>;
  browseImportedDataset: () => Promise<void>;
  setAnnotationType: (annotationType: string) => void;
  clearImportPreview: () => void;
  removeDataset: (project: DatasetProject) => Promise<void>;
  renameDatasetFolder: (project: DatasetProject, name: string) => Promise<void>;
  createDatasetSubfolder: (project: DatasetProject, name: string) => Promise<void>;
  consolidateLooseFiles: (project: DatasetProject, name: string) => Promise<void>;
  deleteLooseFiles: (project: DatasetProject) => Promise<void>;
  renameDatasetImage: (image: DatasetImage, name: string) => Promise<void>;
  deleteDatasetImage: (image: DatasetImage) => Promise<void>;
  openExportDialog: () => void;
  closeExportDialog: () => void;
  prepareExportDataset: (request: ExportDatasetRequest) => Promise<ExportPreview | undefined>;
  startExportDataset: (request: ExportDatasetRequest) => Promise<void>;
  openExportDatabaseDialog: () => void;
  closeExportDatabaseDialog: () => void;
  openImportDatabaseDialog: () => void;
  closeImportDatabaseDialog: () => void;
  startExportDatabase: (request: DatabaseExportRequest) => Promise<void>;
  importDatabase: (request: DatabaseImportRequest) => Promise<DatabaseImportResult | undefined>;
  setAppView: (view: AppView) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  addAppLog: (message: string, level?: AppLogEntry["level"]) => void;
  clearAppLogs: () => void;
  selectProject: (id?: string) => void;
  selectImage: (id?: number) => void;
  setImageSelection: (ids: number[], activeId?: number, anchorId?: number) => void;
  toggleImageSelection: (id: number) => void;
  openImagePreview: (id: number) => void;
  closeImagePreview: () => void;
  bumpThumbnailCacheKey: () => void;
  setSearch: (search: string) => void;
  setViewFilter: (mode: ViewFilterMode, projectId?: string, imageIds?: number[]) => void;
  resetTableDrafts: (
    profileId: number,
    annotationDrafts: TableDraftMap,
    instructionDrafts: TableDraftMap
  ) => void;
  mergeTableDrafts: (
    annotationDrafts: TableDraftMap,
    instructionDrafts: TableDraftMap
  ) => void;
  applyGeneratedAnnotationDraft: (
    profileId: number,
    imageId: number,
    content: string
  ) => void;
  applyTableDraft: (
    profileId: number,
    imageId: number,
    draft: { content?: string; instruction?: string }
  ) => void;
  applyBatchTableDrafts: (
    profileId: number,
    drafts: Array<{ imageId: number; content?: string; instruction?: string }>
  ) => void;
  updateTableAnnotationDraft: (imageId: number, value: string) => void;
  updateTableInstructionDraft: (imageId: number, value: string) => void;
  markTableCellSaved: (key: string) => void;
  markTableCellFailed: (key: string) => void;
  clearTableCellFailure: (key: string) => void;
  clearTableFailedCellMarks: () => void;
  clearTableSavedCellMarks: () => void;
  setHighlightCellState: (enabled: boolean) => void;
  setAutoSaveAfterAnnotation: (enabled: boolean) => void;
  setAutoSaveAfterBatch: (enabled: boolean) => void;
  markImageAnnotating: (imageId: number, annotating: boolean) => void;
  setActiveProfile: (id?: number) => void;
  saveAnnotation: (
    imageId: number,
    profileId: number | undefined,
    content: string
  ) => Promise<void>;
  saveInstruction: (
    imageId: number,
    profileId: number | undefined,
    instruction: string
  ) => Promise<void>;
  saveAnnotationChanges: (changes: AnnotationChange[]) => Promise<void>;
  createAnnotationProfile: (name: string) => Promise<number | undefined>;
  renameAnnotationProfile: (profileId: number, newName: string) => Promise<void>;
  duplicateAnnotationProfile: (profileId: number, newName: string) => Promise<void>;
  deleteAnnotationProfile: (profileId: number) => Promise<void>;
  clearAnnotation: (annotationId: number) => Promise<void>;
}

function createImageSelection(ids: number[], activeId?: number, anchorId?: number) {
  const selectedImageIds = Array.from(new Set(ids));
  const selectedImageId =
    activeId !== undefined && selectedImageIds.includes(activeId)
      ? activeId
      : selectedImageIds.at(-1);
  const selectionAnchorImageId =
    anchorId !== undefined && selectedImageIds.includes(anchorId) ? anchorId : selectedImageId;

  return {
    selectedImageId,
    selectedImageIds,
    selectionAnchorImageId
  };
}

function filterTableDraftsForImageIds(drafts: TableDraftMap, imageIds: Set<number>) {
  return Object.fromEntries(
    Object.entries(drafts)
      .map(([imageId, value]) => [Number(imageId), value] as const)
      .filter(([imageId]) => imageIds.has(imageId))
  );
}

function getStoredHighlightCellState() {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(highlightCellStateStorageKey) !== "false";
}

function getStoredAutoSaveAfterAnnotation() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(autoSaveAfterAnnotationStorageKey) === "true";
}

function getStoredAutoSaveAfterBatch() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(autoSaveAfterBatchStorageKey) === "true";
}

function getAnnotationContentForProfile(image: DatasetImage, profileId: number) {
  return image.annotations.find((annotation) => annotation.profileId === profileId)?.content ?? "";
}

function getInstructionForProfile(image: DatasetImage, profileId: number) {
  return image.annotations.find((annotation) => annotation.profileId === profileId)?.instruction ?? "";
}

function hasWritableProfileId(profileId: number | undefined): profileId is number {
  return Number.isFinite(profileId);
}

function requireWritableProfileId(profileId: number | undefined) {
  if (!hasWritableProfileId(profileId)) {
    throw new Error(i18next.t("appLog.saveNeedsProfile"));
  }
  return profileId;
}

function assertProfileForDatabaseImage(image: DatasetImage | undefined, profileId: number | undefined) {
  if (image?.sourceKind === "folder") {
    return;
  }
  requireWritableProfileId(profileId);
}

function applyAnnotationChanges(images: DatasetImage[], changes: AnnotationChange[]) {
  const updatedAt = new Date().toISOString();
  const changesByImageId = new Map<number, AnnotationChange[]>();
  for (const change of changes) {
    const current = changesByImageId.get(change.imageId);
    if (current) {
      current.push(change);
    } else {
      changesByImageId.set(change.imageId, [change]);
    }
  }

  return images.map((image) => {
    const imageChanges = changesByImageId.get(image.id);
    if (!imageChanges?.length) return image;

    let annotations = image.annotations;
    for (const change of imageChanges) {
      const existing = annotations.find((annotation) => annotation.profileId === change.profileId);
      if (existing) {
        annotations = annotations.map((annotation) =>
          annotation.profileId === change.profileId
            ? {
                ...annotation,
                content: change.content ?? annotation.content,
                instruction: change.instruction ?? annotation.instruction,
                updatedAt
              }
            : annotation
        );
      } else {
        annotations = [
          ...annotations,
          {
            id: Date.now() + image.id + annotations.length,
            imageId: image.id,
            profileId: change.profileId,
            content: change.content ?? "",
            instruction: change.instruction ?? "",
            createdAt: updatedAt,
            updatedAt
          }
        ];
      }
    }

    return {
      ...image,
      annotations,
      updatedAt
    };
  });
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
  images: sampleImages,
  projects: sampleProjects,
  profiles: sampleProfiles,
  presets: [
    {
      id: 1,
      name: "export.presetSd",
      profileIds: [],
      format: "txt_per_image"
    },
    {
      id: 2,
      name: "export.presetJsonl",
      profileIds: [],
      format: "jsonl"
    }
  ],
  appView: "initial",
  workspaceTab: "overview",
  appLogs: [],
  selectedProjectId: undefined,
  selectedImageId: undefined,
  selectedImageIds: [],
  selectionAnchorImageId: undefined,
  previewImageId: undefined,
  search: "",
  viewFilterMode: "all",
  viewFilterProjectId: undefined,
  viewFilterImageIds: [],
  tableDraftProfileId: undefined,
  tableAnnotationDrafts: {},
  tableInstructionDrafts: {},
  tableProfileAnnotationDrafts: {},
  tableProfileInstructionDrafts: {},
  tableSavedCellKeys: [],
  tableFailedCellKeys: [],
  tableLatestCellStates: {},
  annotatingImageIds: [],
  thumbnailCacheKey: 0,
  highlightCellState: getStoredHighlightCellState(),
  autoSaveAfterAnnotation: getStoredAutoSaveAfterAnnotation(),
  autoSaveAfterBatch: getStoredAutoSaveAfterBatch(),
  activeProfileId: sampleProfiles[0]?.id,
  isLoading: false,
  isCheckingProblemItems: false,
  annotationType: "",
  importPreview: undefined,
  importProgress: undefined,
  importReport: undefined,
  exportPreview: undefined,
  exportProgress: undefined,
  databaseExportProgress: undefined,
  pendingImportKind: undefined,
  preparedImportKind: undefined,
  showImportWizard: false,
  showExportDialog: false,
  showExportDatabaseDialog: false,
  showImportDatabaseDialog: false,
  initImportEvents: async () => {
    if (!hasTauriRuntime() || unlistenImportProgress) {
      return;
    }

    unlistenImportProgress = await listen<ImportProgress>("import-progress", async (event) => {
      const progress = event.payload;
      set({
        importProgress: progress,
        isLoading: !progress.done,
        lastImport: progress.done
          ? {
              imported: progress.imported,
              skipped: progress.skipped,
              failed: progress.failed
            }
          : get().lastImport
      });

      if (progress.done && progress.report) {
        get().addAppLog(
          i18next.t("appLog.importCompleted", {
            imported: progress.imported,
            skipped: progress.skipped,
            failed: progress.failed
          })
        );
        const [images, profiles] = await Promise.all([
          invokeCommand<DatasetImage[]>("list_images"),
          invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
        ]);
        const projects = createProjectTree(
          images,
          progress.report.rootName,
          progress.report.rootPath
        );
        set({
          images,
          profiles,
          projects,
          importReport: progress.report,
          importProgress: undefined,
          pendingImportKind: undefined,
          preparedImportKind: undefined,
          showImportWizard: false,
          appView: "workspace",
          selectedProjectId: undefined,
          ...createImageSelection([]),
          previewImageId: undefined
        });
      }
    });
  },
  initExportEvents: async () => {
    if (!hasTauriRuntime() || unlistenExportProgress) {
      return;
    }

    unlistenExportProgress = await listen<ExportProgress>("export-progress", async (event) => {
      const progress = event.payload;
      set({
        exportProgress: progress,
        isLoading: !progress.done
      });

      if (progress.done) {
        if (progress.phase === "failed") {
          get().addAppLog(
            i18next.t("appLog.exportFailed", {
              message: progress.error ?? i18next.t("errors.unknown")
            }),
            "error"
          );
        } else {
          get().addAppLog(
            i18next.t("appLog.exportCompleted", {
              exported: progress.exported,
              failed: progress.failed
            })
          );
        }
      }
    });
  },
  initDatabaseExportEvents: async () => {
    if (!hasTauriRuntime() || unlistenDatabaseExportProgress) {
      return;
    }

    unlistenDatabaseExportProgress = await listen<DatabaseExportProgress>(
      "database-export-progress",
      (event) => {
        const progress = event.payload;
        set({
          databaseExportProgress: progress,
          isLoading: !progress.done
        });

        if (progress.done) {
          if (progress.phase === "failed") {
            get().addAppLog(
              i18next.t("appLog.databaseExportFailed", {
                message: progress.error ?? i18next.t("errors.unknown")
              }),
              "error"
            );
          } else {
            get().addAppLog(
              i18next.t("appLog.databaseExportCompleted", {
                exported: progress.exported,
                failed: progress.failed
              })
            );
          }
        }
      }
    );
  },
  load: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({ isLoading: true });
    get().addAppLog(i18next.t("appLog.refreshStarting"));
    try {
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set({
        images,
        profiles,
        projects: createProjectTree(images),
        appView: "initial",
        selectedProjectId: undefined,
        ...createImageSelection([]),
        previewImageId: undefined,
        activeProfileId: profiles[0]?.id
      });
      get().addAppLog(
        i18next.t("appLog.refreshCompleted", {
          imageCount: images.length,
          profileCount: profiles.length
        })
      );
    } catch (error) {
      get().addAppLog(
        i18next.t("appLog.refreshFailed", { message: formatAppError(error) }),
        "error"
      );
    } finally {
      set({ isLoading: false });
    }
  },
  refreshImages: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    try {
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => {
        const imageIds = new Set(images.map((image) => image.id));
        const selectedImageIds = state.selectedImageIds.filter((imageId) => imageIds.has(imageId));
        const selectedImageId =
          state.selectedImageId !== undefined && imageIds.has(state.selectedImageId)
            ? state.selectedImageId
            : undefined;
        const selectionAnchorImageId =
          state.selectionAnchorImageId !== undefined && imageIds.has(state.selectionAnchorImageId)
            ? state.selectionAnchorImageId
            : undefined;

        return {
          images,
          projects: createProjectTree(images),
          ...createImageSelection(selectedImageIds, selectedImageId, selectionAnchorImageId),
          previewImageId:
            state.previewImageId !== undefined && imageIds.has(state.previewImageId)
              ? state.previewImageId
              : undefined
        };
      });
    } catch (error) {
      get().addAppLog(
        i18next.t("appLog.refreshImagesFailed", { message: formatAppError(error) }),
        "error"
      );
    }
  },
  ensureThumbnails: async (imageIds) => {
    if (!hasTauriRuntime() || imageIds.length === 0) {
      return;
    }

    const pendingImageIds = Array.from(new Set(imageIds)).filter((imageId) => {
      if (thumbnailRequestsInFlight.has(imageId)) {
        return false;
      }
      thumbnailRequestsInFlight.add(imageId);
      return true;
    });

    thumbnailRequestQueue.push(...pendingImageIds);
    if (thumbnailQueueRunning) {
      return;
    }

    thumbnailQueueRunning = true;
    try {
      while (thumbnailRequestQueue.length > 0) {
        const batch = thumbnailRequestQueue.splice(0, thumbnailBatchSize);
        let updated = 0;

        try {
          updated = await invokeCommand<number>("ensure_thumbnails", {
            imageIds: batch
          });
        } catch (error) {
          get().addAppLog(
            i18next.t("appLog.refreshImagesFailed", { message: formatAppError(error) }),
            "error"
          );
        } finally {
          for (const imageId of batch) {
            thumbnailRequestsInFlight.delete(imageId);
          }
        }

        if (updated > 0) {
          await get().refreshImages();
          get().bumpThumbnailCacheKey();
        }
      }
    } finally {
      thumbnailQueueRunning = false;
    }
  },
  checkProblemItems: async (project) => {
    if (!hasTauriRuntime() || !project?.datasetId) {
      return undefined;
    }
    if (
      project.id === "asset-database-group" ||
      project.id === "database-group" ||
      project.id === "workspace-folder-group"
    ) {
      return undefined;
    }

    set({ isCheckingProblemItems: true });
    get().addAppLog(i18next.t("appLog.problemCheckStarting", { name: project.name }));
    try {
      const summary = await invokeCommand<ProblemItemCheckSummary>("check_problem_items", {
        datasetId: project.datasetId,
        imageIds: project.imageIds
      });
      await get().refreshImages();
      get().addAppLog(
        i18next.t("appLog.problemCheckCompleted", {
          checked: summary.checked,
          updated: summary.updated,
          missing: summary.missing,
          failed: summary.failed
        })
      );
      return summary;
    } catch (error) {
      get().addAppLog(
        i18next.t("appLog.problemCheckFailed", { message: formatAppError(error) }),
        "error"
      );
      return undefined;
    } finally {
      set({ isCheckingProblemItems: false });
    }
  },
  openImportWizard: () =>
    {
      get().addAppLog(i18next.t("appLog.importWizardOpened"));
      set({
      showImportWizard: true,
      appView: "workspace",
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined,
      pendingImportKind: undefined,
      preparedImportKind: undefined,
      selectedProjectId: undefined,
      ...createImageSelection([]),
      previewImageId: undefined
      });
    },
  closeImportWizard: () => {
    get().addAppLog(i18next.t("appLog.importWizardClosed"));
    set({ showImportWizard: false });
  },
  importAssetDatabase: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({
      isLoading: true,
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined,
      preparedImportKind: "asset"
    });
    get().addAppLog(i18next.t("appLog.assetImportPrepareStarting"));
    try {
      const preview = await invokeCommand<ImportPreview>("prepare_import_folder");
      get().addAppLog(
        i18next.t("appLog.assetImportPrepareCompleted", {
          imageCount: preview.imageCount,
          annotatedImageCount: preview.annotatedImageCount
        })
      );
      set({
        importPreview: preview,
        appView: "workspace",
        showImportWizard: false,
        pendingImportKind: undefined,
        preparedImportKind: "asset",
        annotationType: preview.annotatedImageCount > 0 ? get().annotationType : "",
        selectedProjectId: undefined,
        ...createImageSelection([]),
        previewImageId: undefined
      });
    } catch (error) {
      const payload = error as { code?: string };
      if (payload.code !== "dialog_cancelled") {
        get().addAppLog(
          i18next.t("appLog.assetImportPrepareFailed", { message: formatAppError(error) }),
          "error"
        );
      } else {
        get().addAppLog(i18next.t("appLog.assetImportPrepareCancelled"), "warning");
      }
    } finally {
      set({ isLoading: false });
    }
  },
  importFolder: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({
      isLoading: true,
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined,
      preparedImportKind: "database"
    });
    get().addAppLog(i18next.t("appLog.dynamicImportPrepareStarting"));
    try {
      const preview = await invokeCommand<ImportPreview>("prepare_import_folder");
      get().addAppLog(
        i18next.t("appLog.dynamicImportPrepareCompleted", {
          imageCount: preview.imageCount,
          annotatedImageCount: preview.annotatedImageCount
        })
      );
      set({
        importPreview: preview,
        appView: "workspace",
        showImportWizard: false,
        pendingImportKind: undefined,
        preparedImportKind: "database",
        annotationType: preview.annotatedImageCount > 0 ? get().annotationType : "",
        selectedProjectId: undefined,
        ...createImageSelection([]),
        previewImageId: undefined
      });
    } catch (error) {
      const payload = error as { code?: string };
      if (payload.code !== "dialog_cancelled") {
        get().addAppLog(
          i18next.t("appLog.dynamicImportPrepareFailed", { message: formatAppError(error) }),
          "error"
        );
      } else {
        get().addAppLog(i18next.t("appLog.dynamicImportPrepareCancelled"), "warning");
      }
    } finally {
      set({ isLoading: false });
    }
  },
  mountFolder: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({
      isLoading: true,
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined,
      preparedImportKind: undefined,
      pendingImportKind: "folder"
    });
    get().addAppLog(i18next.t("appLog.folderMountStarting"));
    try {
      await invokeCommand<void>("mount_folder_dataset");
      set({
        showImportWizard: false,
        importProgress: {
          phase: "scanning",
          processed: 0,
          total: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          currentPath: i18next.t("appLog.folderScanning"),
          done: false
        }
      });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      const projects = createProjectTree(images);
      const firstFolder = projects.find((project) => project.sourceKind === "folder");
      get().addAppLog(i18next.t("appLog.folderMountCompleted", { imageCount: images.length }));
      set({
        images,
        profiles,
        projects,
        appView: "workspace",
        showImportWizard: false,
        importProgress: undefined,
        pendingImportKind: undefined,
        selectedProjectId: firstFolder?.id,
        ...createImageSelection([]),
        previewImageId: undefined,
        activeProfileId: firstFolder?.datasetId
          ? profiles.find((profile) => profile.datasetId === firstFolder.datasetId)?.id
          : profiles[0]?.id
      });
    } catch (error) {
      const payload = error as { code?: string };
      set({ importProgress: undefined, pendingImportKind: undefined });
      if (payload.code !== "dialog_cancelled") {
        get().addAppLog(
          i18next.t("appLog.folderMountFailed", { message: formatAppError(error) }),
          "error"
        );
      } else {
        get().addAppLog(i18next.t("appLog.folderMountCancelled"), "warning");
      }
    } finally {
      set({ isLoading: false, importProgress: undefined, pendingImportKind: undefined });
    }
  },
  startPreparedImport: async () => {
    const preview = get().importPreview;
    const importMode = get().preparedImportKind ?? "database";
    if (!hasTauriRuntime() || !preview) {
      return;
    }

    await get().initImportEvents();
    get().addAppLog(
      i18next.t("appLog.preparedImportStarting", {
        mode:
          importMode === "asset"
            ? i18next.t("importWizard.assetDatabase")
            : i18next.t("importWizard.dynamicDatabase"),
        path: preview.folderPath
      })
    );
    set({
      isLoading: true,
      importPreview: undefined,
      importReport: undefined,
      pendingImportKind: importMode,
      importProgress: {
        phase: "scanning",
        processed: 0,
        total: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        done: false
      }
    });
    try {
      await invokeCommand<void>("start_import_folder", {
        folderPath: preview.folderPath,
        annotationType: get().annotationType.trim() || undefined,
        importMode
      });
    } catch (error) {
      set({
        isLoading: false,
        importProgress: undefined,
        pendingImportKind: undefined,
        preparedImportKind: undefined
      });
      get().addAppLog(
        i18next.t("appLog.preparedImportFailed", { message: formatAppError(error) }),
        "error"
      );
    }
  },
  browseImportedDataset: async () => {
    const report = get().importReport;
    if (!hasTauriRuntime() || !report) {
      return;
    }

    set({ isLoading: true });
    get().addAppLog(i18next.t("appLog.browseImportStarting"));
    try {
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      const projects = createProjectTree(images, report.rootName, report.rootPath);
      const selectedProject =
        projects.find((project) => project.name === report.rootName) ?? projects[0];
      const activeProfileId =
        profiles.find((profile) => profile.datasetId === selectedProject?.datasetId)?.id ??
        profiles[0]?.id;
      set({
        images,
        profiles,
        projects,
        appView: "workspace",
        selectedProjectId: selectedProject?.id,
        ...createImageSelection([]),
        previewImageId: undefined,
        activeProfileId,
        importReport: undefined
      });
      get().addAppLog(i18next.t("appLog.browseImportCompleted", { imageCount: images.length }));
    } catch (error) {
      get().addAppLog(
        i18next.t("appLog.browseImportFailed", { message: formatAppError(error) }),
        "error"
      );
    } finally {
      set({ isLoading: false });
    }
  },
  setAnnotationType: (annotationType) => set({ annotationType }),
  clearImportPreview: () =>
    set({ importPreview: undefined, annotationType: "", preparedImportKind: undefined }),
  removeDataset: async (project) => {
    if (hasTauriRuntime()) {
      if (getProjectSourceKind(project) === "folder") {
        if (project.id.startsWith("folder-root:")) {
          await invokeCommand<number>("remove_folder_dataset", {
            folderPath: project.path
          });
        } else {
          await invokeCommand<void>("delete_workspace_subfolder", {
            folderPath: project.path
          });
        }
      } else if (
        project.id.startsWith("dataset-root:") ||
        project.id.startsWith("asset-root:")
      ) {
        await invokeCommand<number>("remove_training_set", {
          datasetId: project.datasetId
        });
      } else {
        await invokeCommand<number>("remove_dataset_folder", {
          folderPath: project.path,
          sourceKind: getProjectSourceKind(project),
          datasetId: project.datasetId
        });
      }

      try {
        const [images, profiles] = await Promise.all([
          invokeCommand<DatasetImage[]>("list_images"),
          invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
        ]);
        set({
          images,
          profiles,
          projects: createProjectTree(images),
          appView: "initial",
          selectedProjectId: undefined,
          ...createImageSelection([]),
          previewImageId: undefined,
          activeProfileId: profiles[0]?.id,
          importPreview: undefined,
          importProgress: undefined,
          importReport: undefined,
          pendingImportKind: undefined
        });
      } catch (refreshError) {
        get().addAppLog(
          i18next.t("appLog.removeRefreshFailed", { message: formatAppError(refreshError) }),
          "error"
        );
      }
      return;
    }

    const ids = new Set(project.imageIds);
    set((state) => {
      const images = state.images.filter((image) => !ids.has(image.id));
      const usedProfileIds = new Set(
        images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
      );
      const profiles = state.profiles.filter((profile) => usedProfileIds.has(profile.id));
      const activeProfileId = profiles.some((profile) => profile.id === state.activeProfileId)
        ? state.activeProfileId
        : profiles[0]?.id;
      const nextSelectedImageIds = state.selectedImageIds.filter((imageId) => !ids.has(imageId));
      const nextSelectedImageId =
        state.selectedImageId !== undefined && ids.has(state.selectedImageId)
          ? undefined
          : state.selectedImageId;
      const nextSelectionAnchorImageId =
        state.selectionAnchorImageId !== undefined && ids.has(state.selectionAnchorImageId)
          ? undefined
          : state.selectionAnchorImageId;
      return {
        images,
        profiles,
        projects: createProjectTree(images),
        appView: "workspace",
        activeProfileId,
        selectedProjectId:
          state.selectedProjectId === project.id ? undefined : state.selectedProjectId,
        ...createImageSelection(
          nextSelectedImageIds,
          nextSelectedImageId,
          nextSelectionAnchorImageId
        ),
        previewImageId:
          state.previewImageId && ids.has(state.previewImageId)
            ? undefined
            : state.previewImageId
      };
    });
  },
  renameDatasetFolder: async (project, name) => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === project.name) {
      return;
    }

    if (/[\\/]/.test(trimmedName)) {
      throw new Error("Folder name cannot contain path separators.");
    }

    const parentPath = getDirectory(project.path);
    const newPath = parentPath ? `${parentPath}/${trimmedName}` : trimmedName;
    if (hasTauriRuntime()) {
      await invokeCommand<string>("rename_dataset_folder", {
        folderPath: project.path,
        newName: trimmedName,
        sourceKind: getProjectSourceKind(project),
        datasetId: project.datasetId
      });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set((state) => ({
        images,
        profiles,
        projects: createProjectTree(images),
        selectedProjectId: renameProjectIdPrefix(state.selectedProjectId, project.path, newPath),
        selectedImageId: state.selectedImageId,
        previewImageId: state.previewImageId,
        activeProfileId: state.activeProfileId
      }));
      return;
    }

    set((state) => {
      const images = state.images.map((image) => ({
        ...image,
        ...(getProjectSourceKind(project) === "folder"
          ? { path: renamePathPrefix(image.path, project.path, newPath) }
          : { datasetPath: renamePathPrefix(image.datasetPath ?? image.fileName, project.path, newPath) })
      }));
      return {
        images,
        projects: createProjectTree(images),
        selectedProjectId: renameProjectIdPrefix(state.selectedProjectId, project.path, newPath)
      };
    });
  },
  createDatasetSubfolder: async (project, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    if (/[\\/]/.test(trimmedName)) {
      throw new Error("Folder name cannot contain path separators.");
    }

    if (hasTauriRuntime()) {
      await invokeCommand<string>("create_dataset_subfolder", {
        folderPath: project.path,
        name: trimmedName,
        sourceKind: getProjectSourceKind(project),
        datasetId: project.datasetId
      });
      get().addAppLog(i18next.t("appLog.subfolderCreated", { name: trimmedName }));
      await get().refreshImages();
      return;
    }
  },
  consolidateLooseFiles: async (project, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    if (/[\\/]/.test(trimmedName)) {
      throw new Error("Folder name cannot contain path separators.");
    }

    const state = get();
    const looseImageIdSet = new Set(project.imageIds);
    const looseImages = state.images.filter((image) => looseImageIdSet.has(image.id));
    const targetProjectId = getChildProjectId(project, trimmedName);

    if (hasTauriRuntime()) {
      await invokeCommand<number>("consolidate_loose_files", {
        folderPath: project.path,
        folderName: trimmedName,
        imageIds: project.imageIds,
        imagePaths: looseImages.map((image) => image.path),
        sourceKind: getProjectSourceKind(project),
        datasetId: project.datasetId
      });
      await get().refreshImages();
      set({ selectedProjectId: targetProjectId });
      get().addAppLog(i18next.t("appLog.looseFilesConsolidated", { name: trimmedName }));
      return;
    }

    set((current) => {
      const ids = new Set(project.imageIds);
      const targetFolderPath = joinPath(project.path, trimmedName);
      const images = current.images.map((image) => {
        if (!ids.has(image.id)) return image;

        if (getProjectSourceKind(project) === "folder") {
          return {
            ...image,
            path: joinPath(targetFolderPath, image.fileName),
            updatedAt: new Date().toISOString()
          };
        }

        return {
          ...image,
          datasetPath: joinPath(targetFolderPath, image.fileName),
          updatedAt: new Date().toISOString()
        };
      });
      return {
        images,
        projects: createProjectTree(images),
        selectedProjectId: targetProjectId
      };
    });
  },
  deleteLooseFiles: async (project) => {
    const state = get();
    const looseImageIdSet = new Set(project.imageIds);
    const looseImages = state.images.filter((image) => looseImageIdSet.has(image.id));

    if (hasTauriRuntime()) {
      await invokeCommand<number>("delete_loose_files", {
        imageIds: project.imageIds,
        imagePaths: looseImages.map((image) => image.path),
        sourceKind: getProjectSourceKind(project),
        datasetId: project.datasetId
      });
      await get().refreshImages();
      set((current) => ({
        selectedProjectId:
          current.selectedProjectId === project.id ? undefined : current.selectedProjectId
      }));
      get().addAppLog(i18next.t("appLog.looseFilesDeleted", { count: project.imageIds.length }));
      return;
    }

    const ids = new Set(project.imageIds);
    set((current) => {
      const images = current.images.filter((image) => !ids.has(image.id));
      return {
        images,
        projects: createProjectTree(images),
        selectedProjectId: current.selectedProjectId === project.id ? undefined : current.selectedProjectId
      };
    });
  },
  renameDatasetImage: async (image, name) => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === image.fileName) {
      return;
    }
    if (/[\\/]/.test(trimmedName)) {
      throw new Error("Image name cannot contain path separators.");
    }

    const nextFileName = getRenamedImageFileName(image, trimmedName);
    const nextPath = replacePathFileName(
      image.sourceKind === "folder" ? image.path : image.datasetPath ?? image.fileName,
      nextFileName
    );

    if (hasTauriRuntime()) {
      await invokeCommand<string>("rename_dataset_image", {
        imageId: image.id,
        imagePath: image.path,
        sourceKind: image.sourceKind,
        newName: nextFileName
      });
      await get().refreshImages();
      return;
    }

    set((state) => {
      const images = state.images.map((item) =>
        item.id === image.id
          ? {
              ...item,
              fileName: nextFileName,
              path: nextPath,
              updatedAt: new Date().toISOString()
            }
          : item
      );
      return {
        images,
        projects: createProjectTree(images)
      };
    });
  },
  deleteDatasetImage: async (image) => {
    if (hasTauriRuntime()) {
      await invokeCommand<number>("delete_dataset_image", {
        imageId: image.id,
        imagePath: image.path,
        sourceKind: image.sourceKind
      });
      try {
        const profiles = await invokeCommand<AnnotationProfile[]>("list_annotation_profiles");
        set({ profiles });
      } catch (error) {
        get().addAppLog(
          i18next.t("appLog.deleteImageRefreshProfilesFailed", {
            message: formatAppError(error)
          }),
          "error"
        );
      }
      try {
        await get().refreshImages();
      } catch (error) {
        get().addAppLog(
          i18next.t("appLog.deleteImageRefreshImagesFailed", { message: formatAppError(error) }),
          "error"
        );
      }
      return;
    }

    set((state) => {
      const images = state.images.filter((item) => item.id !== image.id);
      const usedProfileIds = new Set(
        images.flatMap((item) => item.annotations.map((annotation) => annotation.profileId))
      );
      const profiles = state.profiles.filter((profile) => usedProfileIds.has(profile.id));
      const selectedImageIds = state.selectedImageIds.filter((imageId) => imageId !== image.id);
      const activeProfileId = profiles.some((profile) => profile.id === state.activeProfileId)
        ? state.activeProfileId
        : profiles[0]?.id;

      return {
        images,
        profiles,
        projects: createProjectTree(images),
        activeProfileId,
        ...createImageSelection(
          selectedImageIds,
          state.selectedImageId === image.id ? selectedImageIds.at(-1) : state.selectedImageId,
          state.selectionAnchorImageId === image.id
            ? selectedImageIds.at(-1)
            : state.selectionAnchorImageId
        ),
        previewImageId: state.previewImageId === image.id ? undefined : state.previewImageId
      };
    });
  },
  openExportDialog: () => {
    get().addAppLog(i18next.t("appLog.exportDialogOpened"));
    set({
      showExportDialog: true,
      exportPreview: undefined,
      exportProgress: undefined
    });
  },
  closeExportDialog: () => set({ showExportDialog: false }),
  prepareExportDataset: async (request) => {
    if (!hasTauriRuntime()) {
      const images = get().images.filter((image) => request.imageIds.includes(image.id));
      const estimatedSizeBytes = images.reduce((sum, image) => {
        const annotationContent =
          image.annotations.find((annotation) => annotation.profileId === request.profileId)?.content ??
          image.annotations[0]?.content ??
          "";
        return sum + (image.fileSize ?? 0) + new TextEncoder().encode(annotationContent).length;
      }, 0);
      const preview: ExportPreview = {
        outputDir: request.outputDir,
        estimatedSizeBytes,
        imageCount: images.length,
        annotationCount: images.filter((image) =>
          image.annotations.some((annotation) =>
            request.profileId
              ? annotation.profileId === request.profileId && annotation.content.trim()
              : annotation.content.trim()
          )
        ).length
      };
      set({ exportPreview: preview });
      return preview;
    }

    const preview = await invokeCommand<ExportPreview>("prepare_export_dataset", { request });
    set({ exportPreview: preview });
    return preview;
  },
  startExportDataset: async (request) => {
    if (!hasTauriRuntime()) {
      get().addAppLog(i18next.t("appLog.realExportUnsupported"), "warning");
      return;
    }

    await get().initExportEvents();
    set({
      isLoading: true,
      exportProgress: {
        phase: "exporting",
        processed: 0,
        total: get().exportPreview?.imageCount ?? request.imageIds.length,
        exported: 0,
        failed: 0,
        outputDir: get().exportPreview?.outputDir,
        estimatedSizeBytes: get().exportPreview?.estimatedSizeBytes ?? 0,
        writtenSizeBytes: 0,
        done: false
      }
    });
    get().addAppLog(i18next.t("appLog.exportStarting"));

    try {
      await invokeCommand<void>("start_export_dataset", { request });
    } catch (error) {
      set({ isLoading: false, exportProgress: undefined });
      get().addAppLog(
        i18next.t("appLog.exportStartFailed", { message: formatAppError(error) }),
        "error"
      );
      throw error;
    }
  },
  openExportDatabaseDialog: () => {
    get().addAppLog(i18next.t("appLog.databaseExportDialogOpened"));
    set({
      showExportDatabaseDialog: true,
      databaseExportProgress: undefined
    });
  },
  closeExportDatabaseDialog: () => set({ showExportDatabaseDialog: false }),
  openImportDatabaseDialog: () => {
    get().addAppLog(i18next.t("appLog.databaseImportDialogOpened"));
    set({ showImportDatabaseDialog: true });
  },
  closeImportDatabaseDialog: () => set({ showImportDatabaseDialog: false }),
  startExportDatabase: async (request) => {
    if (!hasTauriRuntime()) {
      get().addAppLog(i18next.t("appLog.realExportUnsupported"), "warning");
      return;
    }

    await get().initDatabaseExportEvents();
    set({
      isLoading: true,
      databaseExportProgress: {
        phase: "checkpointing",
        processed: 0,
        total: 1,
        exported: 0,
        failed: 0,
        outputPath: request.outputPath,
        estimatedSizeBytes: 0,
        writtenSizeBytes: 0,
        done: false
      }
    });
    get().addAppLog(i18next.t("appLog.databaseExportStarting"));

    try {
      await invokeCommand<void>("start_export_database", { request });
    } catch (error) {
      set({ isLoading: false, databaseExportProgress: undefined });
      get().addAppLog(
        i18next.t("appLog.databaseExportStartFailed", { message: formatAppError(error) }),
        "error"
      );
      throw error;
    }
  },
  importDatabase: async (request) => {
    if (!hasTauriRuntime()) {
      get().addAppLog(i18next.t("appLog.realImportUnsupported"), "warning");
      return undefined;
    }

    set({ isLoading: true });
    get().addAppLog(i18next.t("appLog.databaseImportStarting"));
    try {
      const result = await invokeCommand<DatabaseImportResult>("import_database", { request });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set({
        images,
        profiles,
        projects: createProjectTree(images, result.rootName, result.rootPath),
        showImportDatabaseDialog: false,
        appView: "workspace",
        selectedProjectId: undefined,
        ...createImageSelection([]),
        previewImageId: undefined
      });
      get().addAppLog(
        i18next.t("appLog.databaseImportCompleted", {
          imageCount: result.imageCount,
          copiedImageCount: result.copiedImageCount
        })
      );
      return result;
    } catch (error) {
      get().addAppLog(
        i18next.t("appLog.databaseImportFailed", { message: formatAppError(error) }),
        "error"
      );
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  setAppView: (view) => set({ appView: view, previewImageId: undefined }),
  setWorkspaceTab: (tab) => set({ workspaceTab: tab, appView: "workspace" }),
  addAppLog: (message, level = "info") =>
    set((state) => ({
      appLogs: [
        ...state.appLogs,
        {
          id: Date.now() + state.appLogs.length,
          timestamp: new Date().toISOString(),
          level,
          message
        }
      ].slice(-500)
    })),
  clearAppLogs: () => set({ appLogs: [] }),
  selectProject: (id) =>
    set((state) => {
      const project = flattenProjects(state.projects).find((project) => project.id === id);
      if (!project) return state;

      const projectProfiles = project.datasetId
        ? state.profiles.filter((profile) => profile.datasetId === project.datasetId)
        : [];
      const activeProfileId = project.datasetId
        ? projectProfiles.some((profile) => profile.id === state.activeProfileId)
          ? state.activeProfileId
          : projectProfiles[0]?.id ?? state.activeProfileId
        : state.activeProfileId;

      return {
        appView: "workspace",
        selectedProjectId: id,
        ...createImageSelection([]),
        previewImageId: undefined,
        activeProfileId,
        showImportWizard: state.importProgress ? state.showImportWizard : false,
        importPreview: state.importProgress ? state.importPreview : undefined,
        importReport: state.importProgress ? state.importReport : undefined
      };
    }),
  selectImage: (id) => set(createImageSelection(id === undefined ? [] : [id], id, id)),
  setImageSelection: (ids, activeId, anchorId) =>
    set(createImageSelection(ids, activeId, anchorId)),
  toggleImageSelection: (id) =>
    set((state) => {
      const selectedIds = new Set(state.selectedImageIds);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }

      const nextIds = Array.from(selectedIds);
      const activeId = selectedIds.has(id) ? id : nextIds.at(-1);
      return createImageSelection(nextIds, activeId, activeId);
    }),
  openImagePreview: (id) =>
    set({ appView: "workspace", previewImageId: id, ...createImageSelection([id], id, id) }),
  closeImagePreview: () => set({ previewImageId: undefined }),
  bumpThumbnailCacheKey: () =>
    set((state) => ({ thumbnailCacheKey: state.thumbnailCacheKey + 1 })),
  setSearch: (search) => set({ search }),
  setViewFilter: (mode, projectId, imageIds = []) =>
    set({
      viewFilterMode: mode,
      viewFilterProjectId: mode === "all" ? undefined : projectId,
      viewFilterImageIds: mode === "all" ? [] : imageIds
    }),
  resetTableDrafts: (profileId, annotationDrafts, instructionDrafts) =>
    set((state) => {
      const imageIds = new Set(state.images.map((image) => image.id));
      const nextAnnotationDrafts = {
        ...annotationDrafts,
        ...filterTableDraftsForImageIds(
          state.tableProfileAnnotationDrafts[profileId] ?? {},
          imageIds
        )
      };
      const nextInstructionDrafts = {
        ...instructionDrafts,
        ...filterTableDraftsForImageIds(
          state.tableProfileInstructionDrafts[profileId] ?? {},
          imageIds
        )
      };
      const tableProfileAnnotationDrafts = {
        ...state.tableProfileAnnotationDrafts,
        [profileId]: nextAnnotationDrafts
      };
      const tableProfileInstructionDrafts = {
        ...state.tableProfileInstructionDrafts,
        [profileId]: nextInstructionDrafts
      };

      if (state.tableDraftProfileId !== undefined) {
        tableProfileAnnotationDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableAnnotationDrafts,
          imageIds
        );
        tableProfileInstructionDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableInstructionDrafts,
          imageIds
        );
      }

      return {
        tableDraftProfileId: profileId,
        tableAnnotationDrafts: nextAnnotationDrafts,
        tableInstructionDrafts: nextInstructionDrafts,
        tableProfileAnnotationDrafts,
        tableProfileInstructionDrafts,
        tableSavedCellKeys: [],
        tableFailedCellKeys: state.tableFailedCellKeys.filter((key) => {
          const imageId = Number(key.split(":")[0]);
          return imageIds.has(imageId);
        }),
        tableLatestCellStates: Object.fromEntries(
          Object.entries(state.tableLatestCellStates).filter(([key, value]) => {
            const imageId = Number(key.split(":")[0]);
            return imageIds.has(imageId) && value !== "saved";
          })
        )
      };
    }),
  mergeTableDrafts: (annotationDrafts, instructionDrafts) =>
    set((state) => {
      const imageIds = new Set(state.images.map((image) => image.id));
      const currentAnnotationDrafts = filterTableDraftsForImageIds(
        state.tableAnnotationDrafts,
        imageIds
      );
      const currentInstructionDrafts = filterTableDraftsForImageIds(
        state.tableInstructionDrafts,
        imageIds
      );
      const nextAnnotationDrafts = {
        ...annotationDrafts,
        ...currentAnnotationDrafts
      };
      const nextInstructionDrafts = {
        ...instructionDrafts,
        ...currentInstructionDrafts
      };

      return {
        tableAnnotationDrafts: nextAnnotationDrafts,
        tableInstructionDrafts: nextInstructionDrafts,
        tableProfileAnnotationDrafts:
          state.tableDraftProfileId === undefined
            ? state.tableProfileAnnotationDrafts
            : {
                ...state.tableProfileAnnotationDrafts,
                [state.tableDraftProfileId]: nextAnnotationDrafts
              },
        tableProfileInstructionDrafts:
          state.tableDraftProfileId === undefined
            ? state.tableProfileInstructionDrafts
            : {
                ...state.tableProfileInstructionDrafts,
                [state.tableDraftProfileId]: nextInstructionDrafts
              },
        tableSavedCellKeys: state.tableSavedCellKeys.filter((key) => {
          const imageId = Number(key.split(":")[0]);
          return imageIds.has(imageId);
        }),
        tableFailedCellKeys: state.tableFailedCellKeys.filter((key) => {
          const imageId = Number(key.split(":")[0]);
          return imageIds.has(imageId);
        }),
        tableLatestCellStates: Object.fromEntries(
          Object.entries(state.tableLatestCellStates).filter(([key]) => {
            const imageId = Number(key.split(":")[0]);
            return imageIds.has(imageId);
          })
        )
      };
    }),
  applyGeneratedAnnotationDraft: (profileId, imageId, content) =>
    get().applyTableDraft(profileId, imageId, { content }),
  applyTableDraft: (profileId, imageId, draft) =>
    set((state) => {
      const imageIds = new Set(state.images.map((image) => image.id));
      const cachedAnnotationDrafts = filterTableDraftsForImageIds(
        state.tableProfileAnnotationDrafts[profileId] ?? {},
        imageIds
      );
      const cachedInstructionDrafts = filterTableDraftsForImageIds(
        state.tableProfileInstructionDrafts[profileId] ?? {},
        imageIds
      );
      const annotationDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableAnnotationDrafts
          : {
              ...Object.fromEntries(
                state.images.map((image) => [
                  image.id,
                  getAnnotationContentForProfile(image, profileId)
                ])
              ),
              ...cachedAnnotationDrafts
            };
      const instructionDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableInstructionDrafts
          : {
              ...Object.fromEntries(
                state.images.map((image) => [
                  image.id,
                  getInstructionForProfile(image, profileId)
                ])
              ),
              ...cachedInstructionDrafts
            };
      const nextAnnotationDrafts = {
        ...annotationDrafts,
        ...(draft.content !== undefined ? { [imageId]: draft.content } : {})
      };
      const nextInstructionDrafts = {
        ...instructionDrafts,
        ...(draft.instruction !== undefined ? { [imageId]: draft.instruction } : {})
      };
      const tableProfileAnnotationDrafts = {
        ...state.tableProfileAnnotationDrafts,
        [profileId]: nextAnnotationDrafts
      };
      const tableProfileInstructionDrafts = {
        ...state.tableProfileInstructionDrafts,
        [profileId]: nextInstructionDrafts
      };

      if (state.tableDraftProfileId !== undefined && state.tableDraftProfileId !== profileId) {
        tableProfileAnnotationDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableAnnotationDrafts,
          imageIds
        );
        tableProfileInstructionDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableInstructionDrafts,
          imageIds
        );
      }

      return {
        tableDraftProfileId: profileId,
        tableAnnotationDrafts: nextAnnotationDrafts,
        tableInstructionDrafts: nextInstructionDrafts,
        tableProfileAnnotationDrafts,
        tableProfileInstructionDrafts,
        tableSavedCellKeys: state.tableSavedCellKeys.filter((key) => {
          if (draft.content !== undefined && key === `${imageId}:annotation`) return false;
          if (draft.instruction !== undefined && key === `${imageId}:instruction`) return false;
          return true;
        }),
        tableFailedCellKeys: state.tableFailedCellKeys.filter((key) => {
          if (draft.content !== undefined && key === `${imageId}:annotation`) return false;
          if (draft.instruction !== undefined && key === `${imageId}:instruction`) return false;
          return true;
        }),
        tableLatestCellStates: {
          ...state.tableLatestCellStates,
          ...(draft.content !== undefined ? { [`${imageId}:annotation`]: "dirty" as const } : {}),
          ...(draft.instruction !== undefined
            ? { [`${imageId}:instruction`]: "dirty" as const }
            : {})
        }
      };
    }),
  applyBatchTableDrafts: (profileId, drafts) =>
    set((state) => {
      const imageIds = new Set(state.images.map((image) => image.id));
      const cachedAnnotationDrafts = filterTableDraftsForImageIds(
        state.tableProfileAnnotationDrafts[profileId] ?? {},
        imageIds
      );
      const cachedInstructionDrafts = filterTableDraftsForImageIds(
        state.tableProfileInstructionDrafts[profileId] ?? {},
        imageIds
      );
      const annotationDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableAnnotationDrafts
          : {
              ...Object.fromEntries(
                state.images.map((image) => [
                  image.id,
                  getAnnotationContentForProfile(image, profileId)
                ])
              ),
              ...cachedAnnotationDrafts
            };
      const instructionDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableInstructionDrafts
          : {
              ...Object.fromEntries(
                state.images.map((image) => [
                  image.id,
                  getInstructionForProfile(image, profileId)
                ])
              ),
              ...cachedInstructionDrafts
            };
      const nextAnnotationDrafts = { ...annotationDrafts };
      const nextInstructionDrafts = { ...instructionDrafts };
      const changedCellKeys = new Set<string>();

      for (const draft of drafts) {
        if (draft.content !== undefined) {
          nextAnnotationDrafts[draft.imageId] = draft.content;
          changedCellKeys.add(`${draft.imageId}:annotation`);
        }
        if (draft.instruction !== undefined) {
          nextInstructionDrafts[draft.imageId] = draft.instruction;
          changedCellKeys.add(`${draft.imageId}:instruction`);
        }
      }

      const tableProfileAnnotationDrafts = {
        ...state.tableProfileAnnotationDrafts,
        [profileId]: nextAnnotationDrafts
      };
      const tableProfileInstructionDrafts = {
        ...state.tableProfileInstructionDrafts,
        [profileId]: nextInstructionDrafts
      };

      if (state.tableDraftProfileId !== undefined && state.tableDraftProfileId !== profileId) {
        tableProfileAnnotationDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableAnnotationDrafts,
          imageIds
        );
        tableProfileInstructionDrafts[state.tableDraftProfileId] = filterTableDraftsForImageIds(
          state.tableInstructionDrafts,
          imageIds
        );
      }

      return {
        tableDraftProfileId: profileId,
        tableAnnotationDrafts: nextAnnotationDrafts,
        tableInstructionDrafts: nextInstructionDrafts,
        tableProfileAnnotationDrafts,
        tableProfileInstructionDrafts,
        tableSavedCellKeys: state.tableSavedCellKeys.filter((key) => !changedCellKeys.has(key)),
        tableFailedCellKeys: state.tableFailedCellKeys.filter((key) => !changedCellKeys.has(key)),
        tableLatestCellStates: {
          ...state.tableLatestCellStates,
          ...Object.fromEntries(Array.from(changedCellKeys, (key) => [key, "dirty" as const]))
        }
      };
    }),
  updateTableAnnotationDraft: (imageId, value) =>
    set((state) => ({
      tableAnnotationDrafts: {
        ...state.tableAnnotationDrafts,
        [imageId]: value
      },
      tableProfileAnnotationDrafts:
        state.tableDraftProfileId === undefined
          ? state.tableProfileAnnotationDrafts
          : {
              ...state.tableProfileAnnotationDrafts,
              [state.tableDraftProfileId]: {
                ...state.tableAnnotationDrafts,
                [imageId]: value
              }
            },
      tableSavedCellKeys: state.tableSavedCellKeys.filter(
        (key) => key !== `${imageId}:annotation`
      ),
      tableFailedCellKeys: state.tableFailedCellKeys.filter(
        (key) => key !== `${imageId}:annotation`
      ),
      tableLatestCellStates: {
        ...state.tableLatestCellStates,
        [`${imageId}:annotation`]: "dirty"
      }
    })),
  updateTableInstructionDraft: (imageId, value) =>
    set((state) => ({
      tableInstructionDrafts: {
        ...state.tableInstructionDrafts,
        [imageId]: value
      },
      tableProfileInstructionDrafts:
        state.tableDraftProfileId === undefined
          ? state.tableProfileInstructionDrafts
          : {
              ...state.tableProfileInstructionDrafts,
              [state.tableDraftProfileId]: {
                ...state.tableInstructionDrafts,
                [imageId]: value
              }
            },
      tableSavedCellKeys: state.tableSavedCellKeys.filter(
        (key) => key !== `${imageId}:instruction`
      ),
      tableFailedCellKeys: state.tableFailedCellKeys.filter(
        (key) => key !== `${imageId}:instruction`
      ),
      tableLatestCellStates: {
        ...state.tableLatestCellStates,
        [`${imageId}:instruction`]: "dirty"
      }
    })),
  markTableCellSaved: (key) =>
    set((state) => ({
      tableSavedCellKeys: state.tableSavedCellKeys.includes(key)
        ? state.tableSavedCellKeys
        : [...state.tableSavedCellKeys, key],
      tableFailedCellKeys: state.tableFailedCellKeys.filter((failedKey) => failedKey !== key),
      tableLatestCellStates: {
        ...state.tableLatestCellStates,
        [key]: "saved"
      }
    })),
  markTableCellFailed: (key) =>
    set((state) => ({
      tableFailedCellKeys: state.tableFailedCellKeys.includes(key)
        ? state.tableFailedCellKeys
        : [...state.tableFailedCellKeys, key],
      tableSavedCellKeys: state.tableSavedCellKeys.filter((savedKey) => savedKey !== key),
      tableLatestCellStates: {
        ...state.tableLatestCellStates,
        [key]: "failed"
      }
    })),
  clearTableCellFailure: (key) =>
    set((state) => ({
      tableFailedCellKeys: state.tableFailedCellKeys.filter((failedKey) => failedKey !== key),
      tableLatestCellStates:
        state.tableLatestCellStates[key] === "failed"
          ? Object.fromEntries(
              Object.entries(state.tableLatestCellStates).filter(([cellKey]) => cellKey !== key)
            )
          : state.tableLatestCellStates
    })),
  clearTableFailedCellMarks: () =>
    set((state) => ({
      tableFailedCellKeys: [],
      tableLatestCellStates: Object.fromEntries(
        Object.entries(state.tableLatestCellStates).filter(([, value]) => value !== "failed")
      )
    })),
  clearTableSavedCellMarks: () =>
    set((state) => ({
      tableSavedCellKeys: [],
      tableLatestCellStates: Object.fromEntries(
        Object.entries(state.tableLatestCellStates).filter(([, value]) => value !== "saved")
      )
    })),
  setHighlightCellState: (enabled) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(highlightCellStateStorageKey, String(enabled));
    }
    set({ highlightCellState: enabled });
  },
  setAutoSaveAfterAnnotation: (enabled) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(autoSaveAfterAnnotationStorageKey, String(enabled));
    }
    set({ autoSaveAfterAnnotation: enabled });
  },
  setAutoSaveAfterBatch: (enabled) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(autoSaveAfterBatchStorageKey, String(enabled));
    }
    set({ autoSaveAfterBatch: enabled });
  },
  markImageAnnotating: (imageId, annotating) =>
    set((state) => ({
      annotatingImageIds: annotating
        ? state.annotatingImageIds.includes(imageId)
          ? state.annotatingImageIds
          : [...state.annotatingImageIds, imageId]
        : state.annotatingImageIds.filter((id) => id !== imageId)
    })),
  setActiveProfile: (id) => set({ activeProfileId: id }),
  saveAnnotation: async (imageId, profileId, content) => {
    const image = get().images.find((image) => image.id === imageId);
    assertProfileForDatabaseImage(image, profileId);

    if (hasTauriRuntime()) {
      if (image?.sourceKind === "folder") {
        await invokeCommand("save_folder_annotation", {
          imagePath: image.path,
          content
        });
      } else {
        await invokeCommand("save_annotation", {
          imageId,
          profileId: requireWritableProfileId(profileId),
          content
        });
      }
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: state.selectedImageId,
        previewImageId: state.previewImageId,
        selectedProjectId: state.selectedProjectId
      }));
      return;
    }

    const updatedAt = new Date().toISOString();
    set((state) => ({
      images: state.images.map((image) => {
        if (image.id !== imageId) return image;

        if (!hasWritableProfileId(profileId)) return image;
        const existing = image.annotations.find((annotation) => annotation.profileId === profileId);
        const annotations = existing
          ? image.annotations.map((annotation) =>
              annotation.profileId === profileId
                ? { ...annotation, content, updatedAt }
                : annotation
            )
          : [
              ...image.annotations,
              {
                id: Date.now(),
                imageId,
                profileId,
                content,
                instruction: "",
                createdAt: updatedAt,
                updatedAt
              }
            ];

        return {
          ...image,
          annotations,
          updatedAt
        };
      })
    }));
  },
  saveInstruction: async (imageId, profileId, instruction) => {
    const image = get().images.find((image) => image.id === imageId);
    assertProfileForDatabaseImage(image, profileId);

    if (hasTauriRuntime()) {
      if (image?.sourceKind === "folder") {
        await invokeCommand("save_folder_instruction", {
          imagePath: image.path,
          instruction
        });
      } else {
        await invokeCommand("save_instruction", {
          imageId,
          profileId: requireWritableProfileId(profileId),
          instruction
        });
      }
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: state.selectedImageId,
        previewImageId: state.previewImageId,
        selectedProjectId: state.selectedProjectId
      }));
      return;
    }

    const updatedAt = new Date().toISOString();
    set((state) => ({
      images: state.images.map((image) => {
        if (image.id !== imageId) return image;

        if (!hasWritableProfileId(profileId)) return image;
        const existing = image.annotations.find((annotation) => annotation.profileId === profileId);
        const annotations = existing
          ? image.annotations.map((annotation) =>
              annotation.profileId === profileId
                ? { ...annotation, instruction, updatedAt }
                : annotation
            )
          : [
              ...image.annotations,
              {
                id: Date.now(),
                imageId,
                profileId,
                content: "",
                instruction,
                createdAt: updatedAt,
                updatedAt
              }
            ];

        return {
          ...image,
          annotations,
          updatedAt
        };
      })
    }));
  },
  saveAnnotationChanges: async (changes) => {
    const effectiveChanges = changes.filter(
      (change) => change.content !== undefined || change.instruction !== undefined
    );
    if (effectiveChanges.length === 0) {
      return;
    }

    if (hasTauriRuntime()) {
      const state = get();
      const imageById = new Map(state.images.map((image) => [image.id, image]));
      const assetChanges: AnnotationChange[] = [];
      const databaseChanges: AnnotationChange[] = [];
      const folderChanges: AnnotationChange[] = [];

      for (const change of effectiveChanges) {
        const image = imageById.get(change.imageId);
        if (image?.sourceKind === "folder") {
          folderChanges.push(change);
        } else if (image?.sourceKind === "asset") {
          assertProfileForDatabaseImage(image, change.profileId);
          assetChanges.push(change);
        } else {
          assertProfileForDatabaseImage(image, change.profileId);
          databaseChanges.push(change);
        }
      }

      let folderSaveFailures = 0;
      for (const change of folderChanges) {
        const image = imageById.get(change.imageId);
        if (!image) continue;

        try {
          if (change.content !== undefined) {
            await invokeCommand("save_folder_annotation", {
              imagePath: image.path,
              content: change.content
            });
          }
          if (change.instruction !== undefined) {
            await invokeCommand("save_folder_instruction", {
              imagePath: image.path,
              instruction: change.instruction
            });
          }
        } catch (error) {
          folderSaveFailures++;
          get().addAppLog(
            i18next.t("appLog.folderAnnotationSaveFailed", {
              fileName: image.fileName,
              message: formatAppError(error)
            }),
            "error"
          );
        }
      }
      if (assetChanges.length > 0) {
        await invokeCommand("save_annotation_changes", { changes: assetChanges });
      }
      if (databaseChanges.length > 0) {
        await invokeCommand("save_annotation_changes", { changes: databaseChanges });
      }

      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((current) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: current.selectedImageId,
        previewImageId: current.previewImageId,
        selectedProjectId: current.selectedProjectId
      }));
      if (folderSaveFailures > 0) {
        throw new Error(
          i18next.t("appLog.folderAnnotationSaveFailures", { count: folderSaveFailures })
        );
      }
      return;
    }

    set((state) => {
      const images = applyAnnotationChanges(state.images, effectiveChanges);
      return {
        images,
        projects: createProjectTree(images)
      };
    });
  },
  createAnnotationProfile: async (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return undefined;
    }

    const state = get();
    const selectedProject = flattenProjects(state.projects).find(
      (project) => project.id === state.selectedProjectId
    );
    if (getProjectSourceKind(selectedProject) === "folder") {
      return undefined;
    }
    const selectedImage = state.images.find((image) => image.id === state.selectedImageId);
    const selectedDatasetId = selectedImage ? getImageDatasetId(selectedImage) : undefined;
    const targetDatasetId = selectedProject?.datasetId ?? selectedDatasetId;
    const duplicateProfile = state.profiles.some(
      (profile) =>
        profile.datasetId === targetDatasetId &&
        normalizeProfileName(profile.name) === normalizeProfileName(trimmedName)
    );
    if (duplicateProfile) {
      throw new Error(i18next.t("image.profileNameExists"));
    }
    const imageIds = selectedProject?.imageIds.length
      ? selectedProject.imageIds
      : selectedDatasetId
        ? state.images
            .filter((image) => getImageDatasetId(image) === selectedDatasetId)
            .map((image) => image.id)
        : state.projects[0]?.imageIds ?? state.images.map((image) => image.id);

    if (hasTauriRuntime()) {
      const profileId = await invokeCommand<number>("create_annotation_profile", {
        name: trimmedName,
        imageIds
      });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set((current) => ({
        images,
        profiles,
        projects: createProjectTree(images),
        selectedImageId: current.selectedImageId,
        previewImageId: current.previewImageId,
        selectedProjectId: current.selectedProjectId
      }));
      return profileId;
    }

    const now = new Date().toISOString();
    const profileId = Date.now();
    const profile: AnnotationProfile = {
      id: profileId,
      name: trimmedName,
      sourceKind: selectedProject?.sourceKind ?? selectedImage?.sourceKind ?? "database",
      datasetId: targetDatasetId
    };
    const idSet = new Set(imageIds);
    set((current) => ({
      profiles: [...current.profiles, profile],
      images: current.images.map((image) =>
        idSet.has(image.id)
          ? {
              ...image,
              annotations: [
                ...image.annotations,
                {
                  id: Date.now() + image.id,
                  imageId: image.id,
                  profileId,
                  content: "",
                  instruction: "",
                  createdAt: now,
                  updatedAt: now
                }
              ]
            }
          : image
      )
    }));
    return profileId;
  },
  renameAnnotationProfile: async (profileId, newName) => {
    if (hasTauriRuntime()) {
      await invokeCommand("rename_annotation_profile", { profileId, newName });
      const profiles = await invokeCommand<AnnotationProfile[]>("list_annotation_profiles");
      set({ profiles });
    } else {
      set((current) => ({
        profiles: current.profiles.map((p) =>
          p.id === profileId ? { ...p, name: newName.trim() } : p
        )
      }));
    }
  },
  duplicateAnnotationProfile: async (profileId, newName) => {
    if (hasTauriRuntime()) {
      await invokeCommand("duplicate_annotation_profile", { profileId, newName });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set((current) => ({
        images,
        profiles,
        projects: createProjectTree(images),
        selectedImageId: current.selectedImageId,
        previewImageId: current.previewImageId,
        selectedProjectId: current.selectedProjectId
      }));
    }
  },
  deleteAnnotationProfile: async (profileId) => {
    if (hasTauriRuntime()) {
      await invokeCommand("delete_annotation_profile", { profileId });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set((current) => ({
        images,
        profiles,
        projects: createProjectTree(images),
        selectedImageId: current.selectedImageId,
        previewImageId: current.previewImageId,
        selectedProjectId: current.selectedProjectId
      }));
    } else {
      set((current) => ({
        profiles: current.profiles.filter((p) => p.id !== profileId),
        images: current.images.map((image) => ({
          ...image,
          annotations: image.annotations.filter((a) => a.profileId !== profileId)
        }))
      }));
    }
  },
  clearAnnotation: async (annotationId) => {
    const selectedImageId = get().selectedImageId;
    if (hasTauriRuntime()) {
      const image = get().images.find((image) =>
        image.annotations.some((annotation) => annotation.id === annotationId)
      );
      if (image?.sourceKind === "folder") {
        await invokeCommand("save_folder_annotation", {
          imagePath: image.path,
          content: ""
        });
      } else {
        await invokeCommand("clear_annotation", { annotationId });
      }
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId,
        previewImageId: state.previewImageId,
        selectedProjectId: state.selectedProjectId
      }));
      return;
    }

    set((state) => ({
      images: state.images.map((image) => ({
        ...image,
        annotations: image.annotations.map((annotation) =>
          annotation.id === annotationId ? { ...annotation, content: "" } : annotation
        )
      }))
    }));
  }
}));
