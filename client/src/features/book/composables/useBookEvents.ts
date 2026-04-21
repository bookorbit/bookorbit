import { toast } from 'vue-sonner'
import type { BookMissingEvent, BookMovedEvent, BookRestoredEvent } from '@bookorbit/types'
import { getSocket } from '@/features/scanner/composables/useScanProgress'

type BookIdsCallback = (bookIds: number[]) => void

const missingCallbacks = new Set<BookIdsCallback>()
const restoredCallbacks = new Set<BookIdsCallback>()
const movedCallbacks = new Set<BookIdsCallback>()

let pendingMissingCount = 0
let pendingRestoredCount = 0
let pendingMovedCount = 0
let missingToastTimer: ReturnType<typeof setTimeout> | null = null
let restoredToastTimer: ReturnType<typeof setTimeout> | null = null
let movedToastTimer: ReturnType<typeof setTimeout> | null = null

function flushMissingToast() {
  if (pendingMissingCount === 0) return
  const count = pendingMissingCount
  pendingMissingCount = 0
  missingToastTimer = null
  toast.warning(count === 1 ? '1 book is no longer available on disk.' : `${count} books are no longer available on disk.`)
}

function flushRestoredToast() {
  if (pendingRestoredCount === 0) return
  const count = pendingRestoredCount
  pendingRestoredCount = 0
  restoredToastTimer = null
  toast.success(count === 1 ? '1 book was restored on disk.' : `${count} books were restored on disk.`)
}

function flushMovedToast() {
  if (pendingMovedCount === 0) return
  const count = pendingMovedCount
  pendingMovedCount = 0
  movedToastTimer = null
  toast.info(count === 1 ? '1 book was moved to a new location.' : `${count} books were moved to new locations.`)
}

let initialized = false

function ensureInitialized() {
  if (initialized) return
  initialized = true

  const socket = getSocket()

  socket.on('book:missing', (event: BookMissingEvent) => {
    for (const cb of missingCallbacks) cb(event.bookIds)
    pendingMissingCount += event.bookIds.length
    clearTimeout(missingToastTimer ?? undefined)
    missingToastTimer = setTimeout(flushMissingToast, 1000)
  })

  socket.on('book:restored', (event: BookRestoredEvent) => {
    for (const cb of restoredCallbacks) cb(event.bookIds)
    pendingRestoredCount += event.bookIds.length
    clearTimeout(restoredToastTimer ?? undefined)
    restoredToastTimer = setTimeout(flushRestoredToast, 1000)
  })

  socket.on('book:moved', (event: BookMovedEvent) => {
    for (const cb of movedCallbacks) cb(event.bookIds)
    pendingMovedCount += event.bookIds.length
    clearTimeout(movedToastTimer ?? undefined)
    movedToastTimer = setTimeout(flushMovedToast, 1000)
  })
}

export function useBookEvents() {
  ensureInitialized()

  function onBookMissing(cb: BookIdsCallback): () => void {
    missingCallbacks.add(cb)
    return () => missingCallbacks.delete(cb)
  }

  function onBookRestored(cb: BookIdsCallback): () => void {
    restoredCallbacks.add(cb)
    return () => restoredCallbacks.delete(cb)
  }

  function onBookMoved(cb: BookIdsCallback): () => void {
    movedCallbacks.add(cb)
    return () => movedCallbacks.delete(cb)
  }

  return { onBookMissing, onBookRestored, onBookMoved }
}
