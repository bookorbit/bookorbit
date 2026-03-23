<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, RotateCw, Settings, Volume2 } from 'lucide-vue-next'
import type { AudiobookChapter, BookDetail, BookDetailFile } from '@projectx/types'
import { api } from '@/lib/api'
import { useAudioProgress } from './composables/useAudioProgress'
import { useAudioQueue } from './composables/useAudioQueue'
import { useAudioSettings } from './composables/useAudioSettings'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const detail = ref<BookDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const showChapters = ref(false)
const showSettings = ref(false)

// ── Audio files ───────────────────────────────────────────────────────────────

const audioFiles = computed<BookDetailFile[]>(() => {
  if (!detail.value) return []
  const AUDIO_EXTS = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])
  return detail.value.files.filter((f) => f.format && AUDIO_EXTS.has(f.format.toLowerCase()))
})

// ── Progress ──────────────────────────────────────────────────────────────────

const progress = useAudioProgress(props.bookId)

// ── Queue (created lazily after files load) ───────────────────────────────────

let queue: ReturnType<typeof useAudioQueue> | null = null
const isPlaying = ref(false)
const currentPosition = ref(0)
const duration = ref(0)
const currentFileIndex = ref(0)

function onFileEnd(fileId: number) {
  if (!queue) return
  const endedIdx = audioFiles.value.findIndex((f) => f.id === fileId)
  const nextIdx = (endedIdx >= 0 ? endedIdx : queue.currentIndex.value) + 1
  if (nextIdx < audioFiles.value.length) {
    queue.activateIndex(nextIdx, 0)
    queue.play()
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
  // Apply saved speed and volume now that Howl instances exist.
  queue.setSpeed(settings.playbackSpeed.value)
  queue.setVolume(settings.volume.value)
  syncRefs()
}

function syncRefs() {
  if (!queue) return
  isPlaying.value = queue.isPlaying.value
  currentPosition.value = queue.position()
  duration.value = queue.duration.value
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

// ── Ticker (updates position every 500ms while playing) ──────────────────────

let ticker: ReturnType<typeof setInterval> | null = null

function startTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    if (!queue) return
    const pos = queue.position()
    currentPosition.value = pos
    isPlaying.value = queue.isPlaying.value
    duration.value = queue.duration.value
    currentFileIndex.value = queue.currentIndex.value

    if (queue.isPlaying.value) {
      const dur = queue.duration.value || 1
      const pct = Math.min((pos / dur) * 100, 100)
      const fileId = audioFiles.value[queue.currentIndex.value]?.id
      if (fileId) progress.update(fileId, pos, pct)
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
}

watch(isPlaying, (val) => {
  if (val) startTicker()
  else {
    stopTicker()
    progress.flush()
  }
})

// Destroy all Howl instances when the component unmounts. This must be at the
// top-level setup (not inside onMounted) so it registers before any await boundary.
onUnmounted(() => {
  queue?.destroy()
  stopTicker()
  progress.flush()
})

// ── Controls ──────────────────────────────────────────────────────────────────

function togglePlay() {
  if (!queue) return
  if (queue.isPlaying.value) {
    queue.pause()
  } else {
    queue.play()
  }
}

function skipBack() {
  if (!queue) return
  queue.seek(queue.position() - settings.skipBackSeconds.value)
}

function skipForward() {
  if (!queue) return
  queue.seek(queue.position() + settings.skipForwardSeconds.value)
}

function prevTrack() {
  if (!queue) return
  const wasPlaying = isPlaying.value
  progress.flush()
  queue.prevFile()
  if (wasPlaying) queue.play()
  syncRefs()
}

function nextTrack() {
  if (!queue) return
  const wasPlaying = isPlaying.value
  progress.flush()
  queue.nextFile()
  if (wasPlaying) queue.play()
  syncRefs()
}

function handleSeek(event: Event) {
  if (!queue) return
  const val = parseFloat((event.target as HTMLInputElement).value)
  queue.seek(val)
  currentPosition.value = val
}

function handleVolumeChange(event: Event) {
  const val = parseFloat((event.target as HTMLInputElement).value)
  settings.setVolume(val)
}

function seekToChapter(chapter: AudiobookChapter) {
  if (!queue || audioFiles.value.length === 0) return
  // Chapters reference absolute time across the book. Find which file contains it.
  let offset = 0
  for (let i = 0; i < audioFiles.value.length; i++) {
    const fileDur = audioFiles.value[i]!.durationSeconds ?? 0
    const startMs = chapter.startMs / 1000
    if (i === audioFiles.value.length - 1 || offset + fileDur > startMs) {
      queue.activateIndex(i, startMs - offset)
      if (!queue.isPlaying.value) queue.play()
      break
    }
    offset += fileDur
  }
  showChapters.value = false
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (showChapters.value || showSettings.value) return
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

// Absolute book position in ms, accounting for all preceding files.
const absolutePositionMs = computed(() => {
  let offset = 0
  for (let i = 0; i < currentFileIndex.value; i++) {
    offset += (audioFiles.value[i]!.durationSeconds ?? 0) * 1000
  }
  return offset + currentPosition.value * 1000
})

const currentChapter = computed<AudiobookChapter | null>(() => {
  const chapters = detail.value?.chapters
  if (!chapters?.length) return null
  const pos = absolutePositionMs.value
  let current: AudiobookChapter | null = null
  for (const ch of chapters) {
    if (ch.startMs <= pos) current = ch
    else break
  }
  return current
})

// ── Init ──────────────────────────────────────────────────────────────────────

onUnmounted(() => document.removeEventListener('keydown', handleKey))

onMounted(async () => {
  document.addEventListener('keydown', handleKey)

  try {
    const [detailRes] = await Promise.all([
      api(`/api/v1/books/${props.bookId}`).then((r) => r.json() as Promise<BookDetail>),
      progress.load(),
      settings.init(),
    ])
    detail.value = detailRes
    if (detailRes.chapters) {
      detailRes.chapters.sort((a, b) => a.startMs - b.startMs)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load audiobook'
    loading.value = false
    return
  }

  loading.value = false

  if (!audioFiles.value.length) {
    error.value = 'No audio files found for this book.'
    return
  }

  // Determine where to resume
  let startFileId = props.fileId
  let startPosition = 0

  if (progress.loaded.value && progress.resumeFileId.value !== null) {
    startFileId = progress.resumeFileId.value
    startPosition = progress.resumePosition.value
  } else {
    // Fall back to the first audio file if the provided fileId is not audio
    const isAudio = audioFiles.value.some((f) => f.id === startFileId)
    if (!isAudio) startFileId = audioFiles.value[0]!.id
  }

  initQueue(startFileId, startPosition)
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col bg-background text-foreground">
    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p class="text-sm text-muted-foreground">Loading audiobook...</p>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-sm">
        <p class="text-sm font-medium mb-2">Failed to load audiobook</p>
        <p class="text-xs text-muted-foreground mb-4">{{ error }}</p>
        <button class="text-sm text-primary underline" @click="router.back()">Go back</button>
      </div>
    </div>

    <template v-else-if="detail">
      <!-- Header -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button class="p-2 rounded-md hover:bg-muted transition-colors" @click="router.back()">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">{{ detail.title ?? 'Untitled' }}</p>
          <p v-if="detail.narrators.length" class="text-xs text-muted-foreground truncate">
            {{ detail.narrators.map((n) => n.name).join(', ') }}
          </p>
        </div>
        <button class="p-2 rounded-md hover:bg-muted transition-colors" @click="showChapters = !showChapters">
          <BookOpen class="w-5 h-5" />
        </button>
        <button class="p-2 rounded-md hover:bg-muted transition-colors" @click="showSettings = !showSettings">
          <Settings class="w-5 h-5" />
        </button>
      </div>

      <!-- Main area -->
      <div class="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-8 overflow-hidden">
        <!-- Cover -->
        <div class="w-48 h-48 sm:w-64 sm:h-64 rounded-xl overflow-hidden shadow-lg bg-muted flex items-center justify-center shrink-0">
          <img
            v-if="detail.coverSource"
            :src="`/api/v1/books/${props.bookId}/cover`"
            class="w-full h-full object-cover"
            :alt="detail.title ?? 'Cover'"
          />
          <BookOpen v-else class="w-16 h-16 text-muted-foreground opacity-40" />
        </div>

        <!-- Title block -->
        <div class="text-center max-w-md w-full">
          <p class="font-semibold text-lg leading-tight truncate">{{ detail.title ?? 'Untitled' }}</p>
          <p v-if="detail.authors.length" class="text-sm text-muted-foreground mt-0.5 truncate">
            {{ detail.authors.map((a) => a.name).join(', ') }}
          </p>
          <p v-if="currentChapter" class="text-xs text-primary mt-1 truncate">{{ currentChapter.title }}</p>
        </div>

        <!-- Progress bar -->
        <div class="w-full max-w-md">
          <input
            type="range"
            :min="0"
            :max="duration || 1"
            :value="currentPosition"
            step="1"
            class="w-full accent-primary h-1.5 cursor-pointer"
            @input="handleSeek"
          />
          <div class="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{{ formatTime(currentPosition) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <!-- Transport controls -->
        <div class="flex items-center gap-6">
          <button
            class="p-2 rounded-full hover:bg-muted transition-colors"
            :disabled="currentFileIndex === 0"
            :class="currentFileIndex === 0 ? 'opacity-30' : ''"
            @click="prevTrack"
          >
            <ChevronLeft class="w-6 h-6" />
          </button>

          <button class="p-2 rounded-full hover:bg-muted transition-colors" @click="skipBack">
            <RotateCcw class="w-6 h-6" />
            <span class="sr-only">Skip back {{ settings.skipBackSeconds.value }}s</span>
          </button>

          <button
            class="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 transition-opacity"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" class="w-7 h-7" />
            <Play v-else class="w-7 h-7 ml-0.5" />
          </button>

          <button class="p-2 rounded-full hover:bg-muted transition-colors" @click="skipForward">
            <RotateCw class="w-6 h-6" />
            <span class="sr-only">Skip forward {{ settings.skipForwardSeconds.value }}s</span>
          </button>

          <button
            class="p-2 rounded-full hover:bg-muted transition-colors"
            :disabled="currentFileIndex >= audioFiles.length - 1"
            :class="currentFileIndex >= audioFiles.length - 1 ? 'opacity-30' : ''"
            @click="nextTrack"
          >
            <ChevronRight class="w-6 h-6" />
          </button>
        </div>

        <!-- Speed + volume row -->
        <div class="flex items-center gap-6 text-sm">
          <!-- Playback speed -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-muted-foreground">Speed</span>
            <div class="flex gap-1">
              <button
                v-for="speed in [0.75, 1.0, 1.25, 1.5, 2.0]"
                :key="speed"
                class="px-2 py-0.5 text-xs rounded border transition-colors"
                :class="
                  settings.playbackSpeed.value === speed
                    ? 'border-primary text-primary bg-primary/8'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                "
                @click="settings.setPlaybackSpeed(speed)"
              >
                {{ speed }}x
              </button>
            </div>
          </div>

          <!-- Volume -->
          <div class="flex items-center gap-2">
            <Volume2 class="w-4 h-4 text-muted-foreground shrink-0" />
            <input type="range" min="0" max="1" step="0.05" :value="settings.volume.value" class="w-24 accent-primary" @input="handleVolumeChange" />
          </div>
        </div>
      </div>

      <!-- Chapter drawer -->
      <div v-if="showChapters" class="absolute inset-0 z-20 bg-background/95 backdrop-blur-sm flex flex-col">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <p class="font-semibold text-sm">Chapters</p>
          <button class="p-2 hover:bg-muted rounded-md transition-colors" @click="showChapters = false">
            <ArrowLeft class="w-5 h-5" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="detail.chapters?.length">
            <button
              v-for="chapter in detail.chapters"
              :key="chapter.startMs"
              class="w-full text-left px-4 py-3 border-b border-border hover:bg-muted transition-colors text-sm"
              :class="currentChapter?.startMs === chapter.startMs ? 'text-primary font-medium' : 'text-foreground'"
              @click="seekToChapter(chapter)"
            >
              <span class="block truncate">{{ chapter.title }}</span>
              <span class="text-xs text-muted-foreground">{{ formatTime(chapter.startMs / 1000) }}</span>
            </button>
          </div>
          <p v-else class="text-sm text-muted-foreground px-4 py-6 text-center">No chapters available.</p>
        </div>
      </div>

      <!-- Settings panel -->
      <div v-if="showSettings" class="absolute inset-x-0 bottom-0 z-20 bg-card border-t border-border rounded-t-xl shadow-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <p class="font-semibold text-sm">Player settings</p>
          <button class="p-1.5 hover:bg-muted rounded-md transition-colors" @click="showSettings = false">
            <ArrowLeft class="w-4 h-4" />
          </button>
        </div>

        <!-- Skip durations -->
        <div class="mb-4">
          <p class="text-xs text-muted-foreground mb-2">Skip back</p>
          <div class="flex gap-1.5">
            <button
              v-for="secs in [5, 10, 15, 30]"
              :key="secs"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                settings.skipBackSeconds.value === secs
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40'
              "
              @click="() => settings.setSkipBackSeconds(secs)"
            >
              {{ secs }}s
            </button>
          </div>
        </div>
        <div>
          <p class="text-xs text-muted-foreground mb-2">Skip forward</p>
          <div class="flex gap-1.5">
            <button
              v-for="secs in [10, 15, 30, 60]"
              :key="secs"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                settings.skipForwardSeconds.value === secs
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40'
              "
              @click="() => settings.setSkipForwardSeconds(secs)"
            >
              {{ secs }}s
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
