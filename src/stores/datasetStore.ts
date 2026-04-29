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

const defaultProfiles: AnnotationProfile[] = [
  {
    id: 1,
    name: "Manual tags",
    formatType: "tags",
    sourceType: "manual",
    description: "Human curated keyword tags"
  },
  {
    id: 2,
    name: "Manual caption",
    formatType: "caption",
    sourceType: "manual",
    description: "Human written training caption"
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
    tags: ["landscape", "night", "aurora"],
    caption: "A wide cinematic field under green aurora lights.",
    annotations: []
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
    tags: ["portrait", "studio", "soft light"],
    caption: "A clean studio portrait with soft rim lighting.",
    annotations: []
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
    tags: ["product", "glass", "minimal"],
    caption: "A minimal glass product render on a dark reflective surface.",
    annotations: []
  }
];

const sampleProjects: DatasetProject[] = [
  {
    id: "sample",
    name: "Sample Dataset",
    path: "datasets/sample",
    imageIds: [1, 2, 3],
    children: [
      {
        id: "sample-training",
        name: "training",
        path: "datasets/sample/training",
        imageIds: [1, 2]
      },
      {
        id: "sample-reference",
        name: "reference",
        path: "datasets/sample/reference",
        imageIds: [3]
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

function createProjectTree(images: DatasetImage[], rootName?: string, rootPath?: string): DatasetProject[] {
  if (images.length === 0) return [];

  const normalizedRoot = normalizePath(rootPath || getCommonDirectory(images));
  const root: DatasetProject = {
    id: "dataset-root",
    name: rootName || getPathName(normalizedRoot, "Dataset"),
    path: normalizedRoot,
    imageIds: images.map((image) => image.id),
    children: []
  };

  const ensureChild = (parent: DatasetProject, name: string, path: string) => {
    parent.children ??= [];
    let child = parent.children.find((item) => item.path === path);
    if (!child) {
      child = {
        id: `folder:${path}`,
        name,
        path,
        imageIds: [],
        children: []
      };
      parent.children.push(child);
    }
    return child;
  };

  for (const image of images) {
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

  return [pruneEmptyChildren(root)];
}

function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
}

interface DatasetState {
  images: DatasetImage[];
  projects: DatasetProject[];
  profiles: AnnotationProfile[];
  presets: ExportPreset[];
  selectedProjectId?: string;
  selectedImageId?: number;
  search: string;
  activeProfileId?: number;
  isLoading: boolean;
  lastImport?: ImportSummary;
  importPreview?: ImportPreview;
  importProgress?: ImportProgress;
  importReport?: ImportReport;
  annotationType: string;
  initImportEvents: () => Promise<void>;
  load: () => Promise<void>;
  importFolder: () => Promise<void>;
  startPreparedImport: () => Promise<void>;
  browseImportedDataset: () => Promise<void>;
  setAnnotationType: (annotationType: string) => void;
  clearImportPreview: () => void;
  removeDataset: (project: DatasetProject) => Promise<void>;
  exportDataset: (format: "txt_per_image" | "jsonl") => Promise<void>;
  selectProject: (id?: string) => void;
  selectImage: (id?: number) => void;
  setSearch: (search: string) => void;
  setActiveProfile: (id?: number) => void;
  saveAnnotation: (imageId: number, profileId: number, content: string) => Promise<void>;
  createAnnotationProfile: (name: string) => Promise<number | undefined>;
  clearAnnotation: (annotationId: number) => Promise<void>;
  updateManualAnnotations: (imageId: number, tags: string[], caption: string) => Promise<void>;
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
  images: sampleImages,
  projects: sampleProjects,
  profiles: defaultProfiles,
  presets: [
    {
      id: 1,
      name: "export.presetSd",
      profileIds: [1, 2],
      format: "txt_per_image"
    },
    {
      id: 2,
      name: "export.presetJsonl",
      profileIds: [1, 2],
      format: "jsonl"
    }
  ],
  selectedProjectId: undefined,
  selectedImageId: undefined,
  search: "",
  activeProfileId: 1,
  isLoading: false,
  annotationType: "",
  importPreview: undefined,
  importProgress: undefined,
  importReport: undefined,
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
      set({
        images,
        profiles,
        projects: createProjectTree(images, report.rootName, report.rootPath),
        selectedProjectId: images.length > 0 ? "dataset-root" : undefined,
        selectedImageId: undefined,
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
      await invokeCommand<number>("remove_dataset_folder", {
        folderPath: project.path
      });
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set({
        images,
        projects: createProjectTree(images),
        selectedProjectId: undefined,
        selectedImageId: undefined,
        importPreview: undefined,
        importProgress: undefined,
        importReport: undefined
      });
      return;
    }

    const ids = new Set(project.imageIds);
    set((state) => {
      const images = state.images.filter((image) => !ids.has(image.id));
      return {
        images,
        projects: createProjectTree(images),
        selectedProjectId:
          state.selectedProjectId === project.id ? undefined : state.selectedProjectId,
        selectedImageId:
          state.selectedImageId && ids.has(state.selectedImageId)
            ? undefined
            : state.selectedImageId
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
  selectProject: (id) => set({ selectedProjectId: id, selectedImageId: undefined }),
  selectImage: (id) => set({ selectedImageId: id }),
  setSearch: (search) => set({ search }),
  setActiveProfile: (id) => set({ activeProfileId: id }),
  saveAnnotation: async (imageId, profileId, content) => {
    if (hasTauriRuntime()) {
      await invokeCommand("save_annotation", {
        imageId,
        profileId,
        content
      });
      const images = await invokeCommand<DatasetImage[]>("list_images");
      set((state) => ({
        images,
        projects: createProjectTree(images),
        selectedImageId: imageId,
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
    const rootProject = state.projects[0];
    const imageIds = rootProject?.imageIds.length
      ? rootProject.imageIds
      : state.images.map((image) => image.id);

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
      formatType: "tags",
      sourceType: "manual",
      description: "Dataset-wide annotation"
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
      await invokeCommand("clear_annotation", { annotationId });
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
  },
  updateManualAnnotations: async (imageId, tags, caption) => {
    const updatedAt = new Date().toISOString();

    set((state) => ({
      images: state.images.map((image) =>
        image.id === imageId
          ? {
              ...image,
              tags,
              caption,
              updatedAt
            }
          : image
      )
    }));

    if (hasTauriRuntime()) {
      await invokeCommand("save_manual_annotations", {
        imageId,
        tags,
        caption
      });
      await get().load();
    }
  }
}));
