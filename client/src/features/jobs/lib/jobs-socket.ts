import type { Socket } from 'socket.io-client'
import type { JobsChangedEvent } from '@bookorbit/types'

import { createAuthenticatedSocket } from '@/lib/socket'

export interface JobsListener {
  /** Jobs of a type the viewer sees changed; `state` when one changed status. */
  changed: (event: JobsChangedEvent) => void
  /** Whether the server pushes changes right now; while it does not, the page polls. */
  live: (live: boolean) => void
}

let socket: Socket | null = null
const listeners = new Set<JobsListener>()

function getSocket(): Socket {
  if (socket) return socket
  const created = createAuthenticatedSocket('/jobs')
  created.on('connect', () => {
    for (const listener of listeners) listener.live(true)
  })
  created.on('disconnect', () => {
    for (const listener of listeners) listener.live(false)
  })
  created.on('jobs:changed', (event: Partial<JobsChangedEvent> | undefined) => {
    if (typeof event?.type !== 'string') return
    for (const listener of listeners) listener.changed({ type: event.type, state: event.state === true })
  })
  socket = created
  return created
}

/** Hears job changes until the returned function is called. The connection closes with the last listener. */
export function listenToJobs(listener: JobsListener): () => void {
  listeners.add(listener)
  const current = getSocket()
  if (current.connected) listener.live(true)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    listeners.delete(listener)
    if (listeners.size === 0) disconnectJobsSocket()
  }
}

/** On sign-out, or once no page listens: the next one opens its own connection. */
export function disconnectJobsSocket(): void {
  socket?.disconnect()
  socket = null
  listeners.clear()
}
