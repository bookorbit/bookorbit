<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type WatchStopHandle } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Settings,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-vue-next'
import type { AudiobookChapter, BookDetail, BookDetailFile } from '@bookorbit/types'
import { api } from '@/lib/api'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'
import { bookCoverPalette } from '@/features/book/lib/book-cover'
import { useAudioProgress } from './composables/useAudioProgress'
import { useAudioQueue } from './composables/useAudioQueue'
import { useAudioSettings } from './composables/useAudioSettings'
import { useAudioBookmarks, type AudioBookmark } from './composables/useAudioBookmarks'
import { useReadingSession } from '../shared/composables/useReadingSession'

const props = defineProps<{ bookId: number; fileId: number; peekMode?: boolean }>()
const route = useRoute()
const router = useRouter()
const trackingEnabled = computed(() => !props.peekMode)

const detail = ref<BookDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const showChapters = ref(false)
const chaptersTab = ref<'chapters' | 'bookmarks'>('chapters')
const showSettings = ref(false)
const showSleepTimer = ref(false)
const showSpeedPicker = ref(false)

const sleepButtonRef = ref<HTMLButtonElement | null>(null)
const speedButtonRef = ref<HTMLButtonElement | null>(null)
const sleepPopoverStyle = ref<Record<string, string>>({})
const speedPopoverStyle = ref<Record<string, string>>({})

// Reset chapters tab to default when sheet closes
watch(showChapters, (val) => {
  if (!val) chaptersTab.value = 'chapters'
})

// ── Audio files ───────────────────────────────────────────────────────────────

const audioFiles = computed<BookDetailFile[]>(() => {
  if (!detail.value) return []
  const AUDIO_EXTS = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])
  return detail.value.files.filter((f) => f.format && AUDIO_EXTS.has(f.format.toLowerCase()))
})

// ── Progress ──────────────────────────────────────────────────────────────────

const progress = useAudioProgress(props.bookId, { trackingEnabled })

// ── Queue (created lazily after files load) ───────────────────────────────────

let queue: ReturnType<typeof useAudioQueue> | null = null
let stopQueuePlayingWatch: WatchStopHandle | null = null
const isPlaying = ref(false)
const currentPosition = ref(0)
const currentFileIndex = ref(0)

function onFileEnd(fileId: number) {
  if (!queue) return
  const endedIdx = audioFiles.value.findIndex((f) => f.id === fileId)
  const nextIdx = (endedIdx >= 0 ? endedIdx : queue.currentIndex.value) + 1
  if (nextIdx < audioFiles.value.length) {
    queue.activateIndex(nextIdx, 0)
    queue.play()
    isPlaying.value = true
    session.onActivity()
  } else {
    isPlaying.value = false
  }
}

function initQueue(startFileId: number, startPosition: number) {
  queue = useAudioQueue(
    audioFiles.value.map((f) => ({
      id: f.id,
      format: f.format,
      durationSeconds: f.durationSeconds,
    })),
    onFileEnd,
  )
  queue.goToFile(startFileId, startPosition)
  queue.setSpeed(settings.playbackSpeed.value)
  queue.setVolume(settings.volume.value)
  stopQueuePlayingWatch?.()
  stopQueuePlayingWatch = watch(
    queue.isPlaying,
    (playing) => {
      if (isPlaying.value !== playing) {
        isPlaying.value = playing
      }
    },
    { immediate: true },
  )
  syncRefs()
  currentPosition.value = startPosition
  currentFileIndex.value = queue.currentIndex.value
}

function syncRefs() {
  if (!queue) return
  isPlaying.value = queue.isPlaying.value
  currentPosition.value = queue.position()
  currentFileIndex.value = queue.currentIndex.value
  if (queue.loadError.value && !error.value) {
    error.value = queue.loadError.value
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const settings = useAudioSettings(
  (rate) => queue?.setSpeed(rate),
  (vol) => queue?.setVolume(vol),
)

// ── Bookmarks ─────────────────────────────────────────────────────────────────

const audioBookmarks = useAudioBookmarks(props.bookId)

// ── Reading session ───────────────────────────────────────────────────────────

const session = useReadingSession(props.fileId, () => ({ percentage: progressPct.value }), { trackingEnabled })

// ── Ticker (updates position every 500ms while playing) ──────────────────────

let ticker: ReturnType<typeof setInterval> | null = null
let activityTickCount = 0

function startTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    if (!queue) return
    const pos = queue.position()
    currentPosition.value = pos
    currentFileIndex.value = queue.currentIndex.value

    if (queue.isPlaying.value) {
      const fileId = audioFiles.value[queue.currentIndex.value]?.id
      if (fileId) progress.update(fileId, pos, progressPct.value)

      // Keep the reading session alive during continuous playback (every ~60s)
      activityTickCount++
      if (activityTickCount >= 120) {
        activityTickCount = 0
        session.onActivity()
      }

      // End-of-chapter sleep: pause when we advance past the chapter that was
      // active when the user set the timer.
      if (sleepAtChapterEnd.value && sleepChapterStartMs !== null) {
        const curStartMs = currentChapter.value?.startMs ?? null
        if (curStartMs !== null && curStartMs !== sleepChapterStartMs) {
          stopTicker()
          queue?.pause()
          isPlaying.value = false
          sleepAtChapterEnd.value = false
          sleepChapterStartMs = null
        }
      }
    }

    if (queue.loadError.value && !error.value) {
      error.value = queue.loadError.value
    }
  }, 500)
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
  activityTickCount = 0
}

watch(isPlaying, (val) => {
  if (val) startTicker()
  else {
    stopTicker()
    progress.flush()
  }
  updateMediaPlaybackState()
})

let mounted = true

