const ELLIPSIS = '…'

/**
 * Keeps the tail of a path, which is the part that identifies the library, and marks the dropped
 * head with an ellipsis. Done here rather than with a `direction: rtl` CSS trick so the result is
 * the same in both locale directions; the full path stays available as a title.
 */
export function shortenPath(path: string, maxSegments = 2): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/'
  const segments = trimmed.split(/[/\\]+/).filter(Boolean)
  if (segments.length <= maxSegments) return trimmed
  return `${ELLIPSIS}${separator}${segments.slice(-maxSegments).join(separator)}`
}
