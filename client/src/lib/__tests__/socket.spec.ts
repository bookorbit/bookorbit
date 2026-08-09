import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthenticatedSocket } from '@/lib/socket'
import { getValidToken, refreshAccessToken } from '@/lib/api'

const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
const connect = vi.fn<() => void>()
const ioOptions: Record<string, unknown>[] = []

const fakeSocket = {
  on(event: string, handler: (...args: unknown[]) => void) {
    const existing = listeners.get(event) ?? []
    existing.push(handler)
    listeners.set(event, existing)
    return fakeSocket
  },
  connect,
}

vi.mock('socket.io-client', () => ({
  io: (_namespace: string, options: Record<string, unknown>) => {
    ioOptions.push(options)
    return fakeSocket
  },
}))

vi.mock('@/lib/api', () => ({
  getValidToken: vi.fn<() => Promise<string | null>>(),
  refreshAccessToken: vi.fn<() => Promise<string>>(),
}))

function fire(event: string, ...args: unknown[]): void {
  for (const handler of listeners.get(event) ?? []) handler(...args)
}

/** Rejection as the gateways perform it: tell the client why, then close the connection. */
function rejectHandshake(): void {
  fire('unauthorized', { reason: 'invalid_token' })
  fire('disconnect', 'io server disconnect')
}

describe('createAuthenticatedSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listeners.clear()
    ioOptions.length = 0
    connect.mockClear()
    vi.mocked(getValidToken).mockResolvedValue('fresh-token')
    vi.mocked(refreshAccessToken).mockResolvedValue('fresh-token')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('resolves the token per handshake instead of capturing it at creation', async () => {
    createAuthenticatedSocket('/notifications')
    const auth = ioOptions[0]!.auth as (cb: (data: object) => void) => void

    const handshake = vi.fn<(data: object) => void>()
    auth(handshake)
    await vi.waitFor(() => expect(handshake).toHaveBeenCalled())

    expect(getValidToken).toHaveBeenCalled()
    expect(handshake).toHaveBeenCalledWith({ token: 'fresh-token' })
  })

  it('re-authenticates and reconnects after the server rejects the handshake', async () => {
    createAuthenticatedSocket('/book-dock')

    rejectHandshake()
    expect(connect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('stays down when the server closed the socket without inviting a retry', async () => {
    createAuthenticatedSocket('/book-dock')

    // A permission denial closes the socket silently: a fresh token would be refused the same way.
    fire('disconnect', 'io server disconnect')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('leaves every other disconnect reason to socket.io', async () => {
    createAuthenticatedSocket('/scan')

    fire('disconnect', 'transport close')
    fire('disconnect', 'ping timeout')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(connect).not.toHaveBeenCalled()
  })

  it('backs off exponentially across repeated rejections', async () => {
    createAuthenticatedSocket('/notifications')

    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)

    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('gives up rather than hammering a server that keeps rejecting', async () => {
    createAuthenticatedSocket('/notifications')

    for (let attempt = 0; attempt < 10; attempt++) {
      rejectHandshake()
      await vi.advanceTimersByTimeAsync(60_000)
    }

    expect(connect).toHaveBeenCalledTimes(6)
  })

  it('retries when the refresh itself fails, so a brief outage is not terminal', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error('refresh failed'))
    createAuthenticatedSocket('/book-dock')

    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('forgets the backoff once a connection has held', async () => {
    createAuthenticatedSocket('/notifications')

    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)

    fire('connect')
    await vi.advanceTimersByTimeAsync(5_000)

    // A healthy connection resets the ladder, so the next rejection waits 1s again rather than 2s.
    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('does not reset the backoff for a connection the server closes immediately', async () => {
    createAuthenticatedSocket('/notifications')

    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)

    // The namespace accepts, then handleConnection rejects: `connect` fires before the close.
    fire('connect')
    rejectHandshake()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
