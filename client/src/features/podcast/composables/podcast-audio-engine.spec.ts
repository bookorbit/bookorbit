import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAudioFocusOwner, releaseAudioFocusOwner, requestAudioFocus } from '@/lib/audio-focus'
import { stubBufferedRanges } from '../test/stubs'
import { createPodcastAudioEngine, type PodcastAudioEngineLoadOptions } from './podcast-audio-engine'

interface MockHowlOptions {
  onload?: () => void
  onplay?: () => void
  onpause?: () => void
  onstop?: () => void
  onend?: () => void
  onloaderror?: () => void
  onplayerror?: () => void
}

interface MockHowlInstance {
  options: MockHowlOptions
  currentPosition: number
  active: boolean
  unloaded: boolean
  _sounds: Array<{ _node: HTMLAudioElement }>
}

const howlInstances = vi.hoisted(() => [] as MockHowlInstance[])

vi.mock('howler', () => ({
  Howl: class {
    currentPosition = 0
    active = false
    unloaded = false
    _sounds = [{ _node: document.createElement('audio') }]

    constructor(public options: MockHowlOptions) {
      howlInstances.push(this)
    }

    duration() {
      return 300
    }

    seek(value?: number) {
      if (typeof value === 'number') this.currentPosition = value
      return this.currentPosition
    }

    playing() {
      return this.active
    }

    play() {
      this.active = true
      this.options.onplay?.()
    }

    pause() {
      this.active = false
      this.options.onpause?.()
    }

    rate() {}
    volume() {}

    unload() {
      this.active = false
      this.unloaded = true
    }
  },
}))

describe('createPodcastAudioEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    howlInstances.length = 0
  })

  afterEach(() => {
    releaseAudioFocusOwner('tts')
    vi.useRealTimers()
  })

  it('keeps one Howl active and ignores callbacks from the disposed engine', () => {
    const engine = createPodcastAudioEngine()
    const first = loadOptions()
    const second = loadOptions()

    engine.load(first)
    const stale = howlInstances[0]!
    engine.load(second)
    stale.options.onload?.()

    expect(stale.unloaded).toBe(true)
    expect(howlInstances).toHaveLength(2)
    expect(first.onLoad).not.toHaveBeenCalled()
    howlInstances[1]!.options.onload?.()
    expect(second.onLoad).toHaveBeenCalledWith(300)
  })

  it('claims audio focus and reports playback positions on one ticker', async () => {
    const pauseTts = vi.fn<() => void>()
    registerAudioFocusOwner('tts', pauseTts)
    const engine = createPodcastAudioEngine()
    const options = loadOptions()
    engine.load(options)
    const howl = howlInstances[0]!
    howl.currentPosition = 75

    engine.play()
    await vi.advanceTimersByTimeAsync(500)

    expect(pauseTts).toHaveBeenCalledOnce()
    expect(options.onPlay).toHaveBeenCalledOnce()
    expect(options.onTick).toHaveBeenCalledWith(75)
    expect(vi.getTimerCount()).toBe(1)

    engine.pause()
    expect(options.onPause).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('detaches buffering listeners and ranges from the previous media element', () => {
    const engine = createPodcastAudioEngine()
    engine.load(loadOptions())
    const first = howlInstances[0]!
    engine.play()
    first._sounds[0]!._node.dispatchEvent(new Event('waiting'))
    expect(engine.isBuffering.value).toBe(true)

    engine.load(loadOptions())
    first._sounds[0]!._node.dispatchEvent(new Event('waiting'))

    expect(engine.isBuffering.value).toBe(false)
    expect(engine.bufferedRanges.value).toEqual([])
  })

  it('mirrors buffered ranges without replacing an unchanged snapshot', () => {
    const engine = createPodcastAudioEngine()
    engine.load(loadOptions())
    const node = howlInstances[0]!._sounds[0]!._node
    stubBufferedRanges(node, [{ start: 0, end: 120 }])
    engine.play()

    expect(engine.bufferedRanges.value).toEqual([{ start: 0, end: 120 }])
    const current = engine.bufferedRanges.value
    node.dispatchEvent(new Event('progress'))
    expect(engine.bufferedRanges.value).toBe(current)
  })

  // A disposed engine holds nothing to pause, so leaving it registered would let another player's
  // focus request call into a Howl that is already unloaded.
  it('holds audio-focus ownership only between load and dispose', () => {
    const engine = createPodcastAudioEngine()
    const pauseTts = vi.fn<() => void>()

    engine.load(loadOptions())
    engine.dispose()
    registerAudioFocusOwner('tts', pauseTts)
    requestAudioFocus('tts')

    expect(howlInstances[0]!.active).toBe(false)

    engine.load(loadOptions())
    engine.play()
    expect(pauseTts).toHaveBeenCalledOnce()
  })
})

function loadOptions(): PodcastAudioEngineLoadOptions {
  return {
    src: '/stream',
    format: 'mp3',
    rate: 1,
    volume: 1,
    onLoad: vi.fn<(duration: number) => void>(),
    onPlay: vi.fn<() => void>(),
    onPause: vi.fn<() => void>(),
    onStop: vi.fn<() => void>(),
    onEnd: vi.fn<() => void>(),
    onLoadError: vi.fn<() => void>(),
    onPlayError: vi.fn<() => void>(),
    onTick: vi.fn<(position: number) => void>(),
  }
}
