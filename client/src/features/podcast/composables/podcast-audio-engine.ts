import { ref } from 'vue'
import { Howl } from 'howler'
import { registerAudioFocusOwner, releaseAudioFocusOwner, requestAudioFocus } from '@/lib/audio-focus'

const TICK_INTERVAL_MS = 500

export interface PodcastAudioEngineLoadOptions {
  src: string
  format: string | null
  rate: number
  volume: number
  onLoad: (duration: number) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onEnd: () => void
  onLoadError: () => void
  onPlayError: () => void
  onTick: (position: number) => void
}

export function createPodcastAudioEngine() {
  const isBuffering = ref(false)
  const bufferedRanges = ref<Array<{ start: number; end: number }>>([])
  let howl: Howl | null = null
  let bufferingNode: HTMLAudioElement | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let tickHandler: ((position: number) => void) | null = null

  /**
   * Focus ownership is claimed when there is something to pause and released when there is not, so a
   * disposed engine cannot be asked to pause audio it no longer holds.
   */
  function init() {
    registerAudioFocusOwner('podcast', pause)
  }

  function load(options: PodcastAudioEngineLoadOptions) {
    dispose()
    init()
    const activeHowl = new Howl({
      src: [options.src],
      ...(options.format ? { format: [options.format] } : {}),
      html5: true,
      preload: true,
      rate: options.rate,
      volume: options.volume,
      onload() {
        if (howl !== activeHowl) return
        options.onLoad(activeHowl.duration())
      },
      onplay() {
        if (howl !== activeHowl) return
        requestAudioFocus('podcast')
        attachBufferingListeners(activeHowl)
        options.onPlay()
        startTicker(options.onTick)
      },
      onpause() {
        if (howl !== activeHowl) return
        stopTicker()
        clearBuffering()
        options.onPause()
      },
      onstop() {
        if (howl !== activeHowl) return
        stopTicker()
        clearBuffering()
        options.onStop()
      },
      onend() {
        if (howl !== activeHowl) return
        stopTicker()
        clearBuffering()
        options.onEnd()
      },
      onloaderror() {
        if (howl !== activeHowl) return
        stopTicker()
        clearBuffering()
        options.onLoadError()
      },
      onplayerror() {
        if (howl !== activeHowl) return
        stopTicker()
        clearBuffering()
        options.onPlayError()
      },
    })
    howl = activeHowl
  }

  function play() {
    howl?.play()
  }

  function pause() {
    howl?.pause()
  }

  function togglePlayback() {
    if (!howl) return
    if (howl.playing()) howl.pause()
    else howl.play()
  }

  function seek(seconds: number) {
    howl?.seek(seconds)
  }

  function position(fallback = 0): number {
    const current = howl?.seek()
    return typeof current === 'number' ? current : fallback
  }

  function setRate(rate: number) {
    howl?.rate(rate)
  }

  function setVolume(volume: number) {
    howl?.volume(volume)
  }

  function playing(): boolean {
    return howl?.playing() ?? false
  }

  function loaded(): boolean {
    return howl !== null
  }

  function dispose() {
    stopTicker()
    detachBufferingListeners()
    if (howl) howl.unload()
    howl = null
    releaseAudioFocusOwner('podcast')
  }

  function startTicker(handler: (position: number) => void) {
    stopTicker()
    tickHandler = handler
    ticker = setInterval(() => {
      readBufferedRanges()
      tickHandler?.(position())
    }, TICK_INTERVAL_MS)
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = null
    tickHandler = null
  }

  function markBuffering() {
    isBuffering.value = true
  }

  function clearBuffering() {
    isBuffering.value = false
  }

  function readBufferedRanges() {
    const node = bufferingNode
    if (!node) {
      if (bufferedRanges.value.length > 0) bufferedRanges.value = []
      return
    }
    const next: Array<{ start: number; end: number }> = []
    const buffered = node.buffered
    for (let index = 0; index < buffered.length; index++) next.push({ start: buffered.start(index), end: buffered.end(index) })
    const current = bufferedRanges.value
    const unchanged =
      next.length === current.length && next.every((range, index) => range.start === current[index]!.start && range.end === current[index]!.end)
    if (!unchanged) bufferedRanges.value = next
  }

  function attachBufferingListeners(activeHowl: Howl) {
    detachBufferingListeners()
    const node = resolveAudioNode(activeHowl)
    if (!node) return
    bufferingNode = node
    node.addEventListener('waiting', markBuffering)
    node.addEventListener('playing', clearBuffering)
    node.addEventListener('canplay', clearBuffering)
    node.addEventListener('progress', readBufferedRanges)
    readBufferedRanges()
  }

  function detachBufferingListeners() {
    if (bufferingNode) {
      bufferingNode.removeEventListener('waiting', markBuffering)
      bufferingNode.removeEventListener('playing', clearBuffering)
      bufferingNode.removeEventListener('canplay', clearBuffering)
      bufferingNode.removeEventListener('progress', readBufferedRanges)
      bufferingNode = null
    }
    isBuffering.value = false
    bufferedRanges.value = []
  }

  return {
    isBuffering,
    bufferedRanges,
    init,
    load,
    play,
    pause,
    togglePlayback,
    seek,
    position,
    setRate,
    setVolume,
    playing,
    loaded,
    dispose,
  }
}

function resolveAudioNode(activeHowl: Howl): HTMLAudioElement | null {
  const sounds = (activeHowl as unknown as { _sounds?: Array<{ _node?: unknown } | undefined> })._sounds
  const node = sounds?.[0]?._node
  return node instanceof HTMLAudioElement ? node : null
}
