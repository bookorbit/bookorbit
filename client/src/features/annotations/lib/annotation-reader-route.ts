import type { AnnotationHubItem } from '@bookorbit/types'
import type { RouteLocationRaw } from 'vue-router'

/**
 * Builds the reader deep link for a hub annotation: it opens the annotation's jump
 * file and carries the position as a `cfi` query for reflowable formats or a `page`
 * query for paged formats (PDF). Returns null when the annotation has no resolvable
 * jump file to open.
 */
export function annotationReaderRoute(annotation: AnnotationHubItem): RouteLocationRaw | null {
  if (!annotation.jumpFileId || !annotation.jumpFileFormat) return null

  const query: Record<string, string> = { format: annotation.jumpFileFormat }
  if (annotation.cfi) query.cfi = annotation.cfi
  else if (annotation.pageno != null) query.page = String(annotation.pageno)

  return {
    name: 'reader',
    params: { bookId: annotation.bookId, fileId: annotation.jumpFileId },
    query,
  }
}