onUnmounted(() => {
  mounted = false
  stopQueuePlayingWatch?.()
  stopQueuePlayingWatch = null
  queue?.destroy()
  stopTicker()
  progress.flush()
  cancelSleepTimer()
  document.removeEventListener('keydown', handleKey)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('seekbackward', null)
    navigator.mediaSession.setActionHandler('seekforward', null)
    navigator.mediaSession.setActionHandler('previoustrack', null)
    navigator.mediaSession.setActionHandler('nexttrack', null)
  }
})

const displayTitle = computed(() => {
  if (!detail.value) return 'Untitled'
  if (detail.value.title) return detail.value.title
  const currentFile = audioFiles.value[currentFileIndex.value]
  if (currentFile?.filename) return currentFile.filename
  return detail.value.folderPath.split('/').pop() || 'Untitled'
})

const coverSeed = computed(() => detail.value?.title ?? detail.value?.folderPath.split('/').pop() ?? String(props.bookId))
const coverPalette = computed(() => bookCoverPalette(coverSeed.value))

// ── Media Session ─────────────────────────────────────────────────────────────

watch(displayTitle, (newTitle) => {
  if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
    navigator.mediaSession.metadata.title = newTitle
  }
})

function updateMediaPlaybackState() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused'
  }
}

// ── Controls ──────────────────────────────────────────────────────────────────

function togglePlay() {
  if (!queue) return
  if (queue.isPlaying.value) {
    queue.pause()
    isPlaying.value = false
  } else {
    queue.play()
    isPlaying.value = true
    session.onActivity()
  }
}

function skipBack() {
  if (!queue) return
  queue.seek(queue.position() - settings.skipBackSeconds.value)
  session.onActivity()
  spawnSkipBubble(skipBackBtnRef.value, `-${settings.skipBackSeconds.value}s`)
}

function skipForward() {
  if (!queue) return
  queue.seek(queue.position() + settings.skipForwardSeconds.value)
  session.onActivity()
  spawnSkipBubble(skipForwardBtnRef.value, `+${settings.skipForwardSeconds.value}s`)
}

// ── Skip bubbles ──────────────────────────────────────────────────────────────

interface SkipBubble {
  id: number
  label: string
  x: number
  y: number
}

const skipBackBtnRef = ref<HTMLButtonElement | null>(null)
const skipForwardBtnRef = ref<HTMLButtonElement | null>(null)
let bubbleIdCounter = 0
const skipBubbles = ref<SkipBubble[]>([])

function spawnSkipBubble(btnEl: HTMLButtonElement | null, label: string) {
  if (!btnEl) return
  const rect = btnEl.getBoundingClientRect()
  const id = ++bubbleIdCounter
  skipBubbles.value.push({ id, label, x: rect.left + rect.width / 2, y: rect.top })
  setTimeout(() => {
    skipBubbles.value = skipBubbles.value.filter((b) => b.id !== id)
  }, 700)
}

function prevTrack() {
  if (!queue) return
  const wasPlaying = isPlaying.value
  progress.flush()
  queue.prevFile()
  if (wasPlaying) {
    queue.play()
    isPlaying.value = true
  }
  syncRefs()
  session.onActivity()
}

function nextTrack() {
  if (!queue) return
  const wasPlaying = isPlaying.value
  progress.flush()
  queue.nextFile()
  if (wasPlaying) {
    queue.play()
    isPlaying.value = true
  }
  syncRefs()
  session.onActivity()
}

function fileAndOffsetForSeconds(targetSecs: number): { fileIndex: number; posInFile: number } | null {
  let offset = 0
  for (let i = 0; i < audioFiles.value.length; i++) {
    const fileDur = audioFiles.value[i]!.durationSeconds ?? 0
    if (i === audioFiles.value.length - 1 || offset + fileDur > targetSecs) {
      return { fileIndex: i, posInFile: Math.max(0, targetSecs - offset) }
    }
    offset += fileDur
  }
  return null
}

// Shared seek: jumps to an absolute book position in seconds.
// closeSheet=true dismisses the chapter/bookmark sheet after seeking.
function seekToAbsoluteSeconds(absoluteSecs: number, closeSheet = false) {
  if (!queue || audioFiles.value.length === 0) return
  const result = fileAndOffsetForSeconds(absoluteSecs)
  if (!result) return
  const { fileIndex, posInFile } = result
  const wasPlaying = isPlaying.value
  if (fileIndex !== queue.currentIndex.value) {
    queue.activateIndex(fileIndex, posInFile)
    if (wasPlaying) {
      queue.play()
      isPlaying.value = true
    }
  } else {
    queue.seek(posInFile)
  }
  currentPosition.value = posInFile
  currentFileIndex.value = fileIndex
  if (closeSheet) showChapters.value = false
  session.onActivity()
}

function handleVolumeChange(event: Event) {
  const val = parseFloat((event.target as HTMLInputElement).value)
  settings.setVolume(val)
}

const volumeTrackStyle = computed(() => ({ '--volume-pct': Math.round(settings.volume.value * 100) + '%' }))

function selectSpeed(speed: number) {
  settings.setPlaybackSpeed(speed)
  showSpeedPicker.value = false
}

function speedDown() {
  const next = Math.round((settings.playbackSpeed.value - 0.05) * 100) / 100
  settings.setPlaybackSpeed(Math.max(0.5, next))
}

function speedUp() {
  const next = Math.round((settings.playbackSpeed.value + 0.05) * 100) / 100
  settings.setPlaybackSpeed(Math.min(3.0, next))
}

function openSleepTimer() {
  if (sleepButtonRef.value) {
    const rect = sleepButtonRef.value.getBoundingClientRect()
    const popoverWidth = 172
    const left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, rect.left + rect.width / 2 - popoverWidth / 2))
    sleepPopoverStyle.value = {
      top: rect.top + 'px',
      left: left + 'px',
      width: popoverWidth + 'px',
      transform: 'translateY(calc(-100% - 8px))',
    }
  }
  showSleepTimer.value = !showSleepTimer.value
}

