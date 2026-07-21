import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAudioQueue, type AudioFile } from '../useAudioQueue'

const refreshAccessTokenMock = vi.hoisted(() => vi.fn<() => Promise<string>>(() => Promise.resolve('fresh-token')))
vi.mock('@/lib/api', () => ({
  refreshAccessToken: refreshAccessTokenMock,
}))

const FILES: AudioFile[] = [
  { id: 1, format: 'mp3', durationSeconds: 100 },
  { id: 2, format: 'mp3', durationSeconds: 120 },
  { id: 3, format: 'mp3', durationSeconds: 90 },
]

function makeQueue() {
  const onFileEnd = vi.fn<(fileId: number) => void>()
  const queue = useAudioQueue(FILES, onFileEnd)
  return { queue, onFileEnd }
}

describe('useAudioQueue', () => {
  beforeEach(() => {
    refreshAccessTokenMock.mockClear()
  })

  it('sets current index and position on activateIndex', () => {
    const { queue } = makeQueue()
    queue.activateIndex(1, 5)
    expect(queue.currentIndex.value).toBe(1)
    expect(queue.currentPosition.value).toBe(5)
  })

  it('clamps index to valid range', () => {
    const { queue } = makeQueue()
    queue.activateIndex(-1, 0)
    expect(queue.currentIndex.value).toBe(0)
    queue.activateIndex(99, 0)
    expect(queue.currentIndex.value).toBe(2)
  })

  it('updates duration from file metadata', () => {
    const { queue } = makeQueue()
    queue.activateIndex(0, 0)
    expect(queue.duration.value).toBe(100)
  })

  it('advances to next track', () => {
    const { queue } = makeQueue()
    queue.activateIndex(0, 0)
    queue.nextFile()
    expect(queue.currentIndex.value).toBe(1)
  })

  it('returns to previous track', () => {
    const { queue } = makeQueue()
    queue.activateIndex(1, 0)
    queue.prevFile()
    expect(queue.currentIndex.value).toBe(0)
  })

  it('does not advance past last track', () => {
    const { queue } = makeQueue()
    queue.activateIndex(2, 0)
    queue.nextFile()
    expect(queue.currentIndex.value).toBe(2)
  })

  it('does not go before first track', () => {
    const { queue } = makeQueue()
    queue.activateIndex(0, 0)
    queue.prevFile()
    expect(queue.currentIndex.value).toBe(0)
  })
})
