<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Headphones, Pause, Play, ChevronDown, ChevronUp } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { useTtsMiniPlayerUi } from '../composables/useTtsMiniPlayerUi'
import { useTtsVoices } from '../composables/useTtsVoices'
import TtsMiniPlayerExpanded from './TtsMiniPlayerExpanded.vue'
import { formatVoiceDisplayName } from '../lib/voice-display'
import CoverFill from '@/features/book/components/CoverFill.vue'

const { playbackState, currentBook, currentBlockIndex, currentChapterIndex, speed, currentProviderId, currentVoiceId, togglePlayPause } =
  useTtsPlayer()

const { t } = useI18n()
const { mode, isReaderFooterVisible, setMode } = useTtsMiniPlayerUi()
const { allVoices, loadVoices } = useTtsVoices()
const isVisible = computed(() => playbackState.value !== 'idle')
const miniPlayerRootRef = ref<HTMLElement | null>(null)
const isMobileViewport = ref(false)
const lastCompactMode = ref<'micro' | 'mini'>('mini')
const compactModeCustomized = ref(false)

const MOBILE_BREAKPOINT_PX = 640
const MIN_TOAST_BOTTOM_GAP_PX = 12
const TOAST_CLEARANCE_CSS_VAR = '--tts-mini-player-clearance'
let resizeObserver: ResizeObserver | null = null

const containerPositionClass = computed(() => {
  if (mode.value === 'micro') {
    return isReaderFooterVisible.value ? 'bottom-[calc(1.75rem+2.5rem)] sm:bottom-[calc(1.75rem+2.75rem)]' : 'bottom-7'
  }

  return isReaderFooterVisible.value ? 'bottom-[calc(1rem+2.5rem)] sm:bottom-[calc(1rem+2.75rem)]' : 'bottom-4'
})

const containerWidthClass = computed(() => {
  if (mode.value === 'expanded') return 'w-[min(520px,calc(100vw-16px))]'
  if (mode.value === 'micro') return 'w-auto'
  return 'w-[min(480px,calc(100vw-16px))]'
})

const containerHorizontalClass = computed(() => {
  if (mode.value === 'micro') return 'right-4 sm:right-4'
  return 'left-1/2 -translate-x-1/2'
})

const isMicroMode = computed(() => mode.value === 'micro')
const isMiniMode = computed(() => mode.value === 'mini')

const defaultCompactMode = computed<'micro' | 'mini'>(() => (isMobileViewport.value ? 'micro' : 'mini'))

const selectedVoice = computed(() =>
  allVoices.value.find((voice) => voice.id === currentVoiceId.value && voice.providerId === currentProviderId.value),
)

const compactMeta = computed(() => {
  const voice = selectedVoice.value ? formatVoiceDisplayName(selectedVoice.value) : currentVoiceId.value
  const values = { chapter: currentChapterIndex.value + 1, sentence: currentBlockIndex.value + 1, speed: speed.value }
  return voice ? t('tts.player.meta', { ...values, voice }) : t('tts.player.metaWithoutVoice', values)
})

function updateIsMobileViewport() {
  if (typeof window === 'undefined') return
  isMobileViewport.value = window.innerWidth < MOBILE_BREAKPOINT_PX
}

function setCompactMode(nextMode: 'micro' | 'mini') {
  compactModeCustomized.value = true
  setMode(nextMode)
}

function openExpanded() {
  setMode('expanded')
}

function handleCloseExpanded() {
  setMode(compactModeCustomized.value ? lastCompactMode.value : defaultCompactMode.value)
}

function setToasterClearance(px: number) {
  if (typeof document === 'undefined') return
  const clamped = Number.isFinite(px) ? Math.max(0, Math.ceil(px)) : 0
  document.documentElement.style.setProperty(TOAST_CLEARANCE_CSS_VAR, `${clamped}px`)
}

function updateToasterClearance() {
  if (typeof window === 'undefined') return

  const root = miniPlayerRootRef.value
  if (!root || !isVisible.value) {
    setToasterClearance(0)
    return
  }

  const rect = root.getBoundingClientRect()
  if (rect.height <= 0 || rect.width <= 0) {
    setToasterClearance(0)
    return
  }

  const clearance = window.innerHeight - rect.top + MIN_TOAST_BOTTOM_GAP_PX
  setToasterClearance(clearance)
}

function attachResizeObserver() {
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!miniPlayerRootRef.value) return
  resizeObserver = new ResizeObserver(() => {
    updateToasterClearance()
  })
  resizeObserver.observe(miniPlayerRootRef.value)
}

watch(
  () => mode.value,
  (nextMode, previousMode) => {
    if ((previousMode === 'micro' || previousMode === 'mini') && nextMode === 'expanded') {
      lastCompactMode.value = previousMode
    }
  },
)