function openSpeedPicker() {
  if (speedButtonRef.value) {
    const rect = speedButtonRef.value.getBoundingClientRect()
    const popoverWidth = 156
    const left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, rect.left + rect.width / 2 - popoverWidth / 2))
    speedPopoverStyle.value = {
      top: rect.top + 'px',
      left: left + 'px',
      width: popoverWidth + 'px',
      transform: 'translateY(calc(-100% - 8px))',
    }
  }
  showSpeedPicker.value = !showSpeedPicker.value
}

function seekToChapter(chapter: AudiobookChapter) {
  seekToAbsoluteSeconds(chapter.startMs / 1000, true)
}

function seekToBookmark(bm: AudioBookmark) {
  seekToAbsoluteSeconds(bm.positionSeconds, true)
}

function deleteBookmark(id: number) {
  audioBookmarks.remove(id)
}

// ── Bookmarks toggle ──────────────────────────────────────────────────────────

async function toggleBookmark() {
  const nearby = audioBookmarks.bookmarks.value.find((b) => Math.abs(b.positionSeconds - absolutePositionSeconds.value) < 5)
  if (nearby) {
    await audioBookmarks.remove(nearby.id)
  } else {
    const title = currentChapter.value?.title
      ? `${currentChapter.value.title} - ${formatTime(absolutePositionSeconds.value)}`
      : formatTime(absolutePositionSeconds.value)
    await audioBookmarks.add(absolutePositionSeconds.value, title)
  }
}

// ── Volume mute toggle ────────────────────────────────────────────────────────

const preMuteVolume = ref<number | null>(null)

function toggleMute() {
  if (settings.volume.value > 0) {
    preMuteVolume.value = settings.volume.value
    settings.setVolume(0)
  } else {
    settings.setVolume(preMuteVolume.value ?? 1)
    preMuteVolume.value = null
  }
}

// ── Sleep timer ───────────────────────────────────────────────────────────────

const sleepTimerRemaining = ref(0)
const sleepAtChapterEnd = ref(false)
let sleepChapterStartMs: number | null = null
let sleepTimerInterval: ReturnType<typeof setInterval> | null = null

const sleepTimerDisplay = computed(() => {
  if (sleepAtChapterEnd.value) return 'Ch.'
  const t = sleepTimerRemaining.value
  if (t <= 0) return null
  const m = Math.floor(t / 60)
  const s = t % 60
  return m > 0 ? `${m}m` : `${s}s`
})

const sleepTimerActive = computed(() => sleepAtChapterEnd.value || sleepTimerRemaining.value > 0)

function setSleepTimer(minutes: number) {
  showSleepTimer.value = false
  if (sleepTimerInterval) clearInterval(sleepTimerInterval)
  sleepAtChapterEnd.value = false
  sleepChapterStartMs = null
  sleepTimerRemaining.value = minutes * 60
  sleepTimerInterval = setInterval(() => {
    sleepTimerRemaining.value--
    if (sleepTimerRemaining.value <= 0) {
      clearInterval(sleepTimerInterval!)
      sleepTimerInterval = null
      queue?.pause()
    }
  }, 1000)
}

function setEndOfChapterSleep() {
  // If there are no chapters to watch, fall back to a 30-minute timer.
  if (!detail.value?.audioMetadata?.chapters?.length) {
    setSleepTimer(30)
    return
  }
  showSleepTimer.value = false
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval)
    sleepTimerInterval = null
  }
  sleepTimerRemaining.value = 0
  sleepAtChapterEnd.value = true
  sleepChapterStartMs = currentChapter.value?.startMs ?? null
}

function extendSleepTimer() {
  sleepTimerRemaining.value += 15 * 60
}

function cancelSleepTimer() {
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval)
    sleepTimerInterval = null
  }
  sleepTimerRemaining.value = 0
  sleepAtChapterEnd.value = false
  sleepChapterStartMs = null
  showSleepTimer.value = false
}

// ── Scrubber drag ─────────────────────────────────────────────────────────────

const scrubberEl = ref<HTMLDivElement | null>(null)
const scrubberHoverSeconds = ref<number | null>(null)
const isDragging = ref(false)
const dragPositionPct = ref<number | null>(null)
const scrubberProgressPct = computed(() => (dragPositionPct.value !== null ? dragPositionPct.value : progressPct.value))

function computeScrubberPct(clientX: number): number {
  if (!scrubberEl.value) return 0
  const rect = scrubberEl.value.getBoundingClientRect()
  return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
}

function handleScrubberPointerDown(e: PointerEvent) {
  if (!scrubberEl.value || !totalBookDuration.value) return
  e.preventDefault()
  isDragging.value = true
  scrubberEl.value.setPointerCapture(e.pointerId)
  dragPositionPct.value = computeScrubberPct(e.clientX) * 100
  scrubberHoverSeconds.value = (dragPositionPct.value / 100) * totalBookDuration.value
}

function handleScrubberPointerMove(e: PointerEvent) {
  if (!scrubberEl.value || !totalBookDuration.value) return
  const pct = computeScrubberPct(e.clientX)
  scrubberHoverSeconds.value = pct * totalBookDuration.value
  if (isDragging.value) dragPositionPct.value = pct * 100
}

function handleScrubberPointerUp(e: PointerEvent) {
  if (!isDragging.value || !scrubberEl.value || !totalBookDuration.value) return
  isDragging.value = false
  const pct = computeScrubberPct(e.clientX)
  dragPositionPct.value = null
  seekToAbsoluteSeconds(pct * totalBookDuration.value)
}

function handleScrubberLeave() {
  if (!isDragging.value) scrubberHoverSeconds.value = null
}

async function startTrackedReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  await nextTick()
  const fileId = audioFiles.value[currentFileIndex.value]?.id
  if (fileId) {
    progress.update(fileId, currentPosition.value, progressPct.value)
    progress.flush()
  }
  session.onActivity()
}

// ── Computed helpers ──────────────────────────────────────────────────────────

