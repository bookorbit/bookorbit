import { toast } from 'vue-sonner'
import { getCurrentInstance, onUnmounted } from 'vue'
import type { BookMissingEvent, BookMovedEvent, BookProgressChangedEvent, BookRestoredEvent, BookTransferredEvent } from '@bookorbit/types'
import { getSocket } from '@/features/scanner/composables/useScanProgress'

type BookIdsCallback = (bookIds: number[]) => void
type BookTransferredCallback = (event: BookTransferredEvent) => void
type BookProgressChangedCallback = (event: BookProgressChangedEvent) => void

const missingCallbacks = new Set<BookIdsCallback>()
const restoredCallbacks = new Set<BookIdsCallback>()
const movedCallbacks = new Set<BookIdsCallback>()
const transferredCallbacks = new Set<BookTransferredCallback>()
const progressChangedCallbacks = new Set<BookProgressChangedCallback>()

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

  socket.on('book:transferred', (event: BookTransferredEvent) => {
    for (const cb of transferredCallbacks) cb(event)
  })

  socket.on('book:progress-changed', (event: BookProgressChangedEvent) => {
    for (const cb of progressChangedCallbacks) cb(event)
  })
}

function registerCallback<T extends (...args: never[]) => void>(callbacks: Set<T>, cb: T): () => void {
  callbacks.add(cb)
  const cleanup = () => callbacks.delete(cb)
  if (getCurrentInstance()) onUnmounted(cleanup)
  return cleanup
}

export function useBookEvents() {
  ensureInitialized()

  function onBookMissing(cb: BookIdsCallback): () => void {
    return registerCallback(missingCallbacks, cb)
  }

  function onBookRestored(cb: BookIdsCallback): () => void {
    return registerCallback(restoredCallbacks, cb)
  }

  function onBookMoved(cb: BookIdsCallback): () => void {
    return registerCallback(movedCallbacks, cb)
  }

  function onBookTransferred(cb: BookTransferredCallback): () => void {
    return registerCallback(transferredCallbacks, cb)
  }

  function onBookProgressChanged(cb: BookProgressChangedCallback): () => void {
    return registerCallback(progressChangedCallbacks, cb)
  }

  return { onBookMissing, onBookRestored, onBookMoved, onBookTransferred, onBookProgressChanged }
}
