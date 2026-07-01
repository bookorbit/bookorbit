<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Star } from '@lucide/vue'
import { RATING_STARS, getRatingStarClass } from '@/features/book/lib/rating-stars'

const props = defineProps<{
  value: number | null
  isReadOnly?: boolean
}>()

const emit = defineEmits<{
  save: [value: number | null]
}>()

const { t } = useI18n()

const STARS = RATING_STARS
const groupRef = ref<HTMLDivElement | null>(null)

function getStarFromEvent(event: Event): number | null {
  const raw = (event.currentTarget as HTMLButtonElement | null)?.dataset.star
  const star = Number(raw)
  return Number.isInteger(star) ? star : null
}

function focusStar(star: number): void {
  groupRef.value?.querySelector<HTMLButtonElement>(`button[data-star="${star}"]`)?.focus()
}

function handleStarClick(event: Event) {
  const star = getStarFromEvent(event)
  if (props.isReadOnly || star == null) return
  emit('save', props.value === star ? null : star)
}

function handleStarKeydown(event: KeyboardEvent) {
  const star = getStarFromEvent(event)
  if (star == null) return

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusStar(Math.min(STARS.length, star + 1))
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusStar(Math.max(1, star - 1))
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handleStarClick(event)
  }
}

function getAriaLabel(star: number): string {
  return props.value === star ? t('book.table.rating.remove') : t('book.table.rating.rate', { star })
}

function getTabIndex(star: number): number {
  if (props.isReadOnly) return -1
  return star === (props.value ?? 1) ? 0 : -1
}
</script>

<template>
  <div ref="groupRef" role="group" :aria-label="t('book.table.rating.label')" class="flex items-center gap-0.5">
    <button
      v-for="star in STARS"
      :key="star"
      :data-star="star"
      :tabindex="getTabIndex(star)"
      :aria-label="getAriaLabel(star)"
      :aria-pressed="star <= (value ?? 0)"
      type="button"
      class="transition-colors"
      :class="[isReadOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110', getRatingStarClass(star, value, 'text-muted-foreground/30')]"
      @click="handleStarClick"
      @keydown="handleStarKeydown"
    >
      <Star :size="13" :fill="star <= (value ?? 0) ? 'currentColor' : 'none'" />
    </button>
  </div>
</template>