const absolutePositionSeconds = computed(() => {
  let offset = 0
  for (let i = 0; i < currentFileIndex.value; i++) {
    offset += audioFiles.value[i]!.durationSeconds ?? 0
  }
  return offset + currentPosition.value
})

const absolutePositionMs = computed(() => absolutePositionSeconds.value * 1000)

const totalBookDuration = computed(() => {
  const durationFromFiles = audioFiles.value.reduce((sum, f) => sum + (f.durationSeconds ?? 0), 0)

  if (durationFromFiles === 0) {
    return detail.value?.audioMetadata?.durationSeconds ?? 0
  }

  return durationFromFiles
})

const progressPct = computed(() => {
  const total = totalBookDuration.value
  if (!total) return 0
  return Math.min((absolutePositionSeconds.value / total) * 100, 100)
})

const chapterTicks = computed(() => {
  if (!detail.value?.audioMetadata?.chapters?.length || !totalBookDuration.value) return []
  return detail.value.audioMetadata.chapters
    .filter((ch) => ch.startMs > 0)
    .map((ch) => ({
      startMs: ch.startMs,
      title: ch.title,
      pct: Math.min((ch.startMs / 1000 / totalBookDuration.value) * 100, 100),
    }))
})

const bookmarkTicks = computed(() => {
  const total = totalBookDuration.value
  if (!total) return []
  return audioBookmarks.bookmarks.value.map((bm) => ({
    id: bm.id,
    pct: Math.min((bm.positionSeconds / total) * 100, 100),
  }))
})

const chapterDurations = computed<number[]>(() => {
  const chapters = detail.value?.audioMetadata?.chapters
  if (!chapters?.length) return []
  return chapters.map((ch, i) => {
    const nextStartMs = chapters[i + 1]?.startMs ?? totalBookDuration.value * 1000
    return Math.max(0, (nextStartMs - ch.startMs) / 1000)
  })
})

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const

const currentChapter = computed<AudiobookChapter | null>(() => {
  const chapters = detail.value?.audioMetadata?.chapters
  if (!chapters?.length) return null
  const pos = absolutePositionMs.value
  let current: AudiobookChapter | null = null
  for (const ch of chapters) {
    if (ch.startMs <= pos) current = ch
    else break
  }
  return current
})

const scrubberHoverChapter = computed<AudiobookChapter | null>(() => {
  if (scrubberHoverSeconds.value === null) return null
  const chapters = detail.value?.audioMetadata?.chapters
  if (!chapters?.length) return null
  const posMs = scrubberHoverSeconds.value * 1000
  let cur: AudiobookChapter | null = null
  for (const ch of chapters) {
    if (ch.startMs <= posMs) cur = ch
    else break
  }
  return cur
})

