import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import i18next from "i18next";
import { create } from "zustand";

import { hasTauriRuntime, invokeCommand } from "../lib/tauri";
import type {
  AnnotationProfile,
  DatasetImage,
  DatasetProject,
  ExportPreset,
  ImportPreview,
  ImportProgress,
  ImportReport,
  ImportSummary
} from "../types";

const now = new Date().toISOString();

const sampleProfiles: AnnotationProfile[] = [
  {
    id: 1,
    name: "Sample imported annotation",
    formatType: "structured",
    sourceType: "imported",
    description: "Sample annotation type created during import",
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
    const groupRootPath = sourceKind === "folder" ? imageRoot : rootPath;
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

    const root: DatasetProject = {
      id: sourceKind === "folder" ? `folder-root:${groupKey}` : `dataset-root:${groupKey}`,
      name: groupMatchesImportRoot && groupRootName
        ? groupRootName
        : getPathName(normalizedRoot, sourceKind === "folder" ? "Folder" : "Dataset"),
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

interface DatasetState {
  images: DatasetImage[];
  projects: DatasetProject[];
  profiles: AnnotationProfile[];
  presets: ExportPreset[];
  workspaceTab: WorkspaceTab;
  selectedProjectId?: string;
  selectedImageId?: number;
  search: string;
  tableDraftProfileId?: number;
  tableAnnotationDrafts: Record<number, string>;
  tableInstructionDrafts: Record<number, string>;
  tableSavedCellKeys: string[];
  activeProfileId?: number;
  isLoading: boolean;
  lastImport?: ImportSummary;
  importPreview?: ImportPreview;
  importProgress?: ImportProgress;
  importReport?: ImportReport;
  showImportWizard: boolean;
  annotationType: string;
  initImportEvents: () => Promise<void>;
  load: () => Promise<void>;
  openImportWizard: () => void;
  closeImportWizard: () => void;
  importFolder: () => Promise<void>;
  mountFolder: () => Promise<void>;
  startPreparedImport: () => Promise<void>;
  browseImportedDataset: () => Promise<void>;
  setAnnotationType: (annotationType: string) => void;
  clearImportPreview: () => void;
  removeDataset: (project: DatasetProject) => Promise<void>;
  renameDatasetFolder: (project: DatasetProject, name: string) => Promise<void>;
  exportDataset: (format: "txt_per_image" | "jsonl") => Promise<void>;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  selectProject: (id?: string) => void;
  selectImage: (id?: number) => void;
  setSearch: (search: string) => void;
  resetTableDrafts: (
    profileId: number,
    annotationDrafts: Record<number, string>,
    instructionDrafts: Record<number, string>
  ) => void;
  mergeTableDrafts: (
    annotationDrafts: Record<number, string>,
    instructionDrafts: Record<number, string>
  ) => void;
  updateTableAnnotationDraft: (imageId: number, value: string) => void;
  updateTableInstructionDraft: (imageId: number, value: string) => void;
  markTableCellSaved: (key: string) => void;
  setActiveProfile: (id?: number) => void;
  saveAnnotation: (imageId: number, profileId: number, content: string) => Promise<void>;
  saveInstruction: (imageId: number, profileId: number, instruction: string) => Promise<void>;
  createAnnotationProfile: (name: string) => Promise<number | undefined>;
  clearAnnotation: (annotationId: number) => Promise<void>;
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
  workspaceTab: "overview",
  selectedProjectId: undefined,
  selectedImageId: undefined,
  search: "",
  tableDraftProfileId: undefined,
  tableAnnotationDrafts: {},
  tableInstructionDrafts: {},
  tableSavedCellKeys: [],
  activeProfileId: sampleProfiles[0]?.id,
  isLoading: false,
  annotationType: "",
  importPreview: undefined,
  importProgress: undefined,
  importReport: undefined,
  showImportWizard: false,
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
        set({
          importReport: progress.report,
          importProgress: undefined,
          showImportWizard: false,
          selectedProjectId: undefined,
          selectedImageId: undefined
        });
      }
    });
  },
  load: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({ isLoading: true });
    try {
      const [images, profiles] = await Promise.all([
        invokeCommand<DatasetImage[]>("list_images"),
        invokeCommand<AnnotationProfile[]>("list_annotation_profiles")
      ]);
      set({
        images,
        profiles,
        projects: createProjectTree(images),
        selectedProjectId: undefined,
        selectedImageId: undefined,
        activeProfileId: profiles[0]?.id
      });
    } finally {
      set({ isLoading: false });
    }
  },
  openImportWizard: () =>
    set({
      showImportWizard: true,
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined,
      selectedProjectId: undefined,
      selectedImageId: undefined
    }),
  closeImportWizard: () => set({ showImportWizard: false }),
  importFolder: async () => {
    if (!hasTauriRuntime()) {
      return;
    }

    set({
      isLoading: true,
      importPreview: undefined,
      importProgress: undefined,
      importReport: undefined
    });
    try {
      const preview = await invokeCommand<ImportPreview>("prepare_import_folder");
      set({
        importPreview: preview,
        showImportWizard: false,
        annotationType: preview.annotatedImageCount > 0 ? get().annotationType : "",
        selectedProjectId: undefined,
        selectedImageId: undefined
      });
    } catch (error) {
      const payload = error as { code?: string };
      if (payload.code !== "dialog_cancelled") {
        throw error;
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
      importReport: undefined
    });
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
      set({
        images,
        profiles,
        projects,
        showImportWizard: false,
        importProgress: undefined,
        selectedProjectId: firstFolder?.id,
        selectedImageId: undefined,
        activeProfileId: firstFolder?.datasetId
          ? profiles.find((profile) => profile.datasetId === firstFolder.datasetId)?.id
          : profiles[0]?.id
      });
    } catch (error) {
      const payload = error as { code?: string };
      set({ importProgress: undefined });
      if (payload.code !== "dialog_cancelled") {
        throw error;
      }
    } finally {
      set({ isLoading: false, importProgress: undefined });
    }
  },
  startPreparedImport: async () => {
    const preview = get().importPreview;
    if (!hasTauriRuntime() || !preview) {
      return;
    }

    await get().initImportEvents();
    set({
      isLoading: true,
      importPreview: undefined,
      importReport: undefined,
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
        annotationType: get().annotationType.trim() || undefined
      });
    } catch (error) {
      set({ isLoading: false, importProgress: undefined });
      throw error;
    }
  },
  browseImportedDataset: async () => {
    const report = get().importReport;
    if (!hasTauriRuntime() || !report) {
      return;
    }

    set({ isLoading: true });
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
        selectedProjectId: selectedProject?.id,
        selectedImageId: undefined,
        activeProfileId,
        importReport: undefined
      });
    } finally {
      set({ isLoading: false });
    }
  },
  setAnnotationType: (annotationType) => set({ annotationType }),
  clearImportPreview: () => set({ importPreview: undefined, annotationType: "" }),
  removeDataset: async (project) => {
    if (hasTauriRuntime()) {
      if (getProjectSourceKind(project) === "folder") {
        await invokeCommand<number>("remove_folder_dataset", {
          folderPath: project.path
        });
      } else {
        await invokeCommand<number>("remove_dataset_folder", {
          folderPath: project.path
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
        selectedProjectId: undefined,
        selectedImageId: undefined,
        activeProfileId: profiles[0]?.id,
        importPreview: undefined,
        importProgress: undefined,
        importReport: undefined
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
      return {
        images,
        profiles,
        projects: createProjectTree(images),
        activeProfileId,
        selectedProjectId:
          state.selectedProjectId === project.id ? undefined : state.selectedProjectId,
        selectedImageId:
          state.selectedImageId && ids.has(state.selectedImageId)
            ? undefined
            : state.selectedImageId
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
  exportDataset: async (format) => {
    if (!hasTauriRuntime()) {
      return;
    }

    const outputDir = await open({
      directory: true,
      multiple: false,
      title: i18next.t("export.selectFolder")
    });

    if (!outputDir || Array.isArray(outputDir)) {
      return;
    }

    const profileIds = get().profiles.map((profile) => profile.id);
    await invokeCommand<number>("export_dataset", {
      request: {
        outputDir,
        format,
        profileIds
      }
    });
  },
  setWorkspaceTab: (tab) => set({ workspaceTab: tab }),
  selectProject: (id) =>
    set((state) => {
      const project = flattenProjects(state.projects).find((project) => project.id === id);
      const activeProfileId = project?.datasetId
        ? state.profiles.find((profile) => profile.datasetId === project.datasetId)?.id ??
          state.activeProfileId
        : state.activeProfileId;

      return { selectedProjectId: id, selectedImageId: undefined, activeProfileId };
    }),
  selectImage: (id) => set({ selectedImageId: id }),
  setSearch: (search) => set({ search }),
  resetTableDrafts: (profileId, annotationDrafts, instructionDrafts) =>
    set({
      tableDraftProfileId: profileId,
      tableAnnotationDrafts: annotationDrafts,
      tableInstructionDrafts: instructionDrafts,
      tableSavedCellKeys: []
    }),
  mergeTableDrafts: (annotationDrafts, instructionDrafts) =>
    set((state) => ({
      tableAnnotationDrafts: {
        ...annotationDrafts,
        ...state.tableAnnotationDrafts
      },
      tableInstructionDrafts: {
        ...instructionDrafts,
        ...state.tableInstructionDrafts
      }
    })),
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
  setActiveProfile: (id) => set({ activeProfileId: id }),
  saveAnnotation: async (imageId, profileId, content) => {
    if (hasTauriRuntime()) {
      const image = get().images.find((image) => image.id === imageId);
      if (image?.sourceKind === "folder") {
        await invokeCommand("save_folder_annotation", {
          imagePath: image.path,
          content
        });
      } else {
        await invokeCommand("save_annotation", {
          imageId,
          profileId,
          content
        });
      }
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: state.selectedImageId,
        selectedProjectId: state.selectedProjectId
      }));
      return;
    }

    const updatedAt = new Date().toISOString();
    set((state) => ({
      images: state.images.map((image) => {
        if (image.id !== imageId) return image;

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
    if (hasTauriRuntime()) {
      const image = get().images.find((image) => image.id === imageId);
      if (image?.sourceKind === "folder") {
        await invokeCommand("save_folder_instruction", {
          imagePath: image.path,
          instruction
        });
      } else {
        await invokeCommand("save_instruction", {
          imageId,
          profileId,
          instruction
        });
      }
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: state.selectedImageId,
        selectedProjectId: state.selectedProjectId
      }));
      return;
    }

    const updatedAt = new Date().toISOString();
    set((state) => ({
      images: state.images.map((image) => {
        if (image.id !== imageId) return image;

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
        selectedProjectId: current.selectedProjectId
      }));
      return profileId;
    }

    const now = new Date().toISOString();
    const profileId = Date.now();
    const profile: AnnotationProfile = {
      id: profileId,
      name: trimmedName,
      formatType: "structured",
      sourceType: "manual",
      description: "Dataset-wide annotation",
      sourceKind: "database",
      datasetId: selectedProject?.datasetId
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
