<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, Headphones, Pause, Play, SkipBack, SkipForward, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useMediaOverlay } from '../composables/useMediaOverlay'
import { useTtsMiniPlayerUi } from '@/features/tts/composables/useTtsMiniPlayerUi'
import TtsSpeedControl from '@/features/tts/components/TtsSpeedControl.vue'
import TtsSleepTimerPicker from '@/features/tts/components/TtsSleepTimerPicker.vue'
import CoverFill from '@/features/book/components/CoverFill.vue'

const { t } = useI18n()
const { isActive, isPlaying, rate, currentBook, error, sleepTimer, toggle, nextSentence, prevSentence, setRate, stop } = useMediaOverlay()
const { isReaderFooterVisible } = useTtsMiniPlayerUi()

const showPanel = ref(false)

const containerPositionClass = computed(() =>
  isReaderFooterVisible.value ? 'bottom-[calc(1rem+2.5rem)] sm:bottom-[calc(1rem+2.75rem)]' : 'bottom-4',
)

function handleSetRate(value: number) {
  setRate(value)
}

function togglePanel() {
  showPanel.value = !showPanel.value
}

function handleStop() {
  showPanel.value = false
  stop()
}
</script>

<template>
  <Transition name="slide-up">
    <div
      v-if="isActive"
      class="fixed z-50 left-1/2 -translate-x-1/2 w-[min(480px,calc(100vw-16px))] transition-[bottom] duration-300"
      :class="containerPositionClass"
    >
      <div class="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div v-if="showPanel" class="px-3 pt-3 pb-1 space-y-3">
          <TtsSpeedControl :speed="rate" @update:speed="handleSetRate" />
          <TtsSleepTimerPicker :sleepTimer="sleepTimer" />
        </div>

        <div class="flex items-center gap-2 px-3 py-2.5">
          <button
            class="flex-shrink-0 w-8 h-10 rounded bg-muted overflow-hidden flex items-center justify-center"
            :aria-label="t('reader.narration.openControls')"
            :aria-expanded="showPanel"
            @click="togglePanel"
          >
            <CoverFill v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" />
            <Headphones v-else class="w-4 h-4 text-muted-foreground" />
          </button>

          <button class="flex-1 min-w-0 text-left" :aria-label="t('reader.narration.openControls')" :aria-expanded="showPanel" @click="togglePanel">
            <div class="text-sm font-medium truncate text-foreground">{{ currentBook?.title ?? t('reader.narration.fallbackTitle') }}</div>
            <div class="text-xs text-muted-foreground truncate">{{ t('reader.narration.meta', { speed: rate }) }}</div>
          </button>

          <button
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            :aria-label="t('reader.narration.previousSentence')"
            @click="prevSentence"
          >
            <SkipBack class="w-4 h-4" />
          </button>
          <button
            class="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            :aria-label="isPlaying ? t('reader.narration.pause') : t('reader.narration.play')"
            @click="toggle"
          >
            <Pause v-if="isPlaying" class="w-4 h-4" />
            <Play v-else class="w-4 h-4" />
          </button>
          <button
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            :aria-label="t('reader.narration.nextSentence')"
            @click="nextSentence"
          >
            <SkipForward class="w-4 h-4" />
          </button>

          <button
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            :aria-label="showPanel ? t('reader.narration.hideControls') : t('reader.narration.showControls')"
            @click="togglePanel"
          >
            <ChevronDown v-if="showPanel" class="w-4 h-4" />
            <ChevronUp v-else class="w-4 h-4" />
          </button>
          <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" :aria-label="t('reader.narration.stop')" @click="handleStop">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="error" role="alert" class="px-3 pb-2 text-xs text-destructive">{{ error }}</div>
      </div>
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
