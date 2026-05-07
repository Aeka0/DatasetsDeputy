import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { formatAppError } from "../lib/errors";
import { hasTauriRuntime, invokeCommand } from "../lib/tauri";
import type {
  AnnotationChange,
  AnnotationProfile,
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

function renameProjectIdPrefix(id: string | undefined, oldPrefix: string, newPrefix: string) {
  if (!id?.startsWith("folder:")) {
    return id;
  }

  const renamedPath = renamePathPrefix(id.slice("folder:".length), oldPrefix, newPrefix);
  return `folder:${renamedPath}`;
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
    const imageRoot = groupImages.find((image) => image.rootPath)?.rootPath;
    const groupRootPath = sourceKind === "folder" ? imageRoot : undefined;
    const groupRootName = sourceKind === "folder"
      ? getPathName(imageRoot ?? "", "Folder")
      : rootName;
    const normalizedGroupRoot = groupRootPath ? normalizePath(groupRootPath) : undefined;
    const groupMatchesImportRoot =
      normalizedGroupRoot &&
      groupImages.every((image) => normalizePath(image.path).startsWith(normalizedGroupRoot));
    const normalizedRoot = groupMatchesImportRoot
      ? normalizedGroupRoot
      : normalizePath(getCommonDirectory(groupImages));

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
      name: groupMatchesImportRoot && groupRootName
        ? groupRootName
        : getPathName(normalizedRoot, fallbackRootName),
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
          id: `${sourceKind}-folder:${path}`,
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

    for (const image of groupImages) {
      const directory = getDirectory(image.path);
      const relative = normalizedRoot && directory.startsWith(normalizedRoot)
        ? directory.slice(normalizedRoot.length).replace(/^\/+/, "")
        : "";

      if (!relative) continue;

      let current = root;
      let currentPath = normalizedRoot;

      for (const part of relative.split("/").filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        current = ensureChild(current, part, currentPath);
        if (!current.imageIds.includes(image.id)) {
          current.imageIds.push(image.id);
        }
      }
    }

    const pruneEmptyChildren = (project: DatasetProject): DatasetProject => ({
      ...project,
      children: project.children?.length
        ? project.children.map(pruneEmptyChildren)
        : undefined
    });

    return pruneEmptyChildren(root);
  });
}

function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
}

type WorkspaceTab = "overview" | "grid" | "table";
type PendingImportKind = DatasetSourceKind;
type AppView = "workspace" | "initial" | "logs";
export type ViewFilterMode = "all" | "unannotated" | "unsaved";
const highlightCellStateStorageKey = "datasets-deputy.highlight-cell-state";
const autoSaveAfterAnnotationStorageKey = "datasets-deputy.auto-save-after-annotation";

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
  tableAnnotationDrafts: Record<number, string>;
  tableInstructionDrafts: Record<number, string>;
  tableSavedCellKeys: string[];
  annotatingImageIds: number[];
  highlightCellState: boolean;
  autoSaveAfterAnnotation: boolean;
  activeProfileId?: number;
  isLoading: boolean;
  isCheckingProblemItems: boolean;
  lastImport?: ImportSummary;
  importPreview?: ImportPreview;
  importProgress?: ImportProgress;
  importReport?: ImportReport;
  exportPreview?: ExportPreview;
  exportProgress?: ExportProgress;
  pendingImportKind?: PendingImportKind;
  preparedImportKind?: Exclude<DatasetSourceKind, "folder">;
  showImportWizard: boolean;
  showExportDialog: boolean;
  annotationType: string;
  initImportEvents: () => Promise<void>;
  initExportEvents: () => Promise<void>;
  load: () => Promise<void>;
  refreshImages: () => Promise<void>;
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
  renameDatasetImage: (image: DatasetImage, name: string) => Promise<void>;
  deleteDatasetImage: (image: DatasetImage) => Promise<void>;
  openExportDialog: () => void;
  closeExportDialog: () => void;
  prepareExportDataset: (request: ExportDatasetRequest) => Promise<ExportPreview | undefined>;
  startExportDataset: (request: ExportDatasetRequest) => Promise<void>;
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
  setSearch: (search: string) => void;
  setViewFilter: (mode: ViewFilterMode, projectId?: string, imageIds?: number[]) => void;
  resetTableDrafts: (
    profileId: number,
    annotationDrafts: Record<number, string>,
    instructionDrafts: Record<number, string>
  ) => void;
  mergeTableDrafts: (
    annotationDrafts: Record<number, string>,
    instructionDrafts: Record<number, string>
  ) => void;
  applyGeneratedAnnotationDraft: (
    profileId: number,
    imageId: number,
    content: string
  ) => void;
  updateTableAnnotationDraft: (imageId: number, value: string) => void;
  updateTableInstructionDraft: (imageId: number, value: string) => void;
  markTableCellSaved: (key: string) => void;
  clearTableSavedCellMarks: () => void;
  setHighlightCellState: (enabled: boolean) => void;
  setAutoSaveAfterAnnotation: (enabled: boolean) => void;
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

