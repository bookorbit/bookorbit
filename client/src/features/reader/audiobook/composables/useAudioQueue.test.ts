import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const howls: MockHowl[] = []
  class MockHowl {
    readonly options: Record<string, unknown>
    readonly handlers = new Map<string, () => void>()
    stateValue = 'unloaded'
    position = 0
    loads = 0
    plays = 0
    unloaded = false

    constructor(options: Record<string, unknown>) {
      this.options = options
      howls.push(this)
    }

    state() {
      return this.stateValue
    }
    once(event: string, handler: () => void) {
      this.handlers.set(event, handler)
      return this
    }
    load() {
      this.loads++
      this.stateValue = 'loading'
      return this
    }
    emitLoad() {
      this.stateValue = 'loaded'
      ;(this.options.onload as () => void)()
      this.handlers.get('load')?.()
    }
    emitError() {
      ;(this.options.onloaderror as (id: number, code: number) => void)(1, 4)
    }
    play() {
      this.plays++
      ;(this.options.onplay as () => void)()
      return 1
    }
    pause() {
      ;(this.options.onpause as () => void)()
      return this
    }
    seek(position?: number) {
      if (position !== undefined) this.position = position
      return this.position
    }
    duration() {
      return 600
    }
    rate() {
      return this
    }
    volume() {
      return this
    }
    stop() {
      ;(this.options.onstop as () => void)()
      return this
    }
    unload() {
      this.unloaded = true
      this.stateValue = 'unloaded'
      return this
    }
  }
  return { refresh: vi.fn<() => Promise<string>>(), howls, MockHowl }
})

vi.mock('@/lib/api', () => ({ refreshAccessToken: mocks.refresh }))
vi.mock('howler', () => ({ Howl: mocks.MockHowl }))

import { useAudioQueue } from './useAudioQueue'

const file = { assetId: 'aud_example', format: 'mp3', durationMs: 600_000 }
const contentUrl = '/api/v1/audiobooks/7/assets/aud_example/content'

function deferred() {
  let resolve!: (value: string) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<string>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('useAudioQueue media error recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.howls.length = 0
    mocks.refresh.mockReset()
  })

  it('renews the access cookie, resumes at the last known position, and preserves settings', async () => {
    mocks.refresh.mockResolvedValue('fresh-token')
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    const original = mocks.howls[0]!
    original.emitLoad()
    queue.setSpeed(1.5)
    queue.setVolume(0.4)
    queue.play()
    original.seek(143)
    expect(queue.position()).toBe(143)

    original.emitError()
    expect(queue.isPlaying.value).toBe(false)
    expect(queue.position()).toBe(143)
    await flushPromises()

    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(original.unloaded).toBe(true)
    const retry = mocks.howls[1]!
    expect(retry.options).toMatchObject({ src: [contentUrl], rate: 1.5, volume: 0.4 })
    expect(retry.loads).toBe(1)
    retry.emitLoad()
    expect(retry.position).toBe(143)
    expect(retry.plays).toBe(1)
    expect(queue.isPlaying.value).toBe(true)
    expect(queue.loadError.value).toBeNull()
  })

  it('surfaces a failed refresh without resetting the resume position', async () => {
    mocks.refresh.mockRejectedValue(new Error('refresh failed'))
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    mocks.howls[0]!.emitError()
    await flushPromises()

    expect(mocks.howls).toHaveLength(1)
    expect(queue.position()).toBe(120)
    expect(queue.isPlaying.value).toBe(false)
    expect(queue.loadError.value).toBe('Failed to load audio file')
  })

  it('does not refresh indefinitely when the retried media load also fails', async () => {
    mocks.refresh.mockResolvedValue('fresh-token')
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    mocks.howls[0]!.emitError()
    await flushPromises()
    mocks.howls[1]!.emitError()

    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.howls).toHaveLength(2)
    expect(queue.position()).toBe(120)
    expect(queue.loadError.value).toBe('Failed to load audio file')
  })

  it('can recover a later expiry after playback has successfully reloaded', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mocks.refresh.mockResolvedValue('fresh-token')
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    mocks.howls[0]!.emitError()
    await flushPromises()
    mocks.howls[1]!.emitLoad()

    now.mockReturnValue(1_006_000)
    mocks.howls[1]!.emitError()
    await flushPromises()

    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.howls).toHaveLength(3)
    expect(queue.loadError.value).toBeNull()
  })

  it('does not resume playback if the user pauses while credentials refresh', async () => {
    const pending = deferred()
    mocks.refresh.mockReturnValue(pending.promise)
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    const original = mocks.howls[0]!
    original.emitLoad()
    queue.play()
    original.emitError()
    queue.pause()
    pending.resolve('fresh-token')
    await flushPromises()
    const retry = mocks.howls[1]!
    retry.emitLoad()

    expect(retry.position).toBe(120)
    expect(retry.plays).toBe(0)
    expect(queue.isPlaying.value).toBe(false)
  })

  it('ignores a refresh that completes after the queue is destroyed', async () => {
    const pending = deferred()
    mocks.refresh.mockReturnValue(pending.promise)
    const queue = useAudioQueue(7, [file], vi.fn())
    queue.goToAsset(file.assetId, 120)
    mocks.howls[0]!.emitError()
    queue.destroy()
    pending.resolve('fresh-token')
    await flushPromises()

    expect(mocks.howls).toHaveLength(1)
    expect(queue.loadError.value).toBeNull()
  })

  it('does not replace a different asset after navigation during refresh', async () => {
    const pending = deferred()
    mocks.refresh.mockReturnValue(pending.promise)
    const nextFile = { assetId: 'aud_next', format: 'mp3', durationMs: 600_000 }
    const queue = useAudioQueue(7, [file, nextFile], vi.fn())
    queue.goToAsset(file.assetId, 120)
    mocks.howls[0]!.emitError()
    queue.nextFile()
    pending.resolve('fresh-token')
    await flushPromises()

    expect(queue.currentIndex.value).toBe(1)
    expect(mocks.howls).toHaveLength(2)
    expect(queue.loadError.value).toBeNull()
  })
})