const isNearBookmark = computed(() => audioBookmarks.bookmarks.value.some((b) => Math.abs(b.positionSeconds - absolutePositionSeconds.value) < 5))

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleKey(e: KeyboardEvent) {
  const target = (e.composedPath?.()[0] || e.target) as HTMLElement | null
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return
  if (showChapters.value || showSettings.value || showSleepTimer.value || showSpeedPicker.value) return
  if (e.key === ' ' || e.key === 'k') {
    e.preventDefault()
    togglePlay()
  } else if (e.key === 'ArrowLeft' || e.key === 'j') {
    e.preventDefault()
    skipBack()
  } else if (e.key === 'ArrowRight' || e.key === 'l') {
    e.preventDefault()
    skipForward()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    settings.setVolume(Math.min(1, settings.volume.value + 0.1))
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    settings.setVolume(Math.max(0, settings.volume.value - 0.1))
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(async () => {
  document.addEventListener('keydown', handleKey)

  try {
    const [detailRes] = await Promise.all([
      api(`/api/v1/books/${props.bookId}`).then((r) => r.json() as Promise<BookDetail>),
      progress.load(),
      settings.init(),
    ])
    if (!mounted) return
    detail.value = detailRes
    if (detailRes.audioMetadata?.chapters) {
      detailRes.audioMetadata.chapters.sort((a, b) => a.startMs - b.startMs)
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle.value,
        artist: detailRes.authors.map((a: { name: string }) => a.name).join(', '),
        artwork: detailRes.coverSource ? [{ src: `/api/v1/books/${props.bookId}/cover`, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.setActionHandler('play', togglePlay)
      navigator.mediaSession.setActionHandler('pause', togglePlay)
      navigator.mediaSession.setActionHandler('seekbackward', skipBack)
      navigator.mediaSession.setActionHandler('seekforward', skipForward)
      navigator.mediaSession.setActionHandler('previoustrack', prevTrack)
      navigator.mediaSession.setActionHandler('nexttrack', nextTrack)
      navigator.mediaSession.playbackState = 'none'
    }
  } catch (e) {
    if (!mounted) return
    error.value = e instanceof Error ? e.message : 'Failed to load audiobook'
    loading.value = false
    return
  }

  loading.value = false

  if (!audioFiles.value.length) {
    error.value = 'No audio files found for this book.'
    return
  }

  let startFileId = props.fileId
  let startPosition = 0

  if (progress.loaded.value && progress.resumeFileId.value !== null) {
    startFileId = progress.resumeFileId.value
    startPosition = progress.resumePosition.value
  } else {
    const isAudio = audioFiles.value.some((f) => f.id === startFileId)
    if (!isAudio) startFileId = audioFiles.value[0]!.id
  }

  initQueue(startFileId, startPosition)
  void audioBookmarks.load()
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden select-none">
    <!-- Blurred cover backdrop -->
    <div class="absolute inset-0">
      <div
        v-if="detail?.coverSource"
        class="absolute inset-0 scale-110"
        :style="{ backgroundImage: `url(/api/v1/books/${props.bookId}/cover)`, backgroundSize: 'cover', backgroundPosition: 'center' }"
      />
      <div v-else class="absolute inset-0" :style="{ background: coverPalette.gradient }" />
      <div class="absolute inset-0 backdrop-blur-3xl bg-black/60" />
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="relative z-10 flex h-full items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        <p class="text-sm text-white/60">Loading audiobook...</p>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="relative z-10 flex h-full items-center justify-center p-8">
      <div class="text-center max-w-sm">
        <p class="text-sm font-medium text-white mb-2">Failed to load audiobook</p>
        <p class="text-xs text-white/50 mb-4">{{ error }}</p>
        <button class="text-sm text-white/80 underline" @click="router.back">Go back</button>
      </div>
    </div>

    <template v-else-if="detail">
      <!-- Content layer -->
      <div class="relative z-10 flex flex-col h-full text-white">
        <!-- Header -->
        <div class="flex items-center gap-2 px-3 py-3 shrink-0">
          <button class="p-2 rounded-full hover:bg-white/10 transition-colors" @click="router.back">
            <ChevronLeft class="w-5 h-5" />
          </button>
          <div class="flex-1 min-w-0 px-1">
            <p class="text-sm font-semibold truncate">{{ displayTitle }}</p>
            <p v-if="detail.audioMetadata?.narrators.length" class="text-xs text-white/55 truncate">
              {{ detail.audioMetadata.narrators.map((n) => n.name).join(', ') }}
            </p>
          </div>
          <div v-if="props.peekMode" class="flex h-8 items-center gap-1 rounded-md border border-white/20 bg-white/10 px-1.5 text-white">
            <span class="hidden text-[11px] font-medium sm:inline">Peeking</span>
            <button class="h-6 rounded-sm bg-white px-2 text-[11px] font-semibold text-black hover:bg-white/90" @click="startTrackedReading">
              Start reading
            </button>
          </div>
          <!-- Bookmark toggle -->
          <button
            class="p-2 rounded-full hover:bg-white/10 transition-colors"
            :class="isNearBookmark ? 'text-amber-400' : 'text-white/65'"
            @click="toggleBookmark"
          >
            <BookmarkCheck v-if="isNearBookmark" class="w-5 h-5" />
            <Bookmark v-else class="w-5 h-5" />
          </button>
          <button class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/65" @click="showSettings = !showSettings">
            <Settings class="w-5 h-5" />
          </button>
        </div>

        <!-- Main area -->
        <div class="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-4 overflow-hidden">
          <!-- Cover art -->
          <div class="relative shrink-0 h-[min(42vh,22rem)] w-[min(42vh,22rem)]">
            <!-- Ambient glow halo -->
            <div
              class="absolute -inset-4 rounded-2xl blur-3xl pointer-events-none transition-opacity duration-700"
              :class="isPlaying ? 'opacity-50' : 'opacity-15'"
              :style="
                detail.coverSource
                  ? { backgroundImage: `url(/api/v1/books/${props.bookId}/cover)`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: coverPalette.gradient }
              "
            />
            <!-- Cover -->
            <div class="absolute inset-0 rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl">
              <img v-if="detail.coverSource" :src="`/api/v1/books/${props.bookId}/cover`" class="w-full h-full object-cover" :alt="displayTitle" />
              <BookCoverPlaceholder
                v-else
                :title="detail.title"
                :author-line="detail.authors.map((a) => a.name).join(', ') || null"
                :is-audio="true"
                :seed="coverSeed"
              />
            </div>
          </div>

          <!-- Title / author / chapter -->
          <div class="text-center max-w-xs w-full">
            <p class="font-semibold text-lg leading-tight truncate">{{ displayTitle }}</p>
            <p v-if="detail.authors.length" class="text-sm text-white/60 mt-0.5 truncate">
              {{ detail.authors.map((a) => a.name).join(', ') }}
            </p>
            <p v-if="currentChapter" class="text-xs text-white/45 mt-1 truncate font-medium uppercase tracking-widest">
              {{ currentChapter.title }}
            </p>
          </div>

          <!-- Progress bar with chapter ticks, bookmark ticks, and hover tooltip -->
          <div class="w-full max-w-sm">
            <div
              ref="scrubberEl"
              class="relative py-3 scrubber-rail"
              @pointerdown="handleScrubberPointerDown"
              @pointermove="handleScrubberPointerMove"
              @pointerup="handleScrubberPointerUp"
              @pointerleave="handleScrubberLeave"
            >
              <!-- Hover tooltip -->
              <div
                v-if="scrubberHoverSeconds !== null"
                class="absolute -top-8 pointer-events-none flex flex-col items-center"
                :style="{ left: (scrubberHoverSeconds / (totalBookDuration || 1)) * 100 + '%', transform: 'translateX(-50%)' }"
              >
                <span class="text-xs font-semibold text-white bg-black/70 rounded px-1.5 py-0.5 whitespace-nowrap">
                  {{ formatTime(scrubberHoverSeconds) }}
                </span>
                <span v-if="scrubberHoverChapter" class="text-[10px] text-white/60 truncate max-w-[10rem] text-center">
                  {{ scrubberHoverChapter.title }}
                </span>
              </div>

              <!-- Track background + fill -->
              <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/20 pointer-events-none">
                <div class="absolute inset-y-0 left-0 rounded-full bg-white" :style="{ width: scrubberProgressPct + '%' }" />
              </div>
              <!-- Chapter tick marks -->
              <div
                v-for="tick in chapterTicks"
                :key="tick.startMs"
                class="absolute top-1/2 w-[1.5px] h-[7px] -translate-y-1/2 -translate-x-1/2 bg-white/35 rounded-full pointer-events-none"
                :style="{ left: tick.pct + '%' }"
              />
              <!-- Bookmark tick marks -->
              <div
                v-for="tick in bookmarkTicks"
                :key="tick.id"
                class="absolute top-1/2 w-[1.5px] h-[7px] -translate-y-1/2 -translate-x-1/2 bg-amber-400/80 rounded-full pointer-events-none"
                :style="{ left: tick.pct + '%' }"
              />
              <!-- Thumb -->
              <div
                class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white pointer-events-none scrubber-thumb"
                :class="{ 'scrubber-thumb-dragging': isDragging }"
                :style="{ left: scrubberProgressPct + '%' }"
              />
            </div>
            <div class="flex justify-between text-xs text-white/45 -mt-1 tabular-nums">
              <span>{{ formatTime(absolutePositionSeconds) }}</span>
              <span>-{{ formatTime(Math.max(0, totalBookDuration - absolutePositionSeconds)) }}</span>
            </div>
          </div>

          <!-- Transport controls -->
          <div class="flex items-center gap-3">
            <!-- Prev track -->
            <button
              class="w-10 h-10 flex items-center justify-center rounded-full transition-colors"
              :class="currentFileIndex === 0 ? 'opacity-25 cursor-not-allowed' : 'hover:bg-white/10'"
              :disabled="currentFileIndex === 0"
              @click="prevTrack"
            >
              <ChevronLeft class="w-6 h-6" />
            </button>

            <!-- Skip back with seconds overlay -->
            <button
              ref="skipBackBtnRef"
              class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              @click="skipBack"
            >
              <span class="relative inline-flex items-center justify-center w-7 h-7">
                <RotateCcw class="w-full h-full" />
                <span class="absolute text-[8px] font-bold leading-none mt-0.5">{{ settings.skipBackSeconds.value }}</span>
              </span>
            </button>

            <!-- Play / Pause with pulse ring -->
            <div class="relative w-16 h-16 flex items-center justify-center shrink-0">
              <div v-if="isPlaying" class="absolute inset-0 rounded-full bg-white/20 play-pulse-ring pointer-events-none" />
              <button
                class="relative w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-transform duration-150 z-10"
                @click="togglePlay"
              >
                <Pause v-if="isPlaying" class="w-6 h-6" />
                <Play v-else class="w-6 h-6 ml-0.5" />
              </button>
            </div>

            <!-- Skip forward with seconds overlay -->
            <button
              ref="skipForwardBtnRef"
              class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              @click="skipForward"
            >
              <span class="relative inline-flex items-center justify-center w-7 h-7">
                <RotateCw class="w-full h-full" />
                <span class="absolute text-[8px] font-bold leading-none mt-0.5">{{ settings.skipForwardSeconds.value }}</span>
              </span>
            </button>

            <!-- Next track -->
            <button
              class="w-10 h-10 flex items-center justify-center rounded-full transition-colors"
              :class="currentFileIndex >= audioFiles.length - 1 ? 'opacity-25 cursor-not-allowed' : 'hover:bg-white/10'"
              :disabled="currentFileIndex >= audioFiles.length - 1"
              @click="nextTrack"
            >
              <ChevronRight class="w-6 h-6" />
            </button>
          </div>

          <!-- Utility row: speed · chapters · volume · sleep -->
          <div class="flex items-center justify-around w-full max-w-sm">
            <!-- Speed picker button -->
            <button
              ref="speedButtonRef"
              class="flex flex-col items-center gap-1 px-4 py-2 rounded-2xl hover:bg-white/10 transition-colors"
              :class="showSpeedPicker ? 'bg-white/15 text-white' : 'text-white/65'"
              @click="openSpeedPicker"
            >
              <span class="flex items-center gap-1 text-sm font-bold leading-5">
                {{ settings.playbackSpeed.value }}x
                <ChevronUp v-if="showSpeedPicker" class="w-3 h-3 text-white/55" />
                <ChevronDown v-else class="w-3 h-3 text-white/55" />
              </span>
              <span class="text-[10px] font-medium tracking-wide">Speed</span>
            </button>

            <!-- Chapters / Bookmarks -->
            <button
              class="flex flex-col items-center gap-1 px-4 py-2 rounded-2xl hover:bg-white/10 transition-colors text-white/65"
              @click="showChapters = !showChapters"
            >
              <BookOpen class="w-5 h-5" />
              <span class="text-[10px] font-medium tracking-wide">Chapters</span>
            </button>

            <!-- Volume mute toggle -->
            <button
              class="flex flex-col items-center gap-1 px-4 py-2 rounded-2xl hover:bg-white/10 transition-colors"
              :class="settings.volume.value === 0 ? 'text-white' : 'text-white/65'"
              @click="toggleMute"
            >
              <VolumeX v-if="settings.volume.value === 0" class="w-5 h-5" />
              <Volume1 v-else-if="settings.volume.value < 0.5" class="w-5 h-5" />
              <Volume2 v-else class="w-5 h-5" />
              <span class="text-[10px] font-medium tracking-wide">{{ settings.volume.value === 0 ? 'Muted' : 'Volume' }}</span>
            </button>

            <!-- Sleep timer -->
            <div class="relative">
              <button
                ref="sleepButtonRef"
                class="flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-colors"
                :class="sleepTimerActive ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/65'"
                @click="openSleepTimer"
              >
                <Moon class="w-5 h-5" />
                <span class="text-[10px] font-medium tracking-wide">
                  {{ sleepTimerDisplay ? sleepTimerDisplay : 'Sleep' }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Sleep timer picker -->
      <Transition name="fade">
        <div v-if="showSleepTimer" class="absolute inset-0 z-30" @click="showSleepTimer = false">
          <div class="absolute bg-black/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl" :style="sleepPopoverStyle" @click.stop>
            <p class="text-[10px] font-semibold text-white/50 uppercase tracking-widest px-2 mb-2">Sleep timer</p>
            <div class="flex flex-col gap-0.5">
              <button
                v-for="mins in [15, 30, 45, 60]"
                :key="mins"
                class="text-sm text-left px-3 py-2 rounded-lg transition-colors hover:bg-white/10 text-white"
                @click="setSleepTimer(mins)"
              >
                {{ mins }} minutes
              </button>
              <button
                class="text-sm text-left px-3 py-2 rounded-lg transition-colors text-white"
                :class="detail?.audioMetadata?.chapters?.length ? 'hover:bg-white/10' : 'opacity-40 cursor-not-allowed'"
                :disabled="!detail?.audioMetadata?.chapters?.length"
                :title="!detail?.audioMetadata?.chapters?.length ? 'No chapters available' : undefined"
                @click="setEndOfChapterSleep"
              >
                End of chapter
              </button>
              <template v-if="sleepTimerActive">
                <div class="border-t border-white/10 my-1" />
                <button
                  v-if="sleepTimerRemaining > 0"
                  class="text-sm text-left px-3 py-2 rounded-lg transition-colors hover:bg-white/10 text-white/70 w-full"
                  @click="extendSleepTimer"
                >
                  + 15 minutes
                </button>
                <button
                  class="text-sm text-left px-3 py-2 rounded-lg transition-colors hover:bg-white/10 text-red-400 w-full"
                  @click="cancelSleepTimer"
                >
                  Cancel
                  <span v-if="sleepTimerDisplay && !sleepAtChapterEnd">({{ sleepTimerDisplay }} left)</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Speed picker popover -->
      <Transition name="fade">
        <div v-if="showSpeedPicker" class="absolute inset-0 z-30" @click="showSpeedPicker = false">
          <div class="absolute bg-black/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl" :style="speedPopoverStyle" @click.stop>
            <p class="text-[10px] font-semibold text-white/50 uppercase tracking-widest px-2 mb-2">Playback speed</p>
            <!-- Fine-grained stepper -->
            <div class="flex items-center justify-between px-2 mb-2 gap-2">
              <button
                class="w-7 h-7 flex items-center justify-center rounded-full transition-colors text-white disabled:opacity-30 bg-primary/15 hover:bg-primary/30"
                :disabled="settings.playbackSpeed.value <= 0.5"
                @click="speedDown"
              >
                <Minus class="w-3.5 h-3.5" />
              </button>
              <span class="text-sm font-bold text-white tabular-nums w-10 text-center">{{ settings.playbackSpeed.value }}x</span>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-full transition-colors text-white disabled:opacity-30 bg-primary/15 hover:bg-primary/30"
                :disabled="settings.playbackSpeed.value >= 3.0"
                @click="speedUp"
              >
                <Plus class="w-3.5 h-3.5" />
              </button>
            </div>
            <div class="border-t border-white/10 mb-1.5" />
            <!-- Preset buttons -->
            <div class="flex flex-col gap-0.5">
              <button
                v-for="speed in SPEEDS"
                :key="speed"
                class="text-sm text-left px-3 py-2 rounded-lg transition-colors font-medium"
                :class="settings.playbackSpeed.value === speed ? 'bg-primary/25 text-primary font-semibold' : 'hover:bg-white/10 text-white/70'"
                @click="selectSpeed(speed)"
              >
                {{ speed }}x
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Chapter sheet backdrop -->
      <Transition name="fade">
        <div v-if="showChapters" class="absolute inset-0 z-20 bg-black/40" @click="showChapters = false" />
      </Transition>

      <!-- Chapter / Bookmarks sheet (slide up) -->
      <Transition name="slide-up">
        <div
          v-if="showChapters"
          class="absolute inset-x-0 bottom-0 z-30 mx-auto bg-black/80 backdrop-blur-2xl rounded-t-2xl max-h-[70vh] flex flex-col border-t border-white/10 md:max-w-lg md:mb-6 md:rounded-2xl md:border"
        >
          <!-- Sheet header with tabs -->
          <div class="flex items-center justify-between px-5 py-4 shrink-0">
            <div class="flex gap-1">
              <button
                class="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                :class="chaptersTab === 'chapters' ? 'bg-primary/25 text-primary' : 'text-white/50 hover:text-white/80 hover:bg-white/10'"
                @click="chaptersTab = 'chapters'"
              >
                Chapters
              </button>
              <button
                class="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                :class="chaptersTab === 'bookmarks' ? 'bg-primary/25 text-primary' : 'text-white/50 hover:text-white/80 hover:bg-white/10'"
                @click="chaptersTab = 'bookmarks'"
              >
                Bookmarks
              </button>
            </div>
            <button class="p-1.5 hover:bg-white/10 rounded-full transition-colors" @click="showChapters = false">
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Chapters list -->
          <div v-if="chaptersTab === 'chapters'" class="flex-1 overflow-y-auto">
            <div v-if="detail.audioMetadata?.chapters?.length">
              <button
                v-for="(chapter, i) in detail.audioMetadata.chapters"
                :key="chapter.startMs"
                class="w-full text-left px-5 py-3 hover:bg-white/10 transition-colors text-sm"
                :class="currentChapter?.startMs === chapter.startMs ? 'text-white font-semibold' : 'text-white/65'"
                @click="seekToChapter(chapter)"
              >
                <span class="block truncate">{{ chapter.title }}</span>
                <span class="text-xs text-white/35 tabular-nums">
                  {{ formatTime(chapter.startMs / 1000) }}
                  <span v-if="chapterDurations[i]"> &middot; {{ formatTime(chapterDurations[i]) }}</span>
                </span>
              </button>
            </div>
            <p v-else class="text-sm text-white/45 px-5 py-6 text-center">No chapters available.</p>
          </div>

          <!-- Bookmarks list -->
          <div v-else class="flex-1 overflow-y-auto">
            <div v-if="audioBookmarks.bookmarks.value.length">
              <div
                v-for="bm in audioBookmarks.bookmarks.value"
                :key="bm.id"
                class="flex items-center gap-3 px-5 py-3 hover:bg-white/10 transition-colors group"
              >
                <button class="flex-1 text-left min-w-0" @click="seekToBookmark(bm)">
                  <span class="block text-sm text-white truncate">{{ bm.title }}</span>
                  <span class="text-xs text-white/35 tabular-nums">{{ formatTime(bm.positionSeconds) }}</span>
                </button>
                <button
                  class="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-red-400 transition-all shrink-0"
                  @click="deleteBookmark(bm.id)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div v-else class="px-5 py-8 text-center">
              <p class="text-sm text-white/45 mb-3">No bookmarks yet.</p>
              <p class="text-xs text-white/30">Tap the bookmark icon at the top to save your current position.</p>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Settings sheet backdrop -->
      <Transition name="fade">
        <div v-if="showSettings" class="absolute inset-0 z-20 bg-black/40" @click="showSettings = false" />
      </Transition>

      <!-- Settings sheet (slide up) -->
      <Transition name="slide-up">
        <div
          v-if="showSettings"
          class="absolute inset-x-0 bottom-0 z-30 mx-auto bg-black/80 backdrop-blur-2xl rounded-t-2xl border-t border-white/10 shadow-2xl p-5 md:max-w-lg md:mb-6 md:rounded-2xl md:border"
        >
          <div class="flex items-center justify-between mb-5">
            <p class="font-semibold text-sm">Player settings</p>
            <button class="p-1.5 hover:bg-white/10 rounded-full transition-colors" @click="showSettings = false">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="mb-4">
            <p class="text-[10px] font-semibold text-white/45 uppercase tracking-widest mb-2.5">Skip back</p>
            <div class="flex gap-2">
              <button
                v-for="secs in [5, 10, 15, 30]"
                :key="secs"
                class="h-8 px-3.5 text-xs rounded-full transition-colors font-medium"
                :class="settings.skipBackSeconds.value === secs ? 'bg-white text-black' : 'bg-white/10 text-white/65 hover:bg-white/20'"
                @click="() => settings.setSkipBackSeconds(secs)"
              >
                {{ secs }}s
              </button>
            </div>
          </div>
          <div class="mb-4">
            <p class="text-[10px] font-semibold text-white/45 uppercase tracking-widest mb-2.5">Skip forward</p>
            <div class="flex gap-2">
              <button
                v-for="secs in [10, 15, 30, 60]"
                :key="secs"
                class="h-8 px-3.5 text-xs rounded-full transition-colors font-medium"
                :class="settings.skipForwardSeconds.value === secs ? 'bg-white text-black' : 'bg-white/10 text-white/65 hover:bg-white/20'"
                @click="() => settings.setSkipForwardSeconds(secs)"
              >
                {{ secs }}s
              </button>
            </div>
          </div>
          <div>
            <p class="text-[10px] font-semibold text-white/45 uppercase tracking-widest mb-2.5">Volume</p>
            <div class="flex items-center gap-3">
              <VolumeX v-if="settings.volume.value === 0" class="w-4 h-4 text-white/55 shrink-0" />
              <Volume1 v-else-if="settings.volume.value < 0.5" class="w-4 h-4 text-white/55 shrink-0" />
              <Volume2 v-else class="w-4 h-4 text-white/55 shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="settings.volume.value"
                class="volume-slider flex-1"
                :style="volumeTrackStyle"
                @input="handleVolumeChange"
              />
              <span class="text-xs text-white/45 tabular-nums w-8 text-right">{{ Math.round(settings.volume.value * 100) }}%</span>
            </div>
          </div>
        </div>
      </Transition>
    </template>

    <!-- Skip bubbles -->
    <div
      v-for="bubble in skipBubbles"
      :key="bubble.id"
      class="fixed pointer-events-none z-50 select-none skip-bubble"
      :style="{ left: bubble.x + 'px', top: bubble.y + 'px' }"
    >
      {{ bubble.label }}
    </div>
  </div>
</template>

<style scoped>
/* ── Play button pulse ring ──────────────────────────────── */
@keyframes pulse-ring {
  0% {
    transform: scale(0.95);
    opacity: 0.6;
  }
  70% {
    transform: scale(1.35);
    opacity: 0;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}

.play-pulse-ring {
  animation: pulse-ring 1.8s ease-out infinite;
}

/* ── Scrubber (custom drag) ───────────────────────────────── */
.scrubber-rail {
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.scrubber-thumb {
  width: 14px;
  height: 14px;
  box-shadow:
    0 0 8px rgba(255, 255, 255, 0.5),
    0 2px 4px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition:
    opacity 0.15s,
    width 0.1s,
    height 0.1s;
}

.scrubber-rail:hover .scrubber-thumb,
.scrubber-thumb-dragging {
  opacity: 1;
}

.scrubber-thumb-dragging {
  width: 18px !important;
  height: 18px !important;
  box-shadow:
    0 0 12px rgba(255, 255, 255, 0.7),
    0 2px 6px rgba(0, 0, 0, 0.5) !important;
}

@media (hover: none) {
  .scrubber-thumb {
    opacity: 1;
  }
}

/* ── Skip bubble animation ────────────────────────────────── */
@keyframes skip-fly {
  0% {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, calc(-100% - 40px));
  }
}

.skip-bubble {
  animation: skip-fly 0.6s ease-out forwards;
  font-size: 0.8rem;
  font-weight: 700;
  color: white;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.6),
    0 0 8px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}

/* ── Volume slider ────────────────────────────────────────── */
.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 20px;
  cursor: pointer;
}

.volume-slider::-webkit-slider-runnable-track {
  height: 3px;
  background: linear-gradient(to right, white var(--volume-pct, 50%), rgba(255, 255, 255, 0.25) var(--volume-pct, 50%));
  border-radius: 9999px;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  margin-top: -4.5px;
  cursor: pointer;
}

.volume-slider::-moz-range-progress {
  background: white;
  height: 3px;
  border-radius: 9999px;
}

.volume-slider::-moz-range-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 9999px;
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  border: none;
  cursor: pointer;
}

/* ── Transitions ─────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
