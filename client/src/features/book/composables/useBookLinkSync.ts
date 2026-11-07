import { onScopeDispose, type Ref } from 'vue'
import type { BookCard, BookLinksChangedEvent } from '@bookorbit/types'
import { useBookEvents } from './useBookEvents'

const REFRESH_DEBOUNCE_MS = 300

interface BookLinkSyncOptions {
  books: Ref<BookCard[]>
  /** Reloads the listing: a link can fold two cards into one, or split one back into two. */
  refresh: () => void
  /**
   * Whether a change outside the loaded cards still concerns this listing, such as a link in the
   * library on screen whose books sit in a block not loaded yet.
   */
  affectsScope?: (event: BookLinksChangedEvent) => boolean
}

/**
 * Keeps a loaded book listing in step with links made or removed anywhere: the badges, the
 * collapsed cards and the counts all come from the server, so a relevant change reloads the
 * listing shortly after. Several libraries' events for one change arrive together and coalesce.
 */
export function useBookLinkSync({ books, refresh, affectsScope }: BookLinkSyncOptions) {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  function touchesLoadedCards(event: BookLinksChangedEvent): boolean {
    const ids = new Set(event.bookIds)
    return books.value.some((book) => ids.has(book.id) || (book.linked?.books.some((member) => ids.has(member.bookId)) ?? false))
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  function applyLinksChanged(event: BookLinksChangedEvent): void {
    if (touchesLoadedCards(event) || affectsScope?.(event) === true) scheduleRefresh()
  }

  useBookEvents().onBookLinksChanged(applyLinksChanged)

  onScopeDispose(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  return { applyLinksChanged, scheduleRefresh }
}
