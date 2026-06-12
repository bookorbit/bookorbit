import { computed, shallowRef, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'

export const BOOK_WINDOW_BLOCK_SIZE = 100
const FAILED_BLOCK_RETRY_MS = 2000
const MAX_ITEMS_PER_ENSURE = 1000

export type BookWindowQuery = Omit<BookQuery, 'pagination'>

export type BookPlaceholder = { id: number; placeholder: true }
export type BookSlot = BookCard | BookPlaceholder

export function isBookPlaceholder(slot: BookSlot): slot is BookPlaceholder {
  return (slot as BookPlaceholder).placeholder === true
}

/**
 * Placeholder-window store for book listings: holds a slot array sized to the
 * query total, where unloaded positions are placeholder objects rendered as
 * skeletons. Slot index i always equals the absolute row index i of the
 * server listing, so jumping is scroll-to-index and block fetches write at
 * block * BLOCK_SIZE. Mutations that shift indexes (remove/prepend) bump the
 * generation so in-flight responses for stale offsets are discarded.
 */
export function useBookWindow(options: { endpoint: Ref<string | null>; query: Ref<BookWindowQuery> }) {
  const slots = shallowRef<BookSlot[]>([])
  const total = shallowRef(0)
  const loading = shallowRef(false)
  const initialized = shallowRef(false)
  const error = shallowRef<string | null>(null)

  const inFlight = new Set<number>()
  const failedAt = new Map<number, number>()
  let generation = 0
  let controller: AbortController | null = null
  let placeholderSeq = 0

  function makePlaceholder(): BookPlaceholder {
    placeholderSeq += 1
    return { id: -placeholderSeq, placeholder: true }
  }

  function resizeSlots(current: BookSlot[], newTotal: number): BookSlot[] {
    if (newTotal <= current.length) return current.slice(0, newTotal)
    const next = current.slice()
    while (next.length < newTotal) next.push(makePlaceholder())
    return next
  }

  function blockFullyLoaded(block: number): boolean {
    const start = block * BOOK_WINDOW_BLOCK_SIZE
    if (start >= slots.value.length) return false
    const end = Math.min(slots.value.length, start + BOOK_WINDOW_BLOCK_SIZE)
    for (let i = start; i < end; i++) {
      if (isBookPlaceholder(slots.value[i]!)) return false
    }
    return true
  }

  async function fetchBlock(block: number) {
    const endpoint = options.endpoint.value
    if (!endpoint) return

    const gen = generation
    const signal = controller?.signal
    inFlight.add(block)
    loading.value = true

    try {
      const body: BookQuery = {
        ...options.query.value,
        pagination: { page: block, size: BOOK_WINDOW_BLOCK_SIZE },
      }
      const res = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (gen !== generation) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()
      if (gen !== generation) return

      const next = resizeSlots(slots.value, data.total)
      const start = block * BOOK_WINDOW_BLOCK_SIZE
      for (let i = 0; i < data.items.length && start + i < next.length; i++) {
        next[start + i] = data.items[i]!
      }
      slots.value = next
      total.value = data.total
      error.value = null
      failedAt.delete(block)
    } catch (e) {
      if (gen !== generation || signal?.aborted) return
      failedAt.set(block, Date.now())
      error.value = e instanceof Error ? e.message : 'Failed to load books'
    } finally {
      if (gen === generation) {
        inFlight.delete(block)
        loading.value = inFlight.size > 0
        initialized.value = true
      }
    }
  }

  function ensureRange(startIndex: number, endIndex: number) {
    if (!options.endpoint.value) return
    if (initialized.value && total.value === 0 && failedAt.size === 0) return
    const start = Math.max(0, startIndex)
    let end = Math.max(start, endIndex)
    if (total.value > 0) end = Math.min(end, total.value - 1)
    end = Math.min(end, start + MAX_ITEMS_PER_ENSURE - 1)

    const firstBlock = Math.floor(start / BOOK_WINDOW_BLOCK_SIZE)
    const lastBlock = Math.floor(end / BOOK_WINDOW_BLOCK_SIZE)
    for (let block = firstBlock; block <= lastBlock; block++) {
      if (inFlight.has(block)) continue
      const failed = failedAt.get(block)
      if (failed !== undefined && Date.now() - failed < FAILED_BLOCK_RETRY_MS) continue
      if (initialized.value && blockFullyLoaded(block)) continue
      void fetchBlock(block)
    }
  }

  function invalidateInFlight() {
    generation += 1
    controller?.abort()
    controller = new AbortController()
    inFlight.clear()
    loading.value = false
  }

  function reset() {
    invalidateInFlight()
    failedAt.clear()
    slots.value = []
    total.value = 0
    error.value = null
    if (!options.endpoint.value) {
      initialized.value = true
      return
    }
    initialized.value = false
    ensureRange(0, BOOK_WINDOW_BLOCK_SIZE - 1)
  }

  function retry() {
    const failedBlocks = [...failedAt.keys()]
    failedAt.clear()
    error.value = null
    if (failedBlocks.length > 0) {
      for (const block of failedBlocks) {
        if (!inFlight.has(block)) void fetchBlock(block)
      }
      return
    }
    if (!initialized.value || total.value === 0) {
      reset()
      return
    }
    ensureRange(0, BOOK_WINDOW_BLOCK_SIZE - 1)
  }

  const contiguousPrefix = computed<BookCard[]>(() => {
    const list = slots.value
    let end = 0
    while (end < list.length && !isBookPlaceholder(list[end]!)) end++
    return list.slice(0, end) as BookCard[]
  })

  const loadedCards = computed<BookCard[]>(() => slots.value.filter((slot) => !isBookPlaceholder(slot)) as BookCard[])

  function updateBooks(cards: BookCard[]) {
    if (cards.length === 0) return
    const byId = new Map(cards.map((card) => [card.id, card]))
    let changed = false
    const next = slots.value.map((slot) => {
      if (isBookPlaceholder(slot)) return slot
      const replacement = byId.get(slot.id)
      if (!replacement || replacement === slot) return slot
      changed = true
      return replacement
    })
    if (changed) slots.value = next
  }

  function updateBook(updated: BookCard) {
    updateBooks([updated])
  }

  function removeBooks(ids: ReadonlySet<number> | number[]) {
    const idSet = ids instanceof Set ? ids : new Set(ids)
    const next = slots.value.filter((slot) => isBookPlaceholder(slot) || !idSet.has(slot.id))
    const removed = slots.value.length - next.length
    if (removed === 0) return
    invalidateInFlight()
    slots.value = next
    total.value = Math.max(0, total.value - removed)
  }

  function prependBooks(cards: BookCard[]) {
    if (cards.length === 0) return
    const existingIds = new Set(loadedCards.value.map((card) => card.id))
    const fresh = cards.filter((card) => !existingIds.has(card.id))
    if (fresh.length === 0) return
    invalidateInFlight()
    slots.value = [...fresh, ...slots.value]
    total.value = total.value + fresh.length
  }

  // Writable view over the loaded cards so existing consumers that assign
  // books.value (bulk actions map-by-id, delete filters, live-scan prepends)
  // keep working against the window. The setter reconciles by id: missing ids
  // are removals, same-id objects are updates, unknown ids are prepends.
  const booksProxy = computed<BookCard[]>({
    get: () => loadedCards.value,
    set: (next) => {
      const current = loadedCards.value
      const nextById = new Map(next.map((card) => [card.id, card]))
      const currentById = new Map(current.map((card) => [card.id, card]))

      const removedIds = current.filter((card) => !nextById.has(card.id)).map((card) => card.id)
      if (removedIds.length > 0) removeBooks(removedIds)

      const updated = next.filter((card) => {
        const existing = currentById.get(card.id)
        return existing !== undefined && existing !== card
      })
      if (updated.length > 0) updateBooks(updated)

      const fresh = next.filter((card) => !currentById.has(card.id))
      if (fresh.length > 0) prependBooks(fresh)
    },
  })

  const queryKey = computed(() => `${options.endpoint.value ?? ''}|${JSON.stringify(options.query.value)}`)

  watch(queryKey, reset, { immediate: true })

  return {
    slots,
    total,
    loading,
    initialized,
    error,
    ensureRange,
    reset,
    retry,
    contiguousPrefix,
    loadedCards,
    booksProxy,
    updateBook,
    updateBooks,
    removeBooks,
    prependBooks,
  }
}
