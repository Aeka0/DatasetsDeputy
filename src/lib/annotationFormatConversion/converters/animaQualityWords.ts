export const animaQualityWords =
  "masterpiece, best quality, score_7, score_8, score_9. ";

export function removeAnimaQualityWords(content: string) {
  return content
    .replace(/\bmasterpiece\b/gi, "")
    .replace(/\bbest[ _]quality\b/gi, "")
    .replace(/\bscore[ _][0-9]\b/gi, "");
}
