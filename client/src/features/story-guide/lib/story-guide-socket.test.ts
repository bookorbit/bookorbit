import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

class FakeSocket {
  connected = false
  handlers = new Map<string, Handler[]>()
  sent: { event: string; bookId: unknown; ack?: (accepted: unknown) => void }[] = []

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return this
  }

  emit(event: string, bookId: unknown, ack?: (accepted: unknown) => void) {
    this.sent.push({ event, bookId, ack })
    return this
  }

  disconnect = vi.fn<() => FakeSocket>(() => {
    this.connected = false
    return this
  })

  fire(event: string, ...args: unknown[]) {
    if (event === 'connect') this.connected = true
    if (event === 'disconnect') this.connected = false
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }

  watches(): unknown[] {
    return this.sent.filter((entry) => entry.event === 'story-guide:watch').map((entry) => entry.bookId)
  }

  answer(bookId: number, accepted: unknown) {
    const entry = [...this.sent].reverse().find((sent) => sent.event === 'story-guide:watch' && sent.bookId === bookId)
    entry?.ack?.(accepted)
  }
}

const sockets = vi.hoisted(() => ({ created: [] as unknown[] }))

vi.mock('@/lib/socket', () => ({
  createAuthenticatedSocket: () => {
    const socket = new FakeSocket()
    sockets.created.push(socket)
    return socket
  },
}))

import { disconnectStoryGuideSocket, watchStoryGuide, type StoryGuideWatcher } from './story-guide-socket'

function watcher() {
  return {
    changed: vi.fn<StoryGuideWatcher['changed']>(),
    queueChanged: vi.fn<StoryGuideWatcher['queueChanged']>(),
    live: vi.fn<StoryGuideWatcher['live']>(),
  }
}

function current(): FakeSocket {
  return sockets.created.at(-1) as FakeSocket
}

describe('story guide socket', () => {
  afterEach(() => {
    disconnectStoryGuideSocket()
    sockets.created = []
  })

  it('opens one connection, watches each book once it connects, and goes live when the server accepts', () => {
    const first = watcher()
    const second = watcher()
    watchStoryGuide(7, first)
    watchStoryGuide(9, second)
    expect(sockets.created).toHaveLength(1)
    expect(current().watches()).toEqual([])
    current().fire('connect')
    expect(current().watches()).toEqual([7, 9])
    current().answer(7, true)
    current().answer(9, false)
    expect(first.live).toHaveBeenCalledWith(true)
    expect(second.live).not.toHaveBeenCalled()
  })

  it('watches a book at once on a connected socket, and tells a second page of the same book it is already live', () => {
    const first = watcher()
    watchStoryGuide(7, first)
    current().fire('connect')
    current().answer(7, true)
    const second = watcher()
    watchStoryGuide(7, second)
    expect(current().watches()).toEqual([7])
    expect(second.live).toHaveBeenCalledWith(true)
    const third = watcher()
    watchStoryGuide(8, third)
    expect(current().watches()).toEqual([7, 8])
  })

  it('hands a change to the pages of that book only, and a queue change to every page', () => {
    const seven = watcher()
    const eight = watcher()
    watchStoryGuide(7, seven)
    watchStoryGuide(8, eight)
    current().fire('connect')
    current().fire('story-guide:changed', { bookId: 7 })
    expect(seven.changed).toHaveBeenCalledTimes(1)
    expect(eight.changed).not.toHaveBeenCalled()
    current().fire('story-guide:queue-changed')
    expect(seven.queueChanged).toHaveBeenCalledTimes(1)
    expect(eight.queueChanged).toHaveBeenCalledTimes(1)
  })

  it('is no longer live once disconnected, watches again on reconnect, and ignores an answer from the old connection', () => {
    const page = watcher()
    watchStoryGuide(7, page)
    current().fire('connect')
    const stale = current().sent[0]!
    current().fire('disconnect')
    expect(page.live).not.toHaveBeenCalled()
    stale.ack?.(true)
    expect(page.live).not.toHaveBeenCalled()
    current().fire('connect')
    current().answer(7, true)
    expect(page.live).toHaveBeenCalledWith(true)
    current().fire('disconnect')
    expect(page.live).toHaveBeenLastCalledWith(false)
    current().fire('connect')
    expect(current().watches()).toEqual([7, 7, 7])
  })

  it('unwatches once the last page of a book stops, and only then', () => {
    const first = watcher()
    const second = watcher()
    const stopFirst = watchStoryGuide(7, first)
    const stopSecond = watchStoryGuide(7, second)
    current().fire('connect')
    stopFirst()
    stopFirst()
    expect(current().sent.some((entry) => entry.event === 'story-guide:unwatch')).toBe(false)
    stopSecond()
    expect(
      current()
        .sent.filter((entry) => entry.event === 'story-guide:unwatch')
        .map((entry) => entry.bookId),
    ).toEqual([7])
    current().fire('story-guide:changed', { bookId: 7 })
    expect(first.changed).not.toHaveBeenCalled()
    expect(second.changed).not.toHaveBeenCalled()
  })

  it('closes the connection on sign-out and opens a new one for the next watch', () => {
    watchStoryGuide(7, watcher())
    const old = current()
    disconnectStoryGuideSocket()
    expect(old.disconnect).toHaveBeenCalled()
    watchStoryGuide(7, watcher())
    expect(sockets.created).toHaveLength(2)
  })
})
