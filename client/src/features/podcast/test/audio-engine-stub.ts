import { ref, type Ref } from 'vue'
import type { PodcastAudioEngineLoadOptions } from '../composables/podcast-audio-engine'

/**
 * A stand-in for `createPodcastAudioEngine`. The player's own spec has no business knowing that the
 * engine is built on Howler: what it needs is to drive the callbacks the engine promises and to read
 * back what was asked of it. Buffering and the media-element plumbing stay in the engine's own spec,
 * which is the only place that should know how they work.
 */
export interface PodcastAudioEngineStub {
  isBuffering: Ref<boolean>
  bufferedRanges: Ref<Array<{ start: number; end: number }>>
  /** The load options of the most recent `load()`, or null before the first one. */
  options: PodcastAudioEngineLoadOptions | null
  currentPosition: number
  currentRate: number
  currentVolume: number
  active: boolean
  disposed: boolean
  initCount: number
  /** What `onLoad` reports back; the engine reads it off the media element. */
  reportedDuration: number
  init: () => void
  load: (options: PodcastAudioEngineLoadOptions) => void
  play: () => void
  pause: () => void
  togglePlayback: () => void
  seek: (seconds: number) => void
  position: (fallback?: number) => number
  setRate: (rate: number) => void
  setVolume: (volume: number) => void
  playing: () => boolean
  loaded: () => boolean
  dispose: () => void
  /** Reports a successful stream load, the way the media element's `load` event does. */
  emitLoad: (duration?: number) => void
  emitEnd: () => void
  emitLoadError: () => void
  /** One engine tick, which is what drives position updates and the periodic progress write. */
  tick: (position?: number) => void
}

/** The real engine's tick interval. The player counts ticks to decide when to write progress, so a spec that advances timers has to see the same cadence. */
const TICK_INTERVAL_MS = 500

export function createPodcastAudioEngineStub() {
  const isBuffering = ref(false)
  const bufferedRanges = ref<Array<{ start: number; end: number }>>([])
  let ticker: ReturnType<typeof setInterval> | null = null

  function startTicker() {
    stopTicker()
    ticker = setInterval(() => stub.options?.onTick(stub.currentPosition), TICK_INTERVAL_MS)
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  const stub: PodcastAudioEngineStub = {
    isBuffering,
    bufferedRanges,
    options: null,
    currentPosition: 0,
    currentRate: 1,
    currentVolume: 1,
    active: false,
    disposed: false,
    initCount: 0,
    reportedDuration: 300,

    init() {
      stub.initCount++
    },
    load(options: PodcastAudioEngineLoadOptions) {
      stopTicker()
      stub.options = options
      stub.currentRate = options.rate
      stub.currentVolume = options.volume
      stub.currentPosition = 0
      stub.active = false
      stub.disposed = false
      stub.initCount++
    },
    play() {
      if (!stub.options) return
      stub.active = true
      stub.options.onPlay()
      startTicker()
    },
    pause() {
      if (!stub.options || !stub.active) return
      stub.active = false
      stopTicker()
      stub.options.onPause()
    },
    togglePlayback() {
      if (stub.active) stub.pause()
      else stub.play()
    },
    seek(seconds: number) {
      stub.currentPosition = seconds
    },
    position(fallback = 0) {
      return stub.options ? stub.currentPosition : fallback
    },
    setRate(rate: number) {
      stub.currentRate = rate
    },
    setVolume(volume: number) {
      stub.currentVolume = volume
    },
    playing() {
      return stub.active
    },
    loaded() {
      return stub.options !== null
    },
    dispose() {
      stopTicker()
      stub.options = null
      stub.active = false
      stub.disposed = true
    },

    emitLoad(duration = stub.reportedDuration) {
      stub.options?.onLoad(duration)
    },
    emitEnd() {
      stub.active = false
      stopTicker()
      stub.options?.onEnd()
    },
    emitLoadError() {
      stub.options?.onLoadError()
    },
    tick(position = stub.currentPosition) {
      stub.currentPosition = position
      stub.options?.onTick(position)
    },
  }

  return stub
}
