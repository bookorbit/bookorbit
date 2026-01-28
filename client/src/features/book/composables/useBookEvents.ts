import { toast } from 'vue-sonner'
import type { BookMissingEvent, BookRestoredEvent } from '@projectx/types'
import { getSocket } from '@/features/scanner/composables/useScanProgress'

type BookMissingCallback = (bookIds: number[]) => void
type BookRestoredCallback = (bookIds: number[]) => void

const missingCallbacks = new Set<BookMissingCallback>()
const restoredCallbacks = new Set<BookRestoredCallback>()

let pendingMissingCount = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

function flushMissingToast() {
  if (pendingMissingCount === 0) return
  const count = pendingMissingCount
  pendingMissingCount = 0
  toastTimer = null
  toast.warning(count === 1 ? '1 book is no longer available on disk.' : `${count} books are no longer available on disk.`)
}

let initialized = false

function ensureInitialized() {
  if (initialized) return
  initialized = true

  const socket = getSocket()

  socket.on('book:missing', (event: BookMissingEvent) => {
    for (const cb of missingCallbacks) cb(event.bookIds)
    pendingMissingCount += event.bookIds.length
    clearTimeout(toastTimer ?? undefined)
    toastTimer = setTimeout(flushMissingToast, 1000)
  })

  socket.on('book:restored', (event: BookRestoredEvent) => {
    for (const cb of restoredCallbacks) cb(event.bookIds)
  })
}

export function useBookEvents() {
  ensureInitialized()

  function onBookMissing(cb: BookMissingCallback): () => void {
    missingCallbacks.add(cb)
    return () => missingCallbacks.delete(cb)
  }

  function onBookRestored(cb: BookRestoredCallback): () => void {
    restoredCallbacks.add(cb)
    return () => restoredCallbacks.delete(cb)
  }

  return { onBookMissing, onBookRestored }
}
