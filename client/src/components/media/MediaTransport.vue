<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, RotateCcw, RotateCw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import type { MediaTransportLabels } from './types'

const props = withDefaults(
  defineProps<{
    playing: boolean
    /** Autoplay or buffering: the main button shows a spinner but stays operable. */
    pending?: boolean
    hasPrevious: boolean
    hasNext: boolean
    skipBackSeconds: number
    skipForwardSeconds: number
    size?: 'md' | 'lg'
    /** Ring that breathes while playing; immersive surfaces only, and never under reduced motion. */
    pulse?: boolean
    labels: MediaTransportLabels
  }>(),
  { size: 'md' },
)

const emit = defineEmits<{ toggle: []; previous: []; next: []; skipBack: []; skipForward: [] }>()

const isLarge = computed(() => props.size === 'lg')
const mainLabel = computed(() => (props.playing ? props.labels.pause : props.labels.play))
const mainSizeClass = computed(() => (isLarge.value ? 'size-16' : 'size-10'))
const mainButtonClasses = computed(() => [mainSizeClass.value, isLarge.value ? 'shadow-[var(--elevation-md)]' : 'shadow-[var(--elevation-xs)]'])
// The immersive surface needs 44px+ targets; `icon-lg` alone is 40px, so large overrides it.
const sideSizeClass = computed(() => (isLarge.value ? 'size-12' : ''))
const glyphClass = computed(() => (isLarge.value ? 'size-7' : 'size-4'))
// The Button base styles clamp any un-classed svg to size-4, so icon sizing must be class-based.
const chevronClass = computed(() => (isLarge.value ? 'size-6' : 'size-[18px]'))
const skipGlyphClass = computed(() => (isLarge.value ? 'size-7' : 'size-5'))
const badgeClass = computed(() => (isLarge.value ? 'text-[11px]' : 'text-[8px]'))
const skipBackBadge = computed(() => formatNumber(props.skipBackSeconds))
const skipForwardBadge = computed(() => formatNumber(props.skipForwardSeconds))

function handleToggle() {
  emit('toggle')
}

function handlePrevious() {
  emit('previous')
}

function handleNext() {
  emit('next')
}

function handleSkipBack() {
  emit('skipBack')
}

function handleSkipForward() {
  emit('skipForward')
}
</script>

<template>
  <div class="flex items-center justify-center" :class="isLarge ? 'gap-1.5 sm:gap-2.5' : 'gap-1.5'">
    <Button
      variant="ghost"
      size="icon-lg"
      class="rounded-full text-muted-foreground hover:text-foreground"
      :class="sideSizeClass"
      :disabled="!hasPrevious"
      :aria-label="labels.previous"
      @click="handlePrevious"
    >
      <ChevronLeft :class="chevronClass" />
    </Button>
    <Button
      variant="ghost"
      size="icon-lg"
      class="relative rounded-full text-muted-foreground hover:text-foreground"
      :class="sideSizeClass"
      :aria-label="labels.back"
      @click="handleSkipBack"
    >
      <RotateCcw :class="skipGlyphClass" />
      <span class="absolute font-bold" :class="badgeClass" aria-hidden="true">{{ skipBackBadge }}</span>
    </Button>

    <span class="relative inline-flex shrink-0 items-center justify-center" :class="mainSizeClass">
      <span
        v-if="pulse && playing"
        class="pointer-events-none absolute inset-0 animate-ping rounded-full bg-primary/25 motion-reduce:hidden"
        aria-hidden="true"
        data-testid="media-transport-pulse"
      />
      <Button size="icon-lg" class="relative rounded-full" :class="mainButtonClasses" :aria-label="mainLabel" @click="handleToggle">
        <LoaderCircle v-if="pending" class="animate-spin motion-reduce:animate-none" :class="glyphClass" />
        <Pause v-else-if="playing" class="fill-current" :class="glyphClass" />
        <Play v-else class="ml-0.5 fill-current" :class="glyphClass" />
      </Button>
    </span>

    <Button
      variant="ghost"
      size="icon-lg"
      class="relative rounded-full text-muted-foreground hover:text-foreground"
      :class="sideSizeClass"
      :aria-label="labels.forward"
      @click="handleSkipForward"
    >
      <RotateCw :class="skipGlyphClass" />
      <span class="absolute font-bold" :class="badgeClass" aria-hidden="true">{{ skipForwardBadge }}</span>
    </Button>
    <Button
      variant="ghost"
      size="icon-lg"
      class="rounded-full text-muted-foreground hover:text-foreground"
      :class="sideSizeClass"
      :disabled="!hasNext"
      :aria-label="labels.next"
      @click="handleNext"
    >
      <ChevronRight :class="chevronClass" />
    </Button>
  </div>
</template>
