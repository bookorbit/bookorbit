import { onScopeDispose, type Ref } from 'vue'
import type { BookCard, BookMergedEvent } from '@bookorbit/types'
import { useBookEvents } from './useBookEvents'
import { useCoverVersions } from './useCoverVersions'

const REFRESH_DEBOUNCE_MS = 300

interface BookMergeSyncOptions {
  books: Ref<BookCard[]>
  /** Drops merged-away ids from the selection. */
  deselect: (ids: number[]) => void
  /** Reloads the listing so the kept book's card shows its merged formats and details. */
  refresh: () => void
  /**
   * Whether a merge outside the loaded cards still concerns this listing, such as one that moved the
   * kept book into the library on screen or took books out of it from a block not loaded yet.
   */
  affectsScope?: (event: BookMergedEvent) => boolean
}

/**
 * Keeps a loaded book listing in step with merges: merged-away cards leave at once, the kept card
 * is reloaded shortly after. Merges by anyone arrive as `book:merged` in every library they touched;
 * the user's own sheet calls `applyMerged` too, so a merge finished over the polling fallback updates
 * the grid.
 */
export function useBookMergeSync({ books, deselect, refresh, affectsScope }: BookMergeSyncOptions) {
  const { bumpVersion } = useCoverVersions()
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  function applyMerged(event: BookMergedEvent): void {
    const sources = new Set(event.sourceBookIds)
    const touched = books.value.some((book) => sources.has(book.id) || book.id === event.targetBookId)
    deselect(event.sourceBookIds)
    if (!touched && affectsScope?.(event) !== true) return
    if (touched) {
      books.value = books.value.filter((book) => !sources.has(book.id))
      // The kept book can take over another book's cover, so its cached image is stale.
      bumpVersion(event.targetBookId)
    }
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  useBookEvents().onBookMerged(applyMerged)

  onScopeDispose(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  return { applyMerged }
}
