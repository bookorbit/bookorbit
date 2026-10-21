import type { Ref } from 'vue'
import type { Annotation } from './useAnnotations'

interface RefreshableAnnotations {
  annotations: Ref<Annotation[]>
  loadError: Ref<string | null>
  load: (bookId: number, readerFileId?: number) => Promise<void>
}

interface RefreshableBookmarks {
  load: (bookId: number, readerFileId?: number) => Promise<void>
}

interface ReaderMarksRefreshOptions {
  bookId: number
  fileId: number
  annotations: RefreshableAnnotations
  bookmarks: RefreshableBookmarks
  /** False until the first load has drawn the marks, and while a save is on its way. */
  canRefresh: () => boolean
  addAnnotation: (cfi: string, color: string, style: string) => void
  redrawAnnotation: (cfi: string, color: string, style: string) => void
  deleteAnnotation: (cfi: string) => void
}

const REFRESH_INTERVAL_MS = 15_000

type Drawn = Map<string, { color: string; style: string }>

function drawn(annotations: Annotation[]): Drawn {
  const map: Drawn = new Map()
  for (const annotation of annotations) {
    if (annotation.cfi) map.set(annotation.cfi, { color: annotation.color, style: annotation.style })
  }
  return map
}

/**
 * Brings in highlights and bookmarks changed on other devices while the book stayed open, when the
 * reader comes back to it, and redraws only what changed.
 */
export function useReaderMarksRefresh(options: ReaderMarksRefreshOptions) {
  let lastRefreshAt = 0
  let running = false

  async function refreshMarks(now = Date.now()) {
    if (running || !options.canRefresh() || now - lastRefreshAt < REFRESH_INTERVAL_MS) return
    running = true
    lastRefreshAt = now
    try {
      const before = drawn(options.annotations.annotations.value)
      await Promise.all([options.annotations.load(options.bookId, options.fileId), options.bookmarks.load(options.bookId, options.fileId)])
      if (options.annotations.loadError.value) return
      const after = drawn(options.annotations.annotations.value)
      for (const cfi of before.keys()) {
        if (!after.has(cfi)) options.deleteAnnotation(cfi)
      }
      for (const [cfi, mark] of after) {
        const previous = before.get(cfi)
        if (!previous) options.addAnnotation(cfi, mark.color, mark.style)
        else if (previous.color !== mark.color || previous.style !== mark.style) options.redrawAnnotation(cfi, mark.color, mark.style)
      }
    } finally {
      running = false
    }
  }

  return { refreshMarks }
}
