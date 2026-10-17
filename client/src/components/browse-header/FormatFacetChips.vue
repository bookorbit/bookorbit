<script setup lang="ts">
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import type { BookFormatFacet } from '@bookorbit/types'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { formatNumber } from '@/i18n/formatters'
import { facetChip } from './browse-header'

const props = defineProps<{
  facets: BookFormatFacet[]
  selected: string[]
}>()

const emit = defineEmits<{
  toggle: [format: string]
}>()

/** A picked format whose count dropped to nothing still needs its chip, or it could not be unpicked. */
const chips = computed(() => {
  const listed = new Set(props.facets.map((facet) => facet.format as string))
  const missing = props.selected.filter((format) => !listed.has(format)).map((format) => ({ format, count: 0 }))
  return [...props.facets.map((facet) => ({ format: facet.format as string, count: facet.count })), ...missing]
})

function handleToggle(format: string) {
  emit('toggle', format)
}
</script>

<template>
  <button
    v-for="chip in chips"
    :key="chip.format"
    type="button"
    :class="cn(facetChip, 'ps-1.5')"
    :aria-pressed="selected.includes(chip.format)"
    @click="handleToggle(chip.format)"
  >
    <BookFormatChip :format-key="chip.format" class="h-4 rounded px-1 text-[9.5px] leading-none tracking-[0.04em]" />
    <span class="tabular-nums" :class="selected.includes(chip.format) ? 'text-primary' : 'text-muted-foreground'">{{
      formatNumber(chip.count)
    }}</span>
  </button>
</template>
