<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Star } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    rating: number | null
    /** Buttons that set this read's rating; otherwise a read-only picture of it. */
    interactive?: boolean
    size?: number
    busy?: boolean
  }>(),
  { interactive: false, size: 12, busy: false },
)

const emit = defineEmits<{ rate: [rating: number | null] }>()

const { t } = useI18n()
const hovered = ref<number | null>(null)
const shown = computed(() => hovered.value ?? props.rating ?? 0)
const STARS = [1, 2, 3, 4, 5]

function handlePick(value: number) {
  if (props.busy) return
  emit('rate', props.rating === value ? null : value)
}

function handleHover(value: number) {
  hovered.value = value
}

function handleLeave() {
  hovered.value = null
}
</script>

<template>
  <span
    v-if="!interactive"
    class="inline-flex items-center gap-px"
    role="img"
    :aria-label="rating ? t('readingHistory.rating.ofFive', { rating }) : t('readingHistory.rating.notRated')"
  >
    <Star
      v-for="value in STARS"
      :key="value"
      :size="size"
      :stroke-width="1.8"
      :class="value <= (rating ?? 0) ? 'fill-current text-[var(--pill-warning)]' : 'text-muted-foreground'"
      aria-hidden="true"
    />
  </span>
  <span v-else class="inline-flex items-center" role="group" :aria-label="t('readingHistory.rating.group')" @pointerleave="handleLeave">
    <button
      v-for="value in STARS"
      :key="value"
      type="button"
      class="grid place-items-center rounded-xs p-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      :class="value <= shown ? 'text-[var(--pill-warning)]' : 'text-muted-foreground hover:text-foreground'"
      :aria-label="rating === value ? t('readingHistory.rating.clear') : t('readingHistory.rating.rate', { count: value })"
      :aria-pressed="rating === value"
      :disabled="busy"
      @pointerenter="handleHover(value)"
      @click="handlePick(value)"
    >
      <Star :size="size" :stroke-width="1.8" :class="value <= shown ? 'fill-current' : undefined" aria-hidden="true" />
    </button>
  </span>
</template>
