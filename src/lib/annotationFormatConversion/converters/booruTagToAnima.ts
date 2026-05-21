import type {
  AnnotationFormatConverter,
  QualityWordPlacement
} from "../types";
import { animaQualityWords } from "./animaQualityWords";

function normalizeBooruTag(value: string) {
  return value.trim().replace(/ /g, "_").toLowerCase();
}

export function convertBooruTagToAnima(
  content: string,
  styleTags: Set<string>,
  qualityWordPlacement: QualityWordPlacement
) {
  const withStylePrefixes = content
    .split(",")
    .map((segment) => {
      const tag = segment.trim();
      if (!tag || tag.startsWith("@") || !styleTags.has(normalizeBooruTag(tag))) {
        return segment;
      }

      const leadingWhitespace = segment.match(/^\s*/)?.[0] ?? "";
      const trailingWhitespace = segment.match(/\s*$/)?.[0] ?? "";
      return `${leadingWhitespace}@${tag}${trailingWhitespace}`;
    })
    .join(",");

  if (qualityWordPlacement === "prefix") {
    return `${animaQualityWords}${withStylePrefixes}`;
  }

  if (qualityWordPlacement === "suffix") {
    if (!withStylePrefixes) {
      return animaQualityWords;
    }

    const separator =
      withStylePrefixes.endsWith(", ") || withStylePrefixes.endsWith(". ") ? "" : ". ";
    return `${withStylePrefixes}${separator}${animaQualityWords}`;
  }

  return withStylePrefixes;
}

export const booruTagToAnimaConverter: AnnotationFormatConverter = {
  key: "booruTag->anima",
  prepare: async ({ loadDanbooruStyleTags }) => ({
    styleTags: await loadDanbooruStyleTags()
  }),
  convert: (content, options, context) =>
    convertBooruTagToAnima(
      content,
      context.styleTags ?? new Set<string>(),
      options.qualityWordPlacement
    )
};
