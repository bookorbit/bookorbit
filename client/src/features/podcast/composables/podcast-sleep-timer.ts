import { computed, ref } from 'vue'
import type { PodcastChapter } from '@bookorbit/types'

const TICK_INTERVAL_MS = 1_000
const DEFAULT_EXTEND_MINUTES = 5

interface PodcastSleepTimerOptions {
  onExpire: (pausePlayback: boolean) => void
  onExtend: (minutes: number) => void
}

interface ChapterSleepContext {
  chapters: PodcastChapter[]
  activeChapterIndex: number
  duration: number
}

export function createPodcastSleepTimer(options: PodcastSleepTimerOptions) {
  const sleepEndsAt = ref<number | null>(null)
  const sleepEndMode = ref<'chapter' | 'episode' | null>(null)
  const sleepChapterEndAt = ref<number | null>(null)
  const sleepTimerMinutes = ref<number | null>(null)
  const sleepNow = ref(Date.now())
  const sleepRemainingSeconds = computed(() =>
    sleepEndsAt.value ? Math.max(0, Math.ceil((sleepEndsAt.value - sleepNow.value) / TICK_INTERVAL_MS)) : null,
  )
  let ticker: ReturnType<typeof setInterval> | null = null

  function setTimer(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return
    sleepEndMode.value = null
    sleepChapterEndAt.value = null
    sleepTimerMinutes.value = minutes
    const now = Date.now()
    sleepNow.value = now
    sleepEndsAt.value = now + minutes * 60_000
    startTicker()
  }

  function extendTimer(minutes = DEFAULT_EXTEND_MINUTES) {
    if (!Number.isFinite(minutes) || minutes <= 0 || sleepEndsAt.value === null) return
    const now = Date.now()
    sleepNow.value = now
    sleepEndsAt.value = Math.max(sleepEndsAt.value, now) + minutes * 60_000
    sleepTimerMinutes.value = (sleepTimerMinutes.value ?? 0) + minutes
    startTicker()
    options.onExtend(minutes)
  }

  function setAtEnd(mode: 'chapter' | 'episode', context: ChapterSleepContext) {
    if (mode === 'chapter' && context.chapters.length === 0) return
    sleepEndsAt.value = null
    sleepEndMode.value = mode
    if (mode === 'chapter') {
      const currentChapter = Math.max(0, context.activeChapterIndex)
      sleepChapterEndAt.value = context.chapters[currentChapter + 1]?.startSeconds ?? context.duration
    } else {
      sleepChapterEndAt.value = null
    }
    sleepTimerMinutes.value = null
    stopTicker()
  }

  function handlePosition(position: number) {
    const chapterEndAt = sleepChapterEndAt.value
    if (sleepEndMode.value === 'chapter' && chapterEndAt !== null && chapterEndAt > 0 && position >= chapterEndAt) expire()
  }

  function handleEpisodeEnd(): boolean {
    if (sleepEndMode.value !== 'episode' && sleepEndMode.value !== 'chapter') return false
    clear()
    options.onExpire(false)
    return true
  }

  function expire() {
    clear()
    options.onExpire(true)
  }

  function clear() {
    sleepEndsAt.value = null
    sleepEndMode.value = null
    sleepChapterEndAt.value = null
    sleepTimerMinutes.value = null
    stopTicker()
  }

  function startTicker() {
    stopTicker()
    ticker = setInterval(() => {
      const now = Date.now()
      sleepNow.value = now
      if (sleepEndsAt.value !== null && now >= sleepEndsAt.value) expire()
    }, TICK_INTERVAL_MS)
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  return {
    sleepRemainingSeconds,
    sleepEndMode,
    sleepTimerMinutes,
    setTimer,
    extendTimer,
    setAtEnd,
    handlePosition,
    handleEpisodeEnd,
    clear,
  }
}
