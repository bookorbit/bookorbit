<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ArrowLeft, Moon, Settings, Sun } from '@lucide/vue'
import { getAccessToken } from '@/lib/api'
import { useVisibility } from '../shared/composables/useVisibility'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import { useFullscreen } from '../shared/composables/useFullscreen'
import type { TxtReaderSettings } from '@bookorbit/types'
import { TXT_READER_DEFAULTS } from '@bookorbit/types'

const props = defineProps<{ bookId: number; fileId: number; peekMode?: boolean }>()
const { t } = useI18n()
const router = useRouter()
const trackingEnabled = computed(() => !props.peekMode)

const { headerVisible, handleMiddleTap, showHeader } = useVisibility()
const { isFullscreen, toggleFullscreen } = useFullscreen()

const { onActivity, elapsedMinutes } = useReadingSession(
  props.fileId,
  () => ({
    percentage: progress.percentage.value,
    pageNumber: null,
  }),
  { trackingEnabled },
)
const progress = useReaderProgress(props.bookId, props.fileId, elapsedMinutes, 0, { trackingEnabled })
const bookSettings = useReaderSettings(props.fileId, 'txt')

const loading = ref(true)
const error = ref<string | null>(null)
const content = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const showSettings = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

const settings = computed(() => ({
  ...TXT_READER_DEFAULTS,
  ...(bookSettings.effective.value as Partial<TxtReaderSettings>),
}))

const contentStyle = computed(() => ({
  fontSize: `${settings.value.fontSize}px`,
  lineHeight: String(settings.value.lineHeight),
  fontFamily: settings.value.fontFamily || 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  maxWidth: `${settings.value.maxInlineSize}px`,
  color: settings.value.isDark ? '#e2e8f0' : '#0f172a',
}))

const shellStyle = computed(() => ({
  background: settings.value.isDark ? '#0f172a' : '#f8fafc',
}))

async function loadText() {
  loading.value = true
  error.value = null
  try {
    const token = getAccessToken()
    const res = await fetch(`/api/v1/books/files/${props.fileId}/serve`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    // UTF-8 with BOM strip; fall back to latin1 for legacy Korean/ANSI-ish files
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (text.includes('\uFFFD') && bytes.length > 0) {
      text = new TextDecoder('windows-1252', { fatal: false }).decode(bytes)
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    content.value = text
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function updateProgressFromScroll() {
  const el = scrollEl.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  const pct = max <= 0 ? 100 : Math.min(100, Math.max(0, (el.scrollTop / max) * 100))
  progress.percentage.value = Math.round(pct * 10) / 10
  onActivity()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void progress.save()
  }, 800)
}

function restoreScroll() {
  const el = scrollEl.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return
  el.scrollTop = (progress.percentage.value / 100) * max
}

function goBack() {
  void progress.save()
  router.back()
}

function bumpFont(delta: number) {
  const next = Math.min(32, Math.max(12, settings.value.fontSize + delta))
  bookSettings.updateBookSettings({ fontSize: next } as Partial<TxtReaderSettings>)
}

function toggleTheme() {
  bookSettings.updateBookSettings({ isDark: !settings.value.isDark } as Partial<TxtReaderSettings>)
}

onMounted(async () => {
  await bookSettings.load()
  await progress.load()
  await loadText()
  requestAnimationFrame(() => restoreScroll())
})

onBeforeRouteLeave(() => {
  void progress.save()
})

onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer)
  void progress.save()
})

watch(
  () => progress.percentage.value,
  () => {
    /* retained for reactivity with session */
  },
)
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col" :style="shellStyle">
    <header v-show="headerVisible" class="flex items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2 text-white backdrop-blur">
      <button type="button" class="rounded p-2 hover:bg-white/10" :title="t('common.back') || 'Back'" @click="goBack">
        <ArrowLeft class="size-5" />
      </button>
      <div class="min-w-0 flex-1 truncate text-sm opacity-90">{{ t('reader.txt.title') || 'Text' }}</div>
      <button type="button" class="rounded p-2 hover:bg-white/10" @click="toggleTheme">
        <Moon v-if="!settings.isDark" class="size-5" />
        <Sun v-else class="size-5" />
      </button>
      <button type="button" class="rounded p-2 hover:bg-white/10" @click="showSettings = !showSettings">
        <Settings class="size-5" />
      </button>
    </header>

    <div v-if="showSettings" class="flex items-center gap-3 border-b border-white/10 bg-black/50 px-4 py-2 text-sm text-white">
      <button type="button" class="rounded px-2 py-1 hover:bg-white/10" @click="bumpFont(-1)">A−</button>
      <span>{{ settings.fontSize }}px</span>
      <button type="button" class="rounded px-2 py-1 hover:bg-white/10" @click="bumpFont(1)">A+</button>
      <button type="button" class="ml-auto rounded px-2 py-1 hover:bg-white/10" @click="toggleFullscreen">
        {{ isFullscreen ? 'Exit FS' : 'Fullscreen' }}
      </button>
    </div>

    <div ref="scrollEl" class="relative min-h-0 flex-1 overflow-y-auto px-4 py-6" @scroll="updateProgressFromScroll" @click="handleMiddleTap">
      <div v-if="loading" class="opacity-70">{{ t('common.loading') || 'Loading…' }}</div>
      <div v-else-if="error" class="text-red-400">{{ error }}</div>
      <pre v-else class="mx-auto whitespace-pre-wrap break-words font-serif" :style="contentStyle" @click.stop="showHeader()">{{ content }}</pre>
    </div>

    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/20">
      <div class="h-full bg-violet-500 transition-[width]" :style="{ width: `${progress.percentage.value}%` }" />
    </div>
  </div>
</template>
