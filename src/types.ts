export interface AnnotationProfile {
  id: number;
  name: string;
  sourceKind?: DatasetSourceKind;
  datasetId?: string;
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

export interface AnnotationChange {
  imageId: number;
  profileId: number;
  content?: string;
  instruction?: string;
}

export interface DatasetImage {
  id: number;
  path: string;
  fileName: string;
  storagePath?: string;
  thumbnailPath?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  fileHash?: string;
  sourceMissing?: boolean;
  importedAt: string;
  updatedAt: string;
  annotations: Annotation[];
  sourceKind?: DatasetSourceKind;
  datasetId?: string;
  rootPath?: string;
}

export type DatasetSourceKind = "asset" | "database" | "folder";

export interface DatasetProject {
  id: string;
  name: string;
  path: string;
  imageIds: number[];
  children?: DatasetProject[];
  sourceKind?: DatasetSourceKind;
  datasetId?: string;
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

export interface ImportWarning {
  filePath: string;
  message: string;
}

export interface ImportReport {
  rootName?: string;
  rootPath?: string;
  successWithoutAnnotations: number;
  successWithAnnotations: number;
  failed: number;
  failures: ImportFailure[];
  warnings: ImportWarning[];
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

export interface FolderImageImportPreview {
  targetFolderPath: string;
  imagePaths: string[];
  imageCount: number;
  annotationCount: number;
  instructionCount: number;
}

export interface FolderImageImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  annotationCount: number;
  instructionCount: number;
}

export interface ProblemItemCheckSummary {
  checked: number;
  updated: number;
  missing: number;
  failed: number;
}

export interface ExportPreview {
  outputDir: string;
  estimatedSizeBytes: number;
  imageCount: number;
  annotationCount: number;
}

export interface ExportProgress {
  phase: "exporting" | "done" | "failed";
  processed: number;
  total: number;
  exported: number;
  failed: number;
  currentPath?: string;
  outputDir?: string;
  estimatedSizeBytes: number;
  writtenSizeBytes: number;
  done: boolean;
  error?: string;
}

export interface ExportDatasetRequest {
  outputDir: string;
  datasetId: string;
  imageIds: number[];
  profileId?: number;
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
