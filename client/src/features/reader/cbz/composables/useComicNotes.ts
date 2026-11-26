import { computed } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationItem } from '@bookorbit/types'
import { useFileAnnotations } from '../../shared/composables/useFileAnnotations'

/** An annotation in this file with the zero-based page it sits on. */
export interface ComicNote {
  annotation: AnnotationItem
  page: number
}

export interface ComicNoteMarker {
  page: number
  color: string
}

const COLOR_KEY = 'reader:cbz:noteColor'

/**
 * The zero-based page an annotation sits on: a page note's own page, or the page of a page-based
 * position, which is how KOReader reports anything it marks in a comic.
 */
export function comicNotePage(annotation: AnnotationItem): number | null {
  if (annotation.page) return annotation.page.page
  if (annotation.pdf) return annotation.pdf.page
  return annotation.pageno != null && annotation.pageno > 0 ? annotation.pageno - 1 : null
}

/** Notes on the pages of one comic or DjVu file, in page order. */
export function useComicNotes(bookId: number, fileId: number) {
  const store = useFileAnnotations(bookId, fileId)
  const lastColor = useLocalStorage(COLOR_KEY, ANNOTATION_HIGHLIGHT_COLORS[0].hex)

  const notes = computed<ComicNote[]>(() =>
    store.annotations.value
      .map((annotation) => ({ annotation, page: comicNotePage(annotation) }))
      .filter((note): note is ComicNote => note.page != null)
      .sort((a, b) => a.page - b.page || a.annotation.highlightedAt.localeCompare(b.annotation.highlightedAt) || a.annotation.id - b.annotation.id),
  )

  const notesByPage = computed(() => {
    const byPage = new Map<number, ComicNote[]>()
    for (const note of notes.value) {
      const list = byPage.get(note.page)
      if (list) list.push(note)
      else byPage.set(note.page, [note])
    }
    return byPage
  })

  const markers = computed<ComicNoteMarker[]>(() =>
    [...notesByPage.value].map(([page, list]) => ({ page, color: list[0]?.annotation.color ?? lastColor.value })),
  )

  function notesOn(pages: readonly number[]): ComicNote[] {
    return pages.flatMap((page) => notesByPage.value.get(page) ?? [])
  }

  function addNote(page: number, note: string, color: string) {
    lastColor.value = color
    return store.create({ page: { page }, bookFileId: fileId, text: '', color, style: 'highlight', note })
  }

  function editNote(id: number, note: string, color: string) {
    lastColor.value = color
    return store.update(id, { note, color })
  }

  return {
    notes,
    total: store.total,
    loading: store.loading,
    loadError: store.loadError,
    loadingMore: store.loadingMore,
    hasMore: store.hasMore,
    load: store.load,
    loadMore: store.loadMore,
    markers,
    lastColor,
    notesOn,
    addNote,
    editNote,
    removeNote: store.remove,
  }
}
