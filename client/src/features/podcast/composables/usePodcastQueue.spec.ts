import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { usePodcastQueue } from './usePodcastQueue'
import { jsonResponse } from '../test/fixtures'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}))

const apiMock = vi.mocked(api)

describe('usePodcastQueue', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('notifies subscribers after a successful queue mutation', async () => {
    const queue = usePodcastQueue()
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue()
    const unsubscribe = queue.subscribe(listener)

    await queue.add(42)

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('adds an unqueued anchor and the next episode before one invalidation', async () => {
    const queue = usePodcastQueue()
    const listener = vi.fn<() => Promise<void>>().mockResolvedValue()
    const unsubscribe = queue.subscribe(listener)

    await queue.addNext(99, { episodeId: 42, queued: false })

    expect(apiMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/podcast-episodes/42/queue',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ placement: 'end' }) }),
    )
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/podcast-episodes/99/queue',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ placement: 'next', afterEpisodeId: 42 }) }),
    )
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('does not invalidate the player when the backend mutation fails', async () => {
    apiMock.mockResolvedValue(new Response(null, { status: 500 }))
    const queue = usePodcastQueue()
    const listener = vi.fn<() => void>()
    const unsubscribe = queue.subscribe(listener)

    await expect(queue.remove(42)).rejects.toThrow('Failed to remove episode from queue')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not turn a successful queue mutation into a failure when a subscriber cannot refresh', async () => {
    const queue = usePodcastQueue()
    const unsubscribe = queue.subscribe(() => {
      throw new Error('refresh failed')
    })

    await expect(queue.add(42)).resolves.toBeUndefined()

    unsubscribe()
  })

  it('persists a reordered queue in one bulk request', async () => {
    const queue = usePodcastQueue()

    await queue.reorder([42, 7])

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-queue',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ episodeIds: [42, 7] }) }),
    )
  })

  it('clears the queue, returns the pre-clear order, and notifies subscribers', async () => {
    apiMock.mockResolvedValue(jsonResponse({ removed: 2, previousEpisodeIds: [42, 7] }))
    const queue = usePodcastQueue()
    const listener = vi.fn<() => void>()
    const unsubscribe = queue.subscribe(listener)

    await expect(queue.clear()).resolves.toEqual({ removed: 2, previousEpisodeIds: [42, 7] })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-queue', { method: 'DELETE' })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('clears played episodes from the queue', async () => {
    apiMock.mockResolvedValue(jsonResponse({ removed: 1, previousEpisodeIds: [42] }))
    const queue = usePodcastQueue()

    await expect(queue.clearFinished()).resolves.toEqual({ removed: 1, previousEpisodeIds: [42] })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-queue/finished', { method: 'DELETE' })
  })

  it('restores a cleared queue in one request', async () => {
    apiMock.mockResolvedValue(jsonResponse({ restored: 2 }))
    const queue = usePodcastQueue()
    const listener = vi.fn<() => void>()
    const unsubscribe = queue.subscribe(listener)

    await expect(queue.restore([42, 7])).resolves.toBe(2)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-queue/restore',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ episodeIds: [42, 7] }) }),
    )
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
