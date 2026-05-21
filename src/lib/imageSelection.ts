import type { DatasetImage } from "../types";

export type ImageSelectionClickUpdate =
  | {
      type: "set";
      ids: number[];
      activeId: number;
      anchorId: number;
    }
  | {
      type: "toggle";
      id: number;
    };

export function getImageSelectionClickUpdate({
  images,
  imageId,
  selectedImageId,
  selectedImageIds,
  selectionAnchorImageId,
  shiftKey,
  additiveKey
}: {
  images: Pick<DatasetImage, "id">[];
  imageId: number;
  selectedImageId?: number;
  selectedImageIds: number[];
  selectionAnchorImageId?: number;
  shiftKey: boolean;
  additiveKey: boolean;
}): ImageSelectionClickUpdate {
  if (shiftKey) {
    const anchorId = selectionAnchorImageId ?? selectedImageId ?? imageId;
    const anchorIndex = images.findIndex((image) => image.id === anchorId);
    const targetIndex = images.findIndex((image) => image.id === imageId);

    if (anchorIndex === -1 || targetIndex === -1) {
      return { type: "set", ids: [imageId], activeId: imageId, anchorId: imageId };
    }

    const [startIndex, endIndex] =
      anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const rangeIds = images.slice(startIndex, endIndex + 1).map((image) => image.id);
    const ids = additiveKey ? Array.from(new Set([...selectedImageIds, ...rangeIds])) : rangeIds;

    return { type: "set", ids, activeId: imageId, anchorId };
  }

  if (additiveKey) {
    return { type: "toggle", id: imageId };
  }

  return { type: "set", ids: [imageId], activeId: imageId, anchorId: imageId };
}