function getStoredHighlightCellState() {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(highlightCellStateStorageKey) !== "false";
}

function getStoredAutoSaveAfterAnnotation() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(autoSaveAfterAnnotationStorageKey) === "true";
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
    throw new Error("保存标注需要先选择标注类型。");
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
  tableSavedCellKeys: [],
  annotatingImageIds: [],
  highlightCellState: getStoredHighlightCellState(),
  autoSaveAfterAnnotation: getStoredAutoSaveAfterAnnotation(),
  activeProfileId: sampleProfiles[0]?.id,
  isLoading: false,
  isCheckingProblemItems: false,
  annotationType: "",
  importPreview: undefined,
  importProgress: undefined,
  importReport: undefined,
  exportPreview: undefined,
  exportProgress: undefined,
  pendingImportKind: undefined,
  preparedImportKind: undefined,
  showImportWizard: false,
  showExportDialog: false,
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
          `导入完成：已导入 ${progress.imported}，已跳过 ${progress.skipped}，失败 ${progress.failed}。`
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
            `导出失败：${progress.error ?? "未知错误"}`,
            "error"
          );
        } else {
          get().addAppLog(
            `导出完成：已导出 ${progress.exported} 张图片，失败 ${progress.failed}。`
          );
        }
      }
    });
  },
  load: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({ isLoading: true });
    get().addAppLog("正在刷新数据集状态。");
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
      get().addAppLog(`刷新完成：已加载 ${images.length} 张图片和 ${profiles.length} 个标注类型。`);
    } finally {
      set({ isLoading: false });
    }
  },
  refreshImages: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

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
    get().addAppLog(`开始检查问题条目：${project.name}`);
    try {
      const summary = await invokeCommand<ProblemItemCheckSummary>("check_problem_items", {
        datasetId: project.datasetId,
        imageIds: project.imageIds
      });
      await get().refreshImages();
      get().addAppLog(
        `问题条目检查完成：检查 ${summary.checked} 项，更新 ${summary.updated} 项，缺失 ${summary.missing} 项，失败 ${summary.failed} 项。`
      );
      return summary;
    } catch (error) {
      get().addAppLog(`问题条目检查失败：${formatAppError(error)}`, "error");
      throw error;
    } finally {
      set({ isCheckingProblemItems: false });
    }
  },
  openImportWizard: () =>
    {
      get().addAppLog("已打开导入向导。");
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
    get().addAppLog("已关闭导入向导。");
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
    get().addAppLog("开始准备资产数据库导入。");
    try {
      const preview = await invokeCommand<ImportPreview>("prepare_import_folder");
      get().addAppLog(
        `资产数据库导入预览完成：找到 ${preview.imageCount} 张图片，其中 ${preview.annotatedImageCount} 张已有标注。`
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
        get().addAppLog(`资产数据库导入准备失败：${formatAppError(error)}`, "error");
        throw error;
      }
      get().addAppLog("用户已取消资产数据库导入准备。", "warning");
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
    get().addAppLog("开始准备动态链接数据库导入。");
    try {
      const preview = await invokeCommand<ImportPreview>("prepare_import_folder");
      get().addAppLog(
        `动态链接数据库导入预览完成：找到 ${preview.imageCount} 张图片，其中 ${preview.annotatedImageCount} 张已有标注。`
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
        get().addAppLog(`动态链接数据库导入准备失败：${formatAppError(error)}`, "error");
        throw error;
      }
      get().addAppLog("用户已取消动态链接数据库导入准备。", "warning");
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
    get().addAppLog("开始挂载工作文件夹。");
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
          currentPath: "正在扫描工作文件夹...",
          done: false
        }
      });
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      const projects = createProjectTree(images);
      const firstFolder = projects.find((project) => project.sourceKind === "folder");
      get().addAppLog(`工作文件夹挂载完成：已加载 ${images.length} 张图片。`);
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
        get().addAppLog(`工作文件夹挂载失败：${formatAppError(error)}`, "error");
        throw error;
      }
      get().addAppLog("用户已取消工作文件夹挂载。", "warning");
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
      `开始执行已准备的${importMode === "asset" ? "资产数据库" : "动态链接数据库"}导入：${preview.folderPath}`
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
      get().addAppLog(`已准备的导入失败：${formatAppError(error)}`, "error");
      throw error;
    }
  },
  browseImportedDataset: async () => {
    const report = get().importReport;
    if (!hasTauriRuntime() || !report) {
      return;
    }

    set({ isLoading: true });
    get().addAppLog("正在打开已导入的数据集。");
    try {
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      const projects = createProjectTree(images, report.rootName, report.rootPath);
      const selectedProject = projects.find(
        (project) => report.rootPath && normalizePath(project.path) === normalizePath(report.rootPath)
      );
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
      get().addAppLog(`已打开导入数据集：加载 ${images.length} 张图片。`);
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
          sourceKind: getProjectSourceKind(project)
        });
      }
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
        newName: trimmedName
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
        path: renamePathPrefix(image.path, project.path, newPath)
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
        name: trimmedName
      });
      get().addAppLog(`已创建子文件夹：${trimmedName}`);
      await get().refreshImages();
      return;
    }
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
    const nextPath = replacePathFileName(image.path, nextFileName);

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
      const profiles = await invokeCommand<AnnotationProfile[]>("list_annotation_profiles");
      set({ profiles });
      await get().refreshImages();
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
    get().addAppLog("已打开导出设置。");
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
      get().addAppLog("当前环境无法执行真实导出。", "warning");
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
    get().addAppLog("开始导出数据集。");

    try {
      await invokeCommand<void>("start_export_dataset", { request });
    } catch (error) {
      set({ isLoading: false, exportProgress: undefined });
      get().addAppLog(`导出启动失败：${formatAppError(error)}`, "error");
      throw error;
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
      const activeProfileId = project?.datasetId
        ? state.profiles.find((profile) => profile.datasetId === project.datasetId)?.id ??
          state.activeProfileId
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
  setSearch: (search) => set({ search }),
  setViewFilter: (mode, projectId, imageIds = []) =>
    set({
      viewFilterMode: mode,
      viewFilterProjectId: mode === "all" ? undefined : projectId,
      viewFilterImageIds: mode === "all" ? [] : imageIds
    }),
  resetTableDrafts: (profileId, annotationDrafts, instructionDrafts) =>
    set({
      tableDraftProfileId: profileId,
      tableAnnotationDrafts: annotationDrafts,
      tableInstructionDrafts: instructionDrafts,
      tableSavedCellKeys: []
    }),
  mergeTableDrafts: (annotationDrafts, instructionDrafts) =>
    set((state) => {
      const imageIds = new Set(state.images.map((image) => image.id));
      const currentAnnotationDrafts = Object.fromEntries(
        Object.entries(state.tableAnnotationDrafts)
          .map(([imageId, value]) => [Number(imageId), value] as const)
          .filter(([imageId]) => imageIds.has(imageId))
      );
      const currentInstructionDrafts = Object.fromEntries(
        Object.entries(state.tableInstructionDrafts)
          .map(([imageId, value]) => [Number(imageId), value] as const)
          .filter(([imageId]) => imageIds.has(imageId))
      );

      return {
        tableAnnotationDrafts: {
          ...annotationDrafts,
          ...currentAnnotationDrafts
        },
        tableInstructionDrafts: {
          ...instructionDrafts,
          ...currentInstructionDrafts
        },
        tableSavedCellKeys: state.tableSavedCellKeys.filter((key) => {
          const imageId = Number(key.split(":")[0]);
          return imageIds.has(imageId);
        })
      };
    }),
  applyGeneratedAnnotationDraft: (profileId, imageId, content) =>
    set((state) => {
      const annotationDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableAnnotationDrafts
          : Object.fromEntries(
              state.images.map((image) => [
                image.id,
                getAnnotationContentForProfile(image, profileId)
              ])
            );
      const instructionDrafts =
        state.tableDraftProfileId === profileId
          ? state.tableInstructionDrafts
          : Object.fromEntries(
              state.images.map((image) => [
                image.id,
                getInstructionForProfile(image, profileId)
              ])
            );

      return {
        tableDraftProfileId: profileId,
        tableAnnotationDrafts: {
          ...annotationDrafts,
          [imageId]: content
        },
        tableInstructionDrafts: instructionDrafts,
        tableSavedCellKeys: state.tableSavedCellKeys.filter(
          (key) => key !== `${imageId}:annotation`
        )
      };
    }),
  updateTableAnnotationDraft: (imageId, value) =>
    set((state) => ({
      tableAnnotationDrafts: {
        ...state.tableAnnotationDrafts,
        [imageId]: value
      },
      tableSavedCellKeys: state.tableSavedCellKeys.filter(
        (key) => key !== `${imageId}:annotation`
      )
    })),
  updateTableInstructionDraft: (imageId, value) =>
    set((state) => ({
      tableInstructionDrafts: {
        ...state.tableInstructionDrafts,
        [imageId]: value
      },
      tableSavedCellKeys: state.tableSavedCellKeys.filter(
        (key) => key !== `${imageId}:instruction`
      )
    })),
  markTableCellSaved: (key) =>
    set((state) => ({
      tableSavedCellKeys: state.tableSavedCellKeys.includes(key)
        ? state.tableSavedCellKeys
        : [...state.tableSavedCellKeys, key]
    })),
  clearTableSavedCellMarks: () => set({ tableSavedCellKeys: [] }),
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

      for (const change of folderChanges) {
        const image = imageById.get(change.imageId);
        if (!image) continue;

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
      throw new Error("标注类型名称已存在。");
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
