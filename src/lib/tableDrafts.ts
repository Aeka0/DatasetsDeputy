import type { AnnotationChange, DatasetImage } from "../types";

export type TableDraftMap = Record<number, string>;
export type TableDraftProfileMaps = Record<number, TableDraftMap>;
export type TableDraftField = "annotation" | "instruction";

export interface UnsavedTableDraftItem {
  imageId: number;
  profileId: number;
  fileName: string;
  path: string;
  fields: TableDraftField[];
}

export interface UnsavedTableDraftState {
  changes: AnnotationChange[];
  items: UnsavedTableDraftItem[];
  cellCount: number;
  profileCount: number;
  cellsByProfileId: Record<number, number>;
}

export interface TableDraftStateInput {
  images: DatasetImage[];
  tableDraftProfileId?: number;
  tableAnnotationDrafts: TableDraftMap;
  tableInstructionDrafts: TableDraftMap;
  tableProfileAnnotationDrafts: TableDraftProfileMaps;
  tableProfileInstructionDrafts: TableDraftProfileMaps;
}

function hasDraft(drafts: TableDraftMap, imageId: number) {
  return Object.prototype.hasOwnProperty.call(drafts, imageId);
}

function getAnnotationForProfile(image: DatasetImage, profileId: number) {
  return image.annotations.find((annotation) => annotation.profileId === profileId);
}

export function getTableDraftProfileMaps({
  tableDraftProfileId,
  tableAnnotationDrafts,
  tableInstructionDrafts,
  tableProfileAnnotationDrafts,
  tableProfileInstructionDrafts
}: Omit<TableDraftStateInput, "images">) {
  const annotationDraftsByProfile = { ...tableProfileAnnotationDrafts };
  const instructionDraftsByProfile = { ...tableProfileInstructionDrafts };

  if (tableDraftProfileId !== undefined) {
    annotationDraftsByProfile[tableDraftProfileId] = tableAnnotationDrafts;
    instructionDraftsByProfile[tableDraftProfileId] = tableInstructionDrafts;
  }

  return {
    annotationDraftsByProfile,
    instructionDraftsByProfile
  };
}

export function getUnsavedTableDraftState(input: TableDraftStateInput): UnsavedTableDraftState {
  const { images } = input;
  const { annotationDraftsByProfile, instructionDraftsByProfile } =
    getTableDraftProfileMaps(input);
  const profileIds = new Set<number>([
    ...Object.keys(annotationDraftsByProfile).map(Number),
    ...Object.keys(instructionDraftsByProfile).map(Number)
  ]);
  const changes: AnnotationChange[] = [];
  const items: UnsavedTableDraftItem[] = [];
  const cellsByProfileId: Record<number, number> = {};
  let cellCount = 0;

  for (const profileId of profileIds) {
    if (!Number.isFinite(profileId)) continue;

    const annotationDrafts = annotationDraftsByProfile[profileId] ?? {};
    const instructionDrafts = instructionDraftsByProfile[profileId] ?? {};

    for (const image of images) {
      const annotation = getAnnotationForProfile(image, profileId);
      const hasContentDraft = hasDraft(annotationDrafts, image.id);
      const hasInstructionDraft = hasDraft(instructionDrafts, image.id);
      const contentDraft = hasContentDraft ? annotationDrafts[image.id] ?? "" : "";
      const instructionDraft = hasInstructionDraft ? instructionDrafts[image.id] ?? "" : "";
      const contentChanged = hasContentDraft && contentDraft !== (annotation?.content ?? "");
      const instructionChanged =
        hasInstructionDraft && instructionDraft !== (annotation?.instruction ?? "");

      if (!contentChanged && !instructionChanged) continue;

      const change: AnnotationChange = {
        imageId: image.id,
        profileId
      };
      const fields: TableDraftField[] = [];

      if (contentChanged) {
        change.content = contentDraft;
        fields.push("annotation");
      }
      if (instructionChanged) {
        change.instruction = instructionDraft;
        fields.push("instruction");
      }

      const itemCellCount = fields.length;
      cellsByProfileId[profileId] = (cellsByProfileId[profileId] ?? 0) + itemCellCount;
      cellCount += itemCellCount;
      changes.push(change);
      items.push({
        imageId: image.id,
        profileId,
        fileName: image.fileName,
        path: image.path,
        fields
      });
    }
  }

  return {
    changes,
    items,
    cellCount,
    profileCount: Object.keys(cellsByProfileId).length,
    cellsByProfileId
  };
}
