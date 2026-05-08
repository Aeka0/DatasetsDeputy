import type { Annotation, DatasetImage } from "../types";

export function getAnnotationForProfile(
  image: DatasetImage,
  profileId: number
): Annotation | undefined {
  return image.annotations.find((annotation) => annotation.profileId === profileId);
}

export function getAnnotationText(image: DatasetImage, profileId: number): string {
  return getAnnotationForProfile(image, profileId)?.content ?? "";
}

export function getInstructionText(annotation: Annotation | undefined): string {
  return annotation?.instruction ?? "";
}
