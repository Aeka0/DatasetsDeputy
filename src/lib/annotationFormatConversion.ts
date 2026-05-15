import { cleanupAnnotationSeparators } from "./annotationNormalization";

export type QualityWordPlacement = "none" | "prefix" | "suffix";

const animaQualityWords = "masterpiece, best quality, score_7. ";

export function normalizeBooruTag(value: string) {
  return value.trim().replace(/ /g, "_").toLowerCase();
}

function isBoundaryCharacter(value: string | undefined) {
  return value === undefined || /[\s,.;:!?()[\]{}"'，。；：！？、]/.test(value);
}

function shouldKeepAtPrefix(content: string, index: number) {
  const following = content.slice(index).toLowerCase();
  const isTrailingAtInSpacedFace =
    index >= 2 &&
    content.slice(index - 2, index + 1) === "@ @" &&
    isBoundaryCharacter(index === 2 ? undefined : content[index - 3]);
  return (
    following.startsWith("@_@") ||
    following.startsWith("@ @") ||
    isTrailingAtInSpacedFace ||
    /^@[_ ]\((?:symbol)\)/.test(following)
  );
}

function removeAnimaAtPrefixes(content: string) {
  let result = "";

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (
      character === "@" &&
      isBoundaryCharacter(index === 0 ? undefined : content[index - 1]) &&
      !shouldKeepAtPrefix(content, index)
    ) {
      continue;
    }

    result += character;
  }

  return result;
}

function removeAnimaQualityWords(content: string) {
  return content
    .replace(/\bmasterpiece\b/gi, "")
    .replace(/\bbest[ _]quality\b/gi, "")
    .replace(/\bscore[ _][0-9]\b/gi, "");
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

export function convertAnimaToBooruTag(content: string) {
  const withoutAtPrefixes = removeAnimaAtPrefixes(content);
  const withoutQualityWords = removeAnimaQualityWords(withoutAtPrefixes);
  return cleanupAnnotationSeparators(withoutQualityWords);
}
