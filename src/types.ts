export type AnnotationFormat = "tags" | "caption" | "structured";

export type AnnotationSource = "manual" | "local_model" | "remote_api";

export interface AnnotationProfile {
  id: number;
  name: string;
  formatType: AnnotationFormat;
  sourceType: AnnotationSource;
  description?: string;
  modelInfo?: string;
}

export interface Annotation {
  id: number;
  imageId: number;
  profileId: number;
  content: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetImage {
  id: number;
  path: string;
  fileName: string;
  thumbnailPath?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  fileHash?: string;
  importedAt: string;
  updatedAt: string;
  tags: string[];
  caption: string;
  annotations: Annotation[];
}

export interface DatasetProject {
  id: string;
  name: string;
  path: string;
  imageIds: number[];
  children?: DatasetProject[];
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
}

export interface ImportPreview {
  folderPath: string;
  rootName: string;
  imageCount: number;
  imageFolderCount: number;
  annotatedImageCount: number;
}

export interface ImportProgress extends ImportSummary {
  phase: "scanning" | "importing" | "done" | "failed";
  processed: number;
  total: number;
  currentPath?: string;
  rootName?: string;
  rootPath?: string;
  done: boolean;
}

export interface ExportPreset {
  id: number;
  name: string;
  profileIds: number[];
  format: "txt_per_image" | "jsonl";
  filterRules?: Record<string, unknown>;
}

export interface AppErrorPayload {
  code: string;
  message: string;
  params?: Record<string, string | number | boolean>;
}
