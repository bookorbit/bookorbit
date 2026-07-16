<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Volume2, RefreshCw } from '@lucide/vue'
import type { DictionaryResult } from '@bookorbit/types'
import { useDictionary } from '../composables/useDictionary'

const { t } = useI18n()

const props = defineProps<{
  word: string
  position: { x: number; y: number; showBelow: boolean }
  lang: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { lookup } = useDictionary()

const loading = ref(true)
const result = ref<DictionaryResult | null>(null)
const notFound = ref(false)
const hasError = ref(false)
const popoverRef = ref<HTMLElement | null>(null)
const popoverStyle = ref({
  left: '0px',
  top: '0px',
})
let resizeObserver: ResizeObserver | null = null

const VIEWPORT_MARGIN = 8
const FALLBACK_WIDTH = 288
const FALLBACK_HEIGHT = 220

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function updatePopoverPosition() {
  if (typeof window === 'undefined') return

  const popoverWidth = popoverRef.value?.offsetWidth || FALLBACK_WIDTH
  const popoverHeight = popoverRef.value?.offsetHeight || FALLBACK_HEIGHT

  const desiredLeft = props.position.x - popoverWidth / 2
  const desiredTop = props.position.showBelow ? props.position.y : props.position.y - popoverHeight

  const left = clamp(desiredLeft, VIEWPORT_MARGIN, window.innerWidth - popoverWidth - VIEWPORT_MARGIN)
  const top = clamp(desiredTop, VIEWPORT_MARGIN, window.innerHeight - popoverHeight - VIEWPORT_MARGIN)

  popoverStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
  }
}

async function fetchDefinition() {
  loading.value = true
  notFound.value = false
  hasError.value = false
  result.value = null

  try {
    const res = await lookup(props.word, props.lang)
    if (res) {
      result.value = res
    } else {
      notFound.value = true
    }
  } catch {
    hasError.value = true
  } finally {
    loading.value = false
  }
}

function handleRetry() {
  fetchDefinition()
}

function playAudio(url: string) {
  new Audio(url).play().catch(() => {})
}

onMounted(async () => {
  await nextTick()
  updatePopoverPosition()
  window.addEventListener('resize', updatePopoverPosition)
  if (typeof ResizeObserver !== 'undefined' && popoverRef.value) {
    resizeObserver = new ResizeObserver(() => updatePopoverPosition())
    resizeObserver.observe(popoverRef.value)
  }
  fetchDefinition()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePopoverPosition)
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(
  () => [props.position.x, props.position.y, props.position.showBelow],
  () => {
    updatePopoverPosition()
  },
  { immediate: true },
)

watch([loading, result, notFound, hasError], async () => {
  await nextTick()
  updatePopoverPosition()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[61]" @click="emit('close')" />
    <div ref="popoverRef" class="fixed z-[62] select-none" :style="popoverStyle" @mousedown.stop @click.stop>
      <div
        class="bg-card text-card-foreground rounded-lg shadow-xl border border-border w-72 min-w-60 min-h-28 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-auto resize"
      >
        <!-- Loading -->
        <div v-if="loading" class="flex items-center gap-2 p-3">
          <div class="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
          <span class="text-sm text-muted-foreground truncate">{{ word }}</span>
        </div>

        <!-- Not found -->
        <div v-else-if="notFound" class="p-3">
          <p class="text-sm font-medium text-foreground mb-0.5">{{ word }}</p>
          <p class="text-xs text-muted-foreground">{{ t('reader.dictionary.noDefinition') }}</p>
        </div>

        <!-- Error -->
        <div v-else-if="hasError" class="p-3">
          <p class="text-sm text-destructive mb-2">{{ t('reader.dictionary.loadError') }}</p>
          <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" @click="handleRetry">
            <RefreshCw :size="12" />
            {{ t('reader.retry') }}
          </button>
        </div>

        <!-- Result -->
        <div v-else-if="result" class="p-3 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-foreground leading-tight">{{ result.word }}</span>
            <span v-if="result.phonetic" class="text-xs text-muted-foreground italic">{{ result.phonetic }}</span>
            <button
              v-if="result.audioUrl"
              class="ml-auto flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
              @click="playAudio(result.audioUrl!)"
            >
              <Volume2 :size="13" />
            </button>
          </div>

          <div v-for="entry in result.entries" :key="entry.partOfSpeech" class="space-y-1">
            <p class="text-[10px] font-medium uppercase tracking-wide text-primary">{{ entry.partOfSpeech }}</p>
            <ul class="space-y-0.5">
              <li v-for="(def, i) in entry.definitions" :key="i" class="text-xs text-foreground leading-relaxed">
                {{ def.definition }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
