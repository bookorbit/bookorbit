import { toast } from 'vue-sonner'
import { getCurrentInstance, onUnmounted } from 'vue'
import type {
  BookLinksChangedEvent,
  BookMergedEvent,
  BookMergeJobEvent,
  BookMissingEvent,
  BookMovedEvent,
  BookProgressChangedEvent,
  BookRestoredEvent,
  BookTransferredEvent,
} from '@bookorbit/types'
import { getSocket } from '@/features/scanner/composables/useScanProgress'

type BookIdsCallback = (bookIds: number[]) => void
type BookTransferredCallback = (event: BookTransferredEvent) => void
type BookProgressChangedCallback = (event: BookProgressChangedEvent) => void
type BookMergedCallback = (event: BookMergedEvent) => void
type BookMergeJobCallback = (event: BookMergeJobEvent) => void
type BookLinksChangedCallback = (event: BookLinksChangedEvent) => void

const missingCallbacks = new Set<BookIdsCallback>()
const restoredCallbacks = new Set<BookIdsCallback>()
const movedCallbacks = new Set<BookIdsCallback>()
const transferredCallbacks = new Set<BookTransferredCallback>()
const progressChangedCallbacks = new Set<BookProgressChangedCallback>()
const mergedCallbacks = new Set<BookMergedCallback>()
const mergeProgressCallbacks = new Set<BookMergeJobCallback>()
const mergeFinishedCallbacks = new Set<BookMergeJobCallback>()
const linksChangedCallbacks = new Set<BookLinksChangedCallback>()

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

  socket.on('book:merged', (event: BookMergedEvent) => {
    for (const cb of mergedCallbacks) cb(event)
  })

  socket.on('book-merge:progress', (event: BookMergeJobEvent) => {
    for (const cb of mergeProgressCallbacks) cb(event)
  })

  socket.on('book-merge:finished', (event: BookMergeJobEvent) => {
    for (const cb of mergeFinishedCallbacks) cb(event)
  })

  socket.on('book:links-changed', (event: BookLinksChangedEvent) => {
    for (const cb of linksChangedCallbacks) cb(event)
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

  function onBookMerged(cb: BookMergedCallback): () => void {
    return registerCallback(mergedCallbacks, cb)
  }

  /** Progress of a merge this user started. Arrives on the user's own room, not the library's. */
  function onBookMergeProgress(cb: BookMergeJobCallback): () => void {
    return registerCallback(mergeProgressCallbacks, cb)
  }

  function onBookMergeFinished(cb: BookMergeJobCallback): () => void {
    return registerCallback(mergeFinishedCallbacks, cb)
  }

  /** Books were linked or unlinked, or a group's main book changed. One event per affected library. */
  function onBookLinksChanged(cb: BookLinksChangedCallback): () => void {
    return registerCallback(linksChangedCallbacks, cb)
  }

  return {
    onBookMissing,
    onBookRestored,
    onBookMoved,
    onBookTransferred,
    onBookProgressChanged,
    onBookMerged,
    onBookMergeProgress,
    onBookMergeFinished,
    onBookLinksChanged,
  }
}
