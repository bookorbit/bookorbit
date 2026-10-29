import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'

import { getValidToken, refreshAccessToken } from '@/lib/api'

const REAUTH_BASE_DELAY_MS = 1_000
const REAUTH_MAX_DELAY_MS = 30_000
const REAUTH_MAX_ATTEMPTS = 6

/** A connection that lasts this long counts as healthy, so the next rejection starts a fresh backoff. */
const STABLE_CONNECTION_MS = 5_000

/**
 * A gateway that rejects a handshake over the token answers with `unauthorized` and then disconnects.
 * socket.io reports that as `io server disconnect` and, by contract, never reconnects from it: the
 * namespace stays dead for the rest of the page's life unless something calls `connect()` again.
 * That is the difference between "one stale token" and "no live updates until you reload", so every
 * authenticated namespace goes through here rather than calling `io()` directly.
 *
 * Only `unauthorized` earns a retry. A gateway that closes the socket without it turned the user
 * away for a reason a new token will not change, such as a missing permission, and reconnecting
 * would just repeat the rejection.
 */
export function createAuthenticatedSocket(namespace: string, options: Partial<ManagerOptions & SocketOptions> = {}): Socket {
  const socket = io(namespace, {
    transports: ['websocket'],
    ...options,
    // Resolved per handshake, and awaited: a woken tab holds a token the server already rejects.
    auth: (cb: (data: object) => void) => {
      void getValidToken().then((token) => cb({ token }))
    },
  })

  let attempts = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let stableTimer: ReturnType<typeof setTimeout> | null = null
  let rejectedForAuth = false
  /** Set when the owner closes the socket; a retry already in flight must not reopen it. */
  let closedByOwner = false

  function clearStableTimer(): void {
    if (stableTimer === null) return
    clearTimeout(stableTimer)
    stableTimer = null
  }

  function clearRetryTimer(): void {
    if (retryTimer === null) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  function scheduleReauth(): void {
    if (closedByOwner || retryTimer !== null || attempts >= REAUTH_MAX_ATTEMPTS) return
    const delay = Math.min(REAUTH_BASE_DELAY_MS * 2 ** attempts, REAUTH_MAX_DELAY_MS)
    attempts += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void refreshAccessToken().then(
        () => {
          if (!closedByOwner) socket.connect()
        },
        // A refresh that fails here may be the session ending or the server being briefly
        // unreachable. Back off and try again; `api()` owns the redirect to login either way.
        () => scheduleReauth(),
      )
    }, delay)
  }

  // socket.io emits nothing when an already-disconnected socket is closed, which is exactly the state
  // a pending retry is in, so the close itself has to be seen. `close()` delegates to `disconnect()`,
  // and `open()` to `connect()`, which also reopens a socket for an owner that closed it earlier.
  const disconnect = socket.disconnect
  socket.disconnect = () => {
    closedByOwner = true
    clearRetryTimer()
    clearStableTimer()
    return disconnect.call(socket)
  }
  const connect = socket.connect
  socket.connect = () => {
    closedByOwner = false
    return connect.call(socket)
  }

  socket.on('connect', () => {
    closedByOwner = false
    clearRetryTimer()
    clearStableTimer()
    stableTimer = setTimeout(() => {
      attempts = 0
      stableTimer = null
    }, STABLE_CONNECTION_MS)
  })

  socket.on('unauthorized', () => {
    rejectedForAuth = true
  })

  socket.on('disconnect', (reason: string) => {
    clearStableTimer()
    const needsReauth = rejectedForAuth
    rejectedForAuth = false
    // Every other reason is socket.io's own to retry, and it already does.
    if (reason !== 'io server disconnect' || !needsReauth) return
    scheduleReauth()
  })

  return socket
}
