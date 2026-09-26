import { ref } from 'vue'
import { i18n } from '@/i18n'
import { registerAudioFocusOwner, requestAudioFocus } from '@/lib/audio-focus'
import type { FoliateMediaOverlay } from '@/features/reader/epub/composables/useFoliate'
import { useTtsMediaSession } from '@/features/tts/composables/useTtsMediaSession'
import { useTtsSleepTimer } from '@/features/tts/composables/useTtsSleepTimer'
import type { TtsCurrentBook } from '@/features/tts/lib/tts-state'

const MIN_RATE = 0.5
const MAX_RATE = 4.0
const RATE_STEP = 0.25

const isActive = ref(false)
const isPlaying = ref(false)
const rate = ref(1.0)
const volume = ref(1.0)
const currentBook = ref<TtsCurrentBook | null>(null)
const error = ref<string | null>(null)
// The SMIL text fragment of the sentence currently being narrated, e.g.
// ".../chap02.xhtml#sentence14". Used to persist + resume the exact sentence.
const currentFragment = ref<string | null>(null)

let instance: FoliateMediaOverlay | null = null
let highlightListener: ((e: Event) => void) | null = null
let errorListener: ((e: Event) => void) | null = null

const mediaSession = useTtsMediaSession()

function detachListeners() {
  if (instance) {
    if (highlightListener) instance.removeEventListener('highlight', highlightListener)
    if (errorListener) instance.removeEventListener('error', errorListener)
  }
  highlightListener = null
  errorListener = null
}

function pause() {
  if (!instance) return
  instance.pause()
  isPlaying.value = false
  mediaSession.setPlaybackState('paused')
}

function resume() {
  if (!instance) return
  requestAudioFocus('media-overlay')
  instance.resume()
  isPlaying.value = true
  mediaSession.setPlaybackState('playing')
}

function stop() {
  if (instance) {
    instance.stop()
    detachListeners()
  }
  instance = null
  isActive.value = false
  isPlaying.value = false
  currentBook.value = null
  currentFragment.value = null
  error.value = null
  mediaSession.clearHandlers()
  mediaSession.setPlaybackState('none')
  sleepTimer.cancelTimer()
}

const sleepTimer = useTtsSleepTimer(pause)

registerAudioFocusOwner('media-overlay', () => {
  if (isPlaying.value) pause()
})

export function useMediaOverlay() {
  function nextSentence() {
    instance?.next()
  }

  function prevSentence() {
    instance?.prev()
  }

  // `mo` is the foliate MediaOverlay instance (view.mediaOverlay) and `startFn`
  // is view.startMediaOverlay - both obtained from useFoliate in the reader.
  function start<T>(mo: FoliateMediaOverlay, startFn: () => T, book: TtsCurrentBook): T {
    stop()
    requestAudioFocus('media-overlay')
    instance = mo
    currentBook.value = book
    isActive.value = true
    isPlaying.value = true
    error.value = null

    instance.setRate(rate.value)
    instance.setVolume(volume.value)

    highlightListener = (e: Event) => {
      isPlaying.value = true
      const text = (e as CustomEvent).detail?.text
      if (typeof text === 'string') currentFragment.value = text
      mediaSession.setPlaybackState('playing')
    }
    errorListener = (e: Event) => {
      const detail = (e as CustomEvent).detail
      error.value = detail instanceof Error ? detail.message : i18n.global.t('reader.narration.error')
    }
    instance.addEventListener('highlight', highlightListener)
    instance.addEventListener('error', errorListener)

    mediaSession.setMetadata(book)
    mediaSession.registerHandlers({
      play: resume,
      pause,
      previoustrack: prevSentence,
      nexttrack: nextSentence,
      stop,
    })

    return startFn()
  }

  function toggle() {
    if (!instance) return
    if (isPlaying.value) pause()
    else resume()
  }

  function setRate(newRate: number) {
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, newRate))
    rate.value = clamped
    instance?.setRate(clamped)
  }

  function setVolume(newVolume: number) {
    const clamped = Math.min(1, Math.max(0, newVolume))
    volume.value = clamped
    instance?.setVolume(clamped)
  }

  function increaseRate() {
    setRate(Math.round((rate.value + RATE_STEP) * 100) / 100)
  }

  function decreaseRate() {
    setRate(Math.round((rate.value - RATE_STEP) * 100) / 100)
  }

  return {
    isActive,
    isPlaying,
    rate,
    volume,
    currentBook,
    currentFragment,
    error,
    sleepTimer,
    start,
    toggle,
    pause,
    resume,
    stop,
    nextSentence,
    prevSentence,
    setRate,
    setVolume,
    increaseRate,
    decreaseRate,
  }
}
