import type { Annotation, DatasetImage } from "../types";

const trailingAnnotationSeparatorPattern = /([,，.;:!?。；：！？、])\s*$/;
const leadingAnnotationSeparatorPattern = /^\s*([,，.;:!?。；：！？、])\s*/;
const cjkCharacterPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

function formatAnnotationSeparator(separator: string) {
  return separator === "," || separator === "，"
    ? ", "
    : /[。；：！？、]/.test(separator)
      ? separator
      : `${separator} `;
}

function lastNonSpaceCharacter(value: string) {
  return value.trimEnd().at(-1) ?? "";
}

function getNaturalLanguageSeparator(value: string) {
  return cjkCharacterPattern.test(lastNonSpaceCharacter(value)) ? "。" : ". ";
}

function appendNaturalLanguagePrefixSeparator(value: string) {
  if (!value) return value;
  if (value.endsWith(". ") || value.endsWith("。")) return value;

  const trimmed = value.trimEnd();
  if (trimmed.endsWith(".")) return `${trimmed} `;
  if (trimmed.endsWith("。")) return trimmed;
  return `${trimmed}${getNaturalLanguageSeparator(trimmed)}`;
}

function appendNaturalLanguageSuffixSeparator(value: string) {
  if (!value) return value;
  if (value.endsWith(", ") || value.endsWith(". ") || value.endsWith("。")) return value;

  const trimmed = value.trimEnd();
  if (trimmed.endsWith(",") || trimmed.endsWith(".")) return `${trimmed} `;
  if (trimmed.endsWith("。")) return trimmed;
  return `${trimmed}${getNaturalLanguageSeparator(trimmed)}`;
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

export function joinNaturalLanguageAnnotationSegments(before: string, after: string) {
  if (!before) return after;
  if (!after) return before;
  return `${appendNaturalLanguageSuffixSeparator(before)}${after.trimStart()}`;
}

export function mergeNaturalLanguageAnnotation(
  existing: string,
  incoming: string,
  placement: "prefix" | "suffix"
) {
  return placement === "prefix"
    ? `${appendNaturalLanguagePrefixSeparator(incoming)}${existing.trimStart()}`
    : joinNaturalLanguageAnnotationSegments(existing, incoming);
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
