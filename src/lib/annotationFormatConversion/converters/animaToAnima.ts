import type { AnnotationFormatConverter, QualityWordPlacement } from "../types";
import { animaQualityWords, removeAnimaQualityWords } from "./animaQualityWords";

const edgeSeparatorRegex = /^[\s,.;:!?，。；：！？、]+|[\s,.;:!?，。；：！？、]+$/g;
const onlySeparatorRegex = /^[\s,.;:!?，。；：！？、]+$/;

function cleanupQualityWordGaps(content: string) {
  return content
    .replace(/，/g, ",")
    .split(",")
    .map((segment) => segment.trim().replace(edgeSeparatorRegex, ""))
    .filter((segment) => segment && !onlySeparatorRegex.test(segment))
    .join(", ");
}

export function convertAnimaToAnima(
  content: string,
  qualityWordPlacement: QualityWordPlacement
) {
  if (qualityWordPlacement === "keep") {
    return content;
  }

  const withoutQualityWords = cleanupQualityWordGaps(
    removeAnimaQualityWords(content)
  );

  if (qualityWordPlacement === "off") {
    return withoutQualityWords;
  }

  if (qualityWordPlacement === "prefix") {
    return `${animaQualityWords}${withoutQualityWords}`;
  }

  if (qualityWordPlacement === "suffix") {
    if (!withoutQualityWords) {
      return animaQualityWords;
    }

    const separator =
      withoutQualityWords.endsWith(", ") || withoutQualityWords.endsWith(". ")
        ? ""
        : ". ";
    return `${withoutQualityWords}${separator}${animaQualityWords}`;
  }

  return withoutQualityWords;
}

export const animaToAnimaConverter: AnnotationFormatConverter = {
  key: "anima->anima",
  convert: (content, options) =>
    convertAnimaToAnima(content, options.qualityWordPlacement)
};
