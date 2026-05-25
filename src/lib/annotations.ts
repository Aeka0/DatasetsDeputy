import type { Annotation, DatasetImage } from "../types";

const trailingAnnotationSeparatorPattern = /([,，.;:!?。；：！？、])\s*$/;
const leadingAnnotationSeparatorPattern = /^\s*([,，.;:!?。；：！？、])\s*/;

function formatAnnotationSeparator(separator: string) {
  return separator === "," || separator === "，" ? ", " : `${separator} `;
}

export function joinAnnotationSegments(
  before: string,
  after: string,
  defaultSeparator = ", "
) {
  if (!before) return after;
  if (!after) return before;

  const trailingSeparator = before.match(trailingAnnotationSeparatorPattern);
  if (trailingSeparator) {
    const separator = trailingSeparator[1];
    const trimmedAfter =
      separator === "," || separator === "，"
        ? after.trimStart().replace(/^[,，]\s*/, "")
        : after.trimStart();
    return `${before.slice(0, -trailingSeparator[0].length)}${formatAnnotationSeparator(separator)}${trimmedAfter}`;
  }

  const leadingSeparator = after.match(leadingAnnotationSeparatorPattern);
  if (leadingSeparator) {
    return `${before.trimEnd()}${formatAnnotationSeparator(leadingSeparator[1])}${after.slice(leadingSeparator[0].length)}`;
  }

  return `${before.trimEnd()}${defaultSeparator}${after.trimStart()}`;
}

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
