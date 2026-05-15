export interface AnnotationNormalizationOptions {
  lowercase: boolean;
  halfWidth: boolean;
  removeSpecial: boolean;
  underscoreToSpace: boolean;
  removeNewlines: boolean;
  removeJunk: boolean;
  removeNonAscii: boolean;
}

export const defaultAnnotationNormalizationOptions: AnnotationNormalizationOptions = {
  lowercase: true,
  halfWidth: true,
  removeSpecial: true,
  underscoreToSpace: true,
  removeNewlines: true,
  removeJunk: true,
  removeNonAscii: true
};

const emptyWeightRegex =
  /\[[\s_,，]*\]|\{[\s_,，]*\}|\([\s_,，]*\)|<[\s_,，]*>|(?:-?\d+\.?\d*)?::[\s_,，]*::/g;
const junkPhraseRegex =
  /\b(?:best quality|amazing quality|very aesthetic|absurdres)\b|\bartist:/gi;
const isolatedPunctuationRegex = /^[\s.,，。;；:：!?！？、]+$/;
const edgePunctuationRegex = /^[\s.,，。;；:：!?！？、]+|[\s.,，。;；:：!?！？、]+$/g;

function replaceWidth(text: string, halfWidth: boolean) {
  if (halfWidth) {
    return text
      .replace(/，/g, ",")
      .replace(/　/g, " ")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/、/g, ",");
  }

  return text.replace(/,/g, "，").replace(/\(/g, "（").replace(/\)/g, "）");
}

export function normalizeAnnotation(
  value: string,
  options: AnnotationNormalizationOptions = defaultAnnotationNormalizationOptions
) {
  if (!value) return "";

  let text = value;

  if (options.lowercase) {
    text = text.toLowerCase();
  }

  text = replaceWidth(text, options.halfWidth);

  if (options.removeSpecial) {
    text = text.replace(/[【】]/g, "");
  }

  if (options.underscoreToSpace) {
    text = text.replace(/_/g, " ");
  }

  if (options.removeNewlines) {
    text = text.replace(/\r\n/g, "\n").replace(/\n/g, ",");
  }

  if (options.removeJunk) {
    text = text.replace(junkPhraseRegex, "");
  }

  if (options.removeNonAscii) {
    text = Array.from(text).filter((char) => char.charCodeAt(0) <= 127).join("");
  }

  return cleanupAnnotationSeparators(text, options.halfWidth ? ", " : "，");
}

export function cleanupAnnotationSeparators(value: string, separator = ", ") {
  let text = value;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(emptyWeightRegex, "");
  }

  const seenTags = new Set<string>();
  const uniqueTags = text
    .replace(/，/g, ",")
    .split(",")
    .map((tag) => tag.trim().replace(edgePunctuationRegex, "").replace(/\//g, ""))
    .filter((tag) => {
      if (!tag || isolatedPunctuationRegex.test(tag) || seenTags.has(tag)) return false;
      seenTags.add(tag);
      return true;
    });

  return uniqueTags.join(separator);
}
