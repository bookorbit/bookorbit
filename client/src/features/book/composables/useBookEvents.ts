import { toast } from 'vue-sonner'
import type { BookFileRemovedEvent, BookMissingEvent } from '@projectx/types'
import { getSocket } from '@/features/scanner/composables/useScanProgress'

type BookMissingCallback = (bookIds: number[]) => void
type BookFileRemovedCallback = (bookId: number, fileId: number) => void

const missingCallbacks = new Set<BookMissingCallback>()
const fileRemovedCallbacks = new Set<BookFileRemovedCallback>()

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

  socket.on('book:file:removed', (event: BookFileRemovedEvent) => {
    for (const cb of fileRemovedCallbacks) cb(event.bookId, event.fileId)
  })
}

export function useBookEvents() {
  ensureInitialized()

  function onBookMissing(cb: BookMissingCallback): () => void {
    missingCallbacks.add(cb)
    return () => missingCallbacks.delete(cb)
  }

  function onBookFileRemoved(cb: BookFileRemovedCallback): () => void {
    fileRemovedCallbacks.add(cb)
    return () => fileRemovedCallbacks.delete(cb)
  }

  return { onBookMissing, onBookFileRemoved }
}
