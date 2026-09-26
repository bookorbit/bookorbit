// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { PodcastDownloadProgressEvent } from '@bookorbit/types'

type Handler = (payload: unknown) => void

class FakeSocket {
  readonly handlers = new Map<string, Handler>()
  readonly emitted: Array<[string, unknown]> = []
  disconnected = false

  on(event: string, handler: Handler) {
    this.handlers.set(event, handler)
  }

  emit(event: string, payload: unknown) {
    this.emitted.push([event, payload])
  }

  disconnect() {
    this.disconnected = true
  }

  fire(event: string, payload?: unknown) {
    this.handlers.get(event)?.(payload)
  }
}

const sockets = vi.hoisted(() => ({ created: [] as unknown[] }))

vi.mock('socket.io-client', () => ({
  // The composable only opens the connection on first use, so the class is defined by then.
  io: () => {
    const socket = new FakeSocket()
    sockets.created.push(socket)
    return socket
  },
}))
vi.mock('@/lib/api', () => ({ getValidToken: () => Promise.resolve('token'), refreshAccessToken: () => Promise.resolve('token') }))

const { usePodcastEvents } = await import('./usePodcastEvents')

function latestSocket(): FakeSocket {
  return sockets.created.at(-1) as FakeSocket
}

function progressEvent(overrides: Partial<PodcastDownloadProgressEvent> = {}): PodcastDownloadProgressEvent {
  return { libraryId: 7, podcastId: 3, episodeId: 42, batchId: null, status: 'downloading', receivedBytes: 10, totalBytes: 100, ...overrides }
}

beforeEach(() => {
  const events = usePodcastEvents()
  events.resetForUserChange()
  sockets.created.length = 0
})

describe('usePodcastEvents', () => {
  it('replays the joined library rooms after a reconnect', () => {
    const events = usePodcastEvents()
    events.subscribeLibrary(7)
    events.subscribeLibrary(9)
    const socket = latestSocket()
    socket.emitted.length = 0

    socket.fire('connect')

    expect(socket.emitted).toEqual([
      ['subscribe:library', 7],
      ['subscribe:library', 9],
    ])
    expect(events.connected.value).toBe(true)
  })

  it('ignores a library id that could not name a room', () => {
    const events = usePodcastEvents()
    const socket = latestSocket()

    events.subscribeLibrary(0)
    events.subscribeLibrary(Number.NaN)

    expect(socket.emitted).toEqual([])
  })

  it('drops the callback when the owning scope is disposed, not only a component', () => {
    const seen: number[] = []
    const scope = effectScope()
    scope.run(() => {
      usePodcastEvents().onDownloadProgress((event) => seen.push(event.episodeId))
    })
    const socket = latestSocket()

    socket.fire('podcast:download:progress', progressEvent())
    expect(seen).toEqual([42])

    scope.stop()
    socket.fire('podcast:download:progress', progressEvent({ episodeId: 43 }))

    expect(seen).toEqual([42])
  })

  it('clears download progress on disconnect so a stale bar cannot survive the gap', () => {
    const events = usePodcastEvents()
    const socket = latestSocket()

    socket.fire('podcast:download:progress', progressEvent())
    expect(events.downloadProgress.value.get(42)).toBeTruthy()

    socket.fire('disconnect')

    expect(events.downloadProgress.value.size).toBe(0)
    expect(events.connected.value).toBe(false)
  })

  it('drops the previous user connection and its rooms on a user change', () => {
    const events = usePodcastEvents()
    events.subscribeLibrary(7)
    latestSocket().fire('podcast:download:progress', progressEvent())
    const previous = latestSocket()

    events.resetForUserChange()

    expect(previous.disconnected).toBe(true)
    expect(events.downloadProgress.value.size).toBe(0)

    // The next consumer opens a fresh connection, which re-authenticates and joins nothing.
    usePodcastEvents()
    const next = latestSocket()
    expect(next).not.toBe(previous)
    next.fire('connect')
    expect(next.emitted).toEqual([])
  })
})
