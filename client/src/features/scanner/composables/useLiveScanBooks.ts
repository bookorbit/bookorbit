import { onUnmounted, ref, type Ref } from 'vue'
import type { BookCard, ScanBooksAddedEvent } from '@bookorbit/types'
import { getSocket } from './useScanProgress'

const THROTTLE_MS = 500
const ANIMATION_DURATION_MS = 400
const ANIMATE_BATCH_LIMIT = 6

export function useLiveScanBooks(libraryId: Ref<number | null>, existingBooks: Ref<BookCard[]>, total?: Ref<number>) {
  const newBookIds = ref(new Set<number>())

  let buffer: BookCard[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let handler: ((event: ScanBooksAddedEvent) => void) | null = null

  function flush() {
    flushTimer = null
    if (buffer.length === 0) return

    const batch = buffer
    buffer = []

    const batchById = new Map(batch.map((b) => [b.id, b]))
    const existingIdSet = new Set(existingBooks.value.map((b) => b.id))

    const newBooks = batch.filter((b) => !existingIdSet.has(b.id))
    const hasUpdates = batch.some((b) => existingIdSet.has(b.id))

    if (newBooks.length === 0 && !hasUpdates) return

    let updated = existingBooks.value
    if (hasUpdates) {
      updated = existingBooks.value.map((b) => batchById.get(b.id) ?? b)
    }

    existingBooks.value = newBooks.length > 0 ? [...newBooks, ...updated] : updated
    if (newBooks.length > 0 && total) total.value += newBooks.length

    if (newBooks.length > 0 && newBooks.length <= ANIMATE_BATCH_LIMIT) {
      const ids = new Set(newBooks.map((b) => b.id))
      newBookIds.value = new Set([...newBookIds.value, ...ids])
      setTimeout(() => {
        const current = new Set(newBookIds.value)
        for (const id of ids) current.delete(id)
        newBookIds.value = current
      }, ANIMATION_DURATION_MS)
    }
  }

  function onBooksAdded(event: ScanBooksAddedEvent) {
    if (event.libraryId !== libraryId.value) return
    buffer.push(...event.books)
    if (!flushTimer) {
      flushTimer = setTimeout(flush, THROTTLE_MS)
    }
  }

  function start() {
    if (handler) return
    handler = onBooksAdded
    getSocket().on('scan:books:added', handler)
  }

  function stop() {
    if (handler) {
      getSocket().off('scan:books:added', handler)
      handler = null
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    buffer = []
    newBookIds.value = new Set()
  }

  onUnmounted(stop)

  return { newBookIds, start, stop }
}
