import type { ReactNode } from "react";

export function highlightSearch(text: string, query: string): ReactNode {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || !text) return text;

  const lowerText = text.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(trimmed);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <mark key={key++} className="search-highlight">
        {text.slice(matchIndex, matchIndex + trimmed.length)}
      </mark>
    );
    lastIndex = matchIndex + trimmed.length;
    matchIndex = lowerText.indexOf(trimmed, lastIndex);
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
