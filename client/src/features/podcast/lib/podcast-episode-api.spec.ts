// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { updateEpisodeState } from './podcast-episode-api'
import { usePodcastQueue } from '../composables/usePodcastQueue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}))

const apiMock = vi.mocked(api)

describe('updateEpisodeState dequeue notification', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('announces the dequeue that finishing an episode performs server-side', async () => {
    const listener = vi.fn<() => void>()
    const unsubscribe = usePodcastQueue().subscribe(listener)

    await updateEpisodeState(7, { finished: true })

    expect(listener).toHaveBeenCalledWith({ removedEpisodeIds: [7] })
    unsubscribe()
  })

  it('stays quiet for a write that leaves the queue alone', async () => {
    const listener = vi.fn<() => void>()
    const unsubscribe = usePodcastQueue().subscribe(listener)

    await updateEpisodeState(7, { finished: false })
    await updateEpisodeState(7, { pinned: true })
    await updateEpisodeState(7, { positionSeconds: 12 })

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not announce a dequeue the server rejected', async () => {
    apiMock.mockResolvedValue(new Response(null, { status: 500 }))
    const listener = vi.fn<() => void>()
    const unsubscribe = usePodcastQueue().subscribe(listener)

    await expect(updateEpisodeState(7, { finished: true })).rejects.toThrow('Failed to update episode')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
