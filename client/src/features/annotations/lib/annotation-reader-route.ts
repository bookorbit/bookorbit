import type { AnnotationHubItem } from '@bookorbit/types'
import type { RouteLocationRaw } from 'vue-router'

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
