export interface HighlightSegment {
  text: string
  match: boolean
}

/** Splits text around every case-insensitive occurrence of the query, keeping the original casing. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim()
  if (!text || !needle) return [{ text, match: false }]
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lower = needle.toLocaleLowerCase()
  return text
    .split(new RegExp(`(${escaped})`, 'gi'))
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: part.toLocaleLowerCase() === lower }))
}
