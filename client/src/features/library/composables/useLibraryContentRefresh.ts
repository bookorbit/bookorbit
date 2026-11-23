import { onScopeDispose, watch, type Ref } from 'vue'

/** Books streaming in recount the header at most this often. */
export const LIVE_RECOUNT_INTERVAL_MS = 4000

export interface LibraryContentRefreshOptions {
  libraryId: Ref<number | null>
  /** The library's count from the library list, which scans, uploads, transfers and deletes refresh. */
  bookCount: Ref<number | undefined>
  /** Grows as a scan or upload streams new books into the page. */
  liveAdded: Ref<number>
  /** Recounts the page's header. */
  recount: () => void
  /** Reloads what a settled change invalidates beyond the counts. */
  reload: () => void
}

/**
 * Keeps a library page's counts in step with books that arrive or leave while it stays open. Books
 * streaming in during a scan recount the header, throttled so a large scan does not recount for
 * every batch; scan progress cannot drive this, since it reports added books only once the scan
 * ends. When the library list reports a new count (after a scan, upload, transfer or delete), the
 * page recounts and reloads at once.
 */
export function useLibraryContentRefresh(options: LibraryContentRefreshOptions): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRecountAt = 0

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function recountNow() {
    cancel()
    lastRecountAt = Date.now()
    options.recount()
  }

  function recountSoon() {
    if (timer) return
    timer = setTimeout(recountNow, Math.max(0, lastRecountAt + LIVE_RECOUNT_INTERVAL_MS - Date.now()))
  }

  watch(options.liveAdded, (count, previous) => {
    if (count > previous) recountSoon()
  })

  watch([options.libraryId, options.bookCount], ([id, count], [previousId, previousCount]) => {
    if (id !== previousId || count === undefined || previousCount === undefined || count === previousCount) return
    recountNow()
    options.reload()
  })

  watch(options.libraryId, cancel)
  onScopeDispose(cancel)
}
