import { onScopeDispose, ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookDockFile, BookDockFilesPage, BookQuery, BooksPage } from '@bookorbit/types'

const RESULT_LIMIT = 6
const DEBOUNCE_MS = 300

export type FulfilmentSource = 'book' | 'dockFile'

export interface FulfilmentChoice {
  source: FulfilmentSource
  id: number
}

/**
 * Search behind the "close this request" step.
 *
 * The endpoint has always taken a `matchedBookId` or a `bookDockFileId`, and the drawer asked the
 * operator to type them: "Book ID, e.g. 128". Nobody knows those numbers. This turns both into a
 * search over the thing being named, and the numeric id never reaches the screen.
 */
export function useFulfilmentPicker() {
  const source = ref<FulfilmentSource>('book')
  const query = ref('')
  const books = ref<BookCard[]>([])
  const dockFiles = ref<BookDockFile[]>([])
  const searching = ref(false)
  const selected = ref<FulfilmentChoice | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let generation = 0

  async function runSearch(term: string, gen: number): Promise<void> {
    const requestController = new AbortController()
    controller = requestController
    searching.value = true

    try {
      if (source.value === 'book') {
        const body: BookQuery = { q: term, sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: RESULT_LIMIT } }
        const res = await api('/api/v1/books/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: requestController.signal,
        })
        if (gen !== generation) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BooksPage
        if (gen !== generation) return
        books.value = data.items
      } else {
        const params = new URLSearchParams({ search: term, page: '1', limit: String(RESULT_LIMIT), sort: 'createdAt', order: 'desc' })
        const res = await api(`/api/v1/book-dock/files?${params}`, { signal: requestController.signal })
        if (gen !== generation) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BookDockFilesPage
        if (gen !== generation) return
        dockFiles.value = data.items
      }
    } catch {
      if (gen !== generation || requestController.signal.aborted) return
      books.value = []
      dockFiles.value = []
    } finally {
      if (gen === generation) searching.value = false
    }
  }

  /** Debounced, because this runs against the whole library and fires on every keystroke. */
  function search(term: string): void {
    query.value = term
    if (timer) clearTimeout(timer)
    controller?.abort()
    generation += 1
    const gen = generation

    const trimmed = term.trim()
    if (!trimmed) {
      books.value = []
      dockFiles.value = []
      searching.value = false
      return
    }

    // Set here rather than in `runSearch`: between the keystroke and the timer firing there are no
    // results and no search, which the panel reads as "nothing matched" and shows for 300ms on
    // every single keystroke. The search is pending from the moment there is a term to search for.
    searching.value = true
    timer = setTimeout(() => {
      void runSearch(trimmed, gen)
    }, DEBOUNCE_MS)
  }

  // A drawer closed mid-keystroke leaves a timer that fires into a torn-down scope, and its
  // request outlives the panel that asked for it.
  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
    controller?.abort()
    generation += 1
  })

  /** Switching source drops the selection: a book id is not a dock file id and must not survive. */
  function setSource(next: FulfilmentSource): void {
    if (source.value === next) return
    source.value = next
    selected.value = null
    books.value = []
    dockFiles.value = []
    if (query.value.trim()) search(query.value)
  }

  function select(choice: FulfilmentChoice): void {
    selected.value = choice.id === selected.value?.id && choice.source === selected.value?.source ? null : choice
  }

  function isSelected(choice: FulfilmentChoice): boolean {
    return selected.value?.source === choice.source && selected.value?.id === choice.id
  }

  function reset(): void {
    if (timer) clearTimeout(timer)
    controller?.abort()
    generation += 1
    source.value = 'book'
    query.value = ''
    books.value = []
    dockFiles.value = []
    selected.value = null
    searching.value = false
  }

  /** Exactly the shape the fulfil endpoint takes, so the page never rebuilds it by hand. */
  function toPayload(): { matchedBookId?: number; bookDockFileId?: number } | null {
    const choice = selected.value
    if (!choice) return null
    return choice.source === 'book' ? { matchedBookId: choice.id } : { bookDockFileId: choice.id }
  }

  return { source, query, books, dockFiles, searching, selected, search, setSource, select, isSelected, reset, toPayload }
}
