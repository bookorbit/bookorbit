import { onScopeDispose, ref } from 'vue'
import { Socket } from 'socket.io-client'
import { createAuthenticatedSocket } from '@/lib/socket'
import type { BookRequestDownloadStatus, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'

/**
 * One shared namespace connection for the whole page. Progress arrives as small events keyed on a
 * request id, so a card can move without the list refetching on every tick; `changed` is the
 * coarse signal for anything a percentage cannot express, such as a status transition.
 */
const progressByRequest = ref<Record<number, BookRequestProgressEvent>>({})
const connected = ref(false)
const changeListeners = new Set<() => void>()
let socket: Socket | null = null
let subscribers = 0
let sweepHandle: ReturnType<typeof setInterval> | null = null
/** Whether this socket may have missed events since the page's initial fetch. */
let missedEvents = false

/** An attempt in one of these is over, so a tick describing it is history rather than progress. */
const SETTLED_DOWNLOAD_STATUSES = new Set<BookRequestDownloadStatus>(['imported', 'needs_review', 'failed'])

/**
 * How long a tick nobody has heard from again is kept.
 *
 * `pruneSettledProgress` only reaches rows a page still holds, and the map outlives every page:
 * the sidebar subscribes at startup, so nothing tears it down. A request that was mid-download
 * when its row was filtered out, paged past or dismissed leaves an entry behind that nothing ever
 * looks at again. Generous, because a queued torrent can sit between ticks for a long time, and a
 * live attempt refreshes its own entry on every one.
 */
const STALE_PROGRESS_MS = 30 * 60 * 1000
/** A ceiling for the pathological case, so the map is bounded even inside the staleness window. */
const MAX_PROGRESS_ENTRIES = 500

/** When each request last said anything, which is the only clock a tick itself does not carry. */
const lastTickAt = new Map<number, number>()

function forget(requestId: number): void {
  delete progressByRequest.value[requestId]
  lastTickAt.delete(requestId)
}

/**
 * Drops what nothing is watching any more: entries no tick has refreshed inside the window, and
 * then, if the map is still over its ceiling, the quietest ones until it is not.
 */
function sweepStaleProgress(now: number): void {
  for (const [requestId, seenAt] of lastTickAt) {
    if (now - seenAt > STALE_PROGRESS_MS) forget(requestId)
  }
  if (lastTickAt.size <= MAX_PROGRESS_ENTRIES) return

  const oldestFirst = [...lastTickAt.entries()].sort((left, right) => left[1] - right[1])
  for (const [requestId] of oldestFirst.slice(0, lastTickAt.size - MAX_PROGRESS_ENTRIES)) forget(requestId)
}

function getSocket(): Socket {
  if (socket) return socket

  socket = createAuthenticatedSocket('/book-requests', {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  })

  socket.on('book-requests:progress', (event: BookRequestProgressEvent) => {
    const now = Date.now()
    if (SETTLED_DOWNLOAD_STATUSES.has(event.status)) {
      forget(event.requestId)
    } else {
      progressByRequest.value[event.requestId] = event
      lastTickAt.set(event.requestId, now)
    }
    sweepStaleProgress(now)
  })

  socket.on('book-requests:changed', () => {
    for (const listener of changeListeners) listener()
  })

  socket.on('connect', () => {
    connected.value = true
    // The server replays nothing, so every event that landed while this socket was down is gone:
    // a laptop that slept or a server that restarted mid-transfer leaves rows showing "downloading
    // 97%" until somebody changes a filter or reloads. A reconnect is answered with the same
    // coalesced refetch a `changed` broadcast gets, which is the only thing that catches them up.
    if (!missedEvents) return
    missedEvents = false
    for (const listener of changeListeners) listener()
  })

  socket.on('disconnect', () => {
    connected.value = false
    missedEvents = true
  })

  socket.on('connect_error', () => {
    connected.value = false
    missedEvents = true
  })

  return socket
}

export function useBookRequestProgress() {
  let disposed = false
  subscribers++
  if (!sweepHandle) {
    sweepHandle = setInterval(() => sweepStaleProgress(Date.now()), Math.min(STALE_PROGRESS_MS, 5 * 60 * 1000))
  }
  getSocket()

  onScopeDispose(() => {
    if (disposed) return
    disposed = true
    subscribers--
    if (subscribers > 0 || !socket) return
    socket.disconnect()
    socket = null
    if (sweepHandle) clearInterval(sweepHandle)
    sweepHandle = null
    connected.value = false
    missedEvents = false
    progressByRequest.value = {}
    lastTickAt.clear()
  })

  /**
   * Cleanup is by scope alone, so this must be called during synchronous setup like any other
   * lifecycle registration. There is deliberately no unsubscribe handle: two ways to stop
   * listening is one more than any caller has ever needed, and returning one invites a call from
   * outside a scope, where nothing would ever remove the listener.
   */
  function onRequestsChanged(fn: () => void): void {
    changeListeners.add(fn)
    onScopeDispose(() => changeListeners.delete(fn))
  }

  /**
   * Drops the ticks that the rows just fetched have caught up with. The map lives for as long as
   * the app does - the sidebar subscribes at startup, so it is never torn down by the last page
   * unmounting - and without this it keeps one entry per request that ever downloaded.
   *
   * Only rows whose own attempt has settled are dropped, and only where the tick describes that
   * same attempt, so a fetch that started before a fresh grab cannot evict its first tick.
   */
  function pruneSettledProgress(requests: readonly Pick<BookRequestItem, 'id' | 'download'>[]): void {
    for (const request of requests) {
      const download = request.download
      const tick = progressByRequest.value[request.id]
      if (!download || !tick || tick.downloadId !== download.id) continue
      if (SETTLED_DOWNLOAD_STATUSES.has(download.status)) forget(request.id)
    }
  }

  return { progressByRequest, connected, onRequestsChanged, pruneSettledProgress }
}
