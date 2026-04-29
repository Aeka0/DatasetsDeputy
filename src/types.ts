export type AnnotationFormat = "tags" | "caption" | "structured";

export type AnnotationSource = "manual" | "imported" | "local_model" | "remote_api";

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
  instruction: string;
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

export interface ImportFailure {
  filePath: string;
  reason: string;
}

export interface ImportReport {
  rootName?: string;
  rootPath?: string;
  successWithoutAnnotations: number;
  successWithAnnotations: number;
  failed: number;
  failures: ImportFailure[];
}

export interface ImportProgress extends ImportSummary {
  phase: "scanning" | "importing" | "done" | "failed";
  processed: number;
  total: number;
  currentPath?: string;
  rootName?: string;
  rootPath?: string;
  done: boolean;
  report?: ImportReport;
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
