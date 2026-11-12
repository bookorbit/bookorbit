import type { Socket } from 'socket.io-client'
import type { StoryGuideChangedEvent } from '@bookorbit/types'

import { createAuthenticatedSocket } from '@/lib/socket'

export interface StoryGuideWatcher {
  /** The book's status may have changed. */
  changed: () => void
  /** Some job changed status, which can move the place of every queued job. */
  queueChanged: () => void
  /** Whether the server pushes this book's changes right now; while it does not, the page polls. */
  live: (live: boolean) => void
}

let socket: Socket | null = null
const watchers = new Map<number, Set<StoryGuideWatcher>>()
/** Books the server accepted a watch for on the current connection. */
const liveBooks = new Set<number>()

function setLive(bookId: number, live: boolean): void {
  if (live === liveBooks.has(bookId)) return
  if (live) liveBooks.add(bookId)
  else liveBooks.delete(bookId)
  for (const watcher of watchers.get(bookId) ?? []) watcher.live(live)
}

function sendWatch(target: Socket, bookId: number): void {
  target.emit('story-guide:watch', bookId, (accepted: unknown) => {
    // An answer for a connection that has since dropped, or a book no page watches any more, is stale.
    if (target !== socket || !target.connected || !watchers.has(bookId)) return
    setLive(bookId, accepted === true)
  })
}

function getSocket(): Socket {
  if (socket) return socket
  const created = createAuthenticatedSocket('/story-guides')
  // Rooms are per connection, so every reconnect watches again; the answer tells each page to catch up.
  created.on('connect', () => {
    for (const bookId of watchers.keys()) sendWatch(created, bookId)
  })
  created.on('disconnect', () => {
    for (const bookId of liveBooks) setLive(bookId, false)
  })
  created.on('story-guide:changed', (event: StoryGuideChangedEvent) => {
    for (const watcher of watchers.get(event?.bookId) ?? []) watcher.changed()
  })
  created.on('story-guide:queue-changed', () => {
    for (const set of watchers.values()) for (const watcher of set) watcher.queueChanged()
  })
  socket = created
  return created
}

/** Hears a book's story guide changes until the returned function is called. */
export function watchStoryGuide(bookId: number, watcher: StoryGuideWatcher): () => void {
  let set = watchers.get(bookId)
  const first = !set
  if (!set) {
    set = new Set()
    watchers.set(bookId, set)
  }
  set.add(watcher)
  const current = getSocket()
  if (first && current.connected) sendWatch(current, bookId)
  else if (liveBooks.has(bookId)) watcher.live(true)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const watching = watchers.get(bookId)
    if (!watching) return
    watching.delete(watcher)
    if (watching.size > 0) return
    watchers.delete(bookId)
    liveBooks.delete(bookId)
    if (socket?.connected) socket.emit('story-guide:unwatch', bookId)
  }
}

/** On sign-out: the next account opens its own connection. */
export function disconnectStoryGuideSocket(): void {
  socket?.disconnect()
  socket = null
  watchers.clear()
  liveBooks.clear()
}