watch(
  () => isVisible.value,
  (visible) => {
    if (!visible) {
      compactModeCustomized.value = false
      if (mode.value === 'expanded') {
        setMode(lastCompactMode.value)
      }
      return
    }

    // Not on mount: this player is mounted on signed-out pages too, where a 401 would send a reset or
    // magic link to sign-in. Playback implies a session.
    if (allVoices.value.length === 0) void loadVoices()

    if (mode.value !== 'expanded' && !compactModeCustomized.value) {
      setMode(defaultCompactMode.value)
    }
  },
  { immediate: true },
)

watch(
  () => isMobileViewport.value,
  () => {
    if (mode.value === 'expanded') return
    if (compactModeCustomized.value) return
    setMode(defaultCompactMode.value)
  },
)

onMounted(() => {
  updateIsMobileViewport()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobileViewport)
    window.addEventListener('resize', updateToasterClearance)
  }

  watch(
    () => miniPlayerRootRef.value,
    () => {
      attachResizeObserver()
      void nextTick(() => {
        updateToasterClearance()
      })
    },
    { immediate: true },
  )

  watch(
    () => [isVisible.value, mode.value, isReaderFooterVisible.value] as const,
    () => {
      void nextTick(() => {
        updateToasterClearance()
      })
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobileViewport)
    window.removeEventListener('resize', updateToasterClearance)
  }
  setToasterClearance(0)
})
</script>

<template>
  <Transition name="slide-up">
    <div
      ref="miniPlayerRootRef"
      v-if="isVisible"
      class="tts-mini-player fixed z-50 transition-[bottom,width] duration-300"
      :class="[containerWidthClass, containerPositionClass, containerHorizontalClass]"
    >
      <div v-if="isMicroMode" class="relative">
        <button
          class="w-14 h-14 rounded-full border border-border bg-card text-foreground shadow-2xl flex items-center justify-center hover:bg-accent disabled:opacity-50"
          :disabled="playbackState === 'loading'"
          :aria-label="playbackState === 'playing' ? t('tts.player.pause') : t('tts.player.play')"
          @click="togglePlayPause"
        >
          <CoverFill v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" class="absolute inset-0 rounded-full opacity-20" />
          <Pause v-if="playbackState === 'playing'" class="relative w-6 h-6" />
          <Play v-else class="relative w-6 h-6" />
        </button>
        <button
          class="absolute -top-1 -left-1 w-6 h-6 rounded-full border border-border bg-card text-muted-foreground shadow-md hover:text-foreground hover:bg-accent flex items-center justify-center"
          :aria-label="t('tts.player.openMiniPlayer')"
          @click="setCompactMode('mini')"
        >
          <ChevronUp class="w-3.5 h-3.5" />
        </button>
        <div v-if="playbackState === 'loading'" class="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-8 rounded-full bg-muted overflow-hidden">
          <div class="h-full bg-primary animate-pulse w-1/2" />
        </div>
      </div>

      <div v-else-if="isMiniMode" class="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2.5">
          <button
            class="flex-shrink-0 w-8 h-10 rounded bg-muted overflow-hidden flex items-center justify-center"
            :aria-label="t('tts.player.openDetails')"
            @click="openExpanded"
          >
            <CoverFill v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" />
            <Headphones v-else class="w-4 h-4 text-muted-foreground" />
          </button>

          <button class="flex-1 min-w-0 text-left" :aria-label="t('tts.player.openDetails')" @click="openExpanded">
            <div class="text-sm font-medium truncate text-foreground">{{ currentBook?.title ?? t('tts.player.fallbackTitle') }}</div>
            <div class="text-xs text-muted-foreground truncate">{{ compactMeta }}</div>
          </button>

          <button
            class="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            :disabled="playbackState === 'loading'"
            :aria-label="playbackState === 'playing' ? t('tts.player.pause') : t('tts.player.play')"
            @click="togglePlayPause"
          >
            <Pause v-if="playbackState === 'playing'" class="w-4 h-4" />
            <Play v-else class="w-4 h-4" />
          </button>
          <button
            v-if="isMobileViewport"
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            :aria-label="t('tts.player.shrinkPlayer')"
            @click="setCompactMode('micro')"
          >
            <ChevronDown class="w-4 h-4" />
          </button>
          <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" :aria-label="t('tts.player.expandPlayer')" @click="openExpanded">
            <ChevronUp class="w-4 h-4" />
          </button>
        </div>

        <div v-if="playbackState === 'loading'" class="h-0.5 bg-muted overflow-hidden">
          <div class="h-full bg-primary animate-pulse w-1/2" />
        </div>
        <div v-if="playbackState === 'error'" role="alert" class="px-3 pb-2 text-xs text-destructive">{{ t('tts.player.playbackError') }}</div>
      </div>

      <TtsMiniPlayerExpanded v-else @close="handleCloseExpanded" />
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    opacity 0.3s ease,
    translate 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  translate: 0 100%;
  opacity: 0;
}
</style>
