import type { Socket } from 'socket.io-client'
import type { AiJobsChangedEvent } from '@bookorbit/types'

import { createAuthenticatedSocket } from '@/lib/socket'

export interface AiJobsListener {
  /** Jobs the viewer can see changed; `state` when one changed status. */
  changed: (event: AiJobsChangedEvent) => void
  /** Whether the server pushes changes right now; while it does not, the page polls. */
  live: (live: boolean) => void
}

let socket: Socket | null = null
const listeners = new Set<AiJobsListener>()

function getSocket(): Socket {
  if (socket) return socket
  const created = createAuthenticatedSocket('/ai-jobs')
  created.on('connect', () => {
    for (const listener of listeners) listener.live(true)
  })
  created.on('disconnect', () => {
    for (const listener of listeners) listener.live(false)
  })
  created.on('ai-jobs:changed', (event: AiJobsChangedEvent | undefined) => {
    for (const listener of listeners) listener.changed({ state: event?.state === true })
  })
  socket = created
  return created
}

/** Hears AI job changes until the returned function is called. The connection closes with the last listener. */
export function listenToAiJobs(listener: AiJobsListener): () => void {
  listeners.add(listener)
  const current = getSocket()
  if (current.connected) listener.live(true)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    listeners.delete(listener)
    if (listeners.size === 0) disconnectAiJobsSocket()
  }
}

/** On sign-out, or once no page listens: the next one opens its own connection. */
export function disconnectAiJobsSocket(): void {
  socket?.disconnect()
  socket = null
  listeners.clear()
}
