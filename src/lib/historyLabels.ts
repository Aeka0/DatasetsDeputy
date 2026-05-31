export interface HistoryLabel {
  key: string;
  fallback?: string;
  params?: Record<string, string | number | boolean>;
}

export type HistoryLabelValue = string | HistoryLabel;

const legacyHistoryLabelKeys: Record<string, string> = {
  "Batch add": "history.labels.batchAdd",
  "Batch replace": "history.labels.batchReplace",
  "Convert annotation format": "history.labels.convertAnnotationFormat",
  "Consolidate loose files": "history.labels.consolidateLooseFiles",
  "Create annotation type": "history.labels.createAnnotationType",
  "Create folder": "history.labels.createFolder",
  "Duplicate annotation type": "history.labels.duplicateAnnotationType",
  "Edit annotation draft": "history.labels.editAnnotationDraft",
  "Generate annotations": "history.labels.generateAnnotations",
  "Import database": "history.labels.importDatabase",
  "Import dataset": "history.labels.importDataset",
  "Mount folder": "history.labels.mountFolder",
  "Normalize annotations": "history.labels.normalizeAnnotations",
  "Rename annotation type": "history.labels.renameAnnotationType",
  "Rename folder": "history.labels.renameFolder",
  "Rename image": "history.labels.renameImage",
  "Rewrite annotations": "history.labels.rewriteAnnotations",
  "Save annotation": "history.labels.saveAnnotation",
  "Save annotation changes": "history.labels.saveAnnotationChanges"
};

export function historyLabel(
  key: string,
  fallback: string,
  params?: HistoryLabel["params"]
): HistoryLabel {
  return params ? { key, fallback, params } : { key, fallback };
}

export function translateHistoryLabel(
  label: HistoryLabelValue | undefined,
  translate: (key: string, options?: Record<string, string | number | boolean>) => string
) {
  if (!label) return "";

  if (typeof label === "string") {
    const key = legacyHistoryLabelKeys[label];
    if (!key) return label;
    const translated = translate(key);
    return translated === key ? label : translated;
  }

  const translated = translate(label.key, label.params);
  return translated === label.key ? label.fallback ?? label.key : translated;
}
