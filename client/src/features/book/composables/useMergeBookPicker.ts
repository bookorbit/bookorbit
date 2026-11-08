import { onScopeDispose, ref } from 'vue'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'
import { apiJson, jsonBody } from '@/lib/api-json'

const RESULT_LIMIT = 20
const DEBOUNCE_MS = 300

/**
 * Searches for the books to merge or link with the one already open. Without a library it searches
 * every library the user can see, which is what Merge and Link need; that search never collapses
 * linked books, so each record can be picked, and merged-away books cannot appear: their rows no
 * longer exist. With a library it is scoped through that library's own query endpoint.
 */
export function useMergeBookPicker() {
  const results = ref<BookCard[]>([])
  const searching = ref(false)
  const failed = ref(false)
  const query = ref('')

  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let generation = 0

  function cancel(): void {
    if (timer) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
    generation += 1
  }

  async function run(libraryId: number | null, term: string, current: number): Promise<void> {
    const requestController = new AbortController()
    controller = requestController
    const body: BookQuery = { q: term, sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: RESULT_LIMIT } }
    try {
      const page = await apiJson<BooksPage>(
        libraryId === null ? '/api/v1/books/query' : `/api/v1/libraries/${libraryId}/books`,
        { ...jsonBody('POST', body), signal: requestController.signal },
        'book.merge.picker.failed',
      )
      if (current !== generation) return
      results.value = page.items
    } catch {
      if (current !== generation || requestController.signal.aborted) return
      results.value = []
      failed.value = true
    } finally {
      if (current === generation) searching.value = false
    }
  }

  function search(libraryId: number | null, term: string): void {
    cancel()
    query.value = term
    failed.value = false
    const trimmed = term.trim()
    if (!trimmed) {
      results.value = []
      searching.value = false
      return
    }
    searching.value = true
    const current = generation
    timer = setTimeout(() => {
      timer = null
      void run(libraryId, trimmed, current)
    }, DEBOUNCE_MS)
  }

  function reset(): void {
    cancel()
    query.value = ''
    results.value = []
    searching.value = false
    failed.value = false
  }

  onScopeDispose(cancel)

  return { query, results, searching, failed, search, reset }
}
