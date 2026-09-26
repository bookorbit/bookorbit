<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateMatchReason } from '@bookorbit/types'

import { formatPercent } from '@/i18n/formatters'

const props = withDefaults(
  defineProps<{
    reason: BookDuplicateMatchReason
    /** Shown on the similar-title chip, where the score is the whole point of the match. */
    similarity?: number | null
    quiet?: boolean
    short?: boolean
  }>(),
  { similarity: null, quiet: false, short: false },
)

const { t } = useI18n()

/**
 * Four reasons, four certainties: an identical file set is a fact, a similar title is a guess.
 * Colour carries the ladder and the label repeats it, so the ranking never rests on hue alone.
 */
const REASON_COLORS: Record<BookDuplicateMatchReason, string> = {
  file_hash: 'var(--pill-success)',
  isbn: 'var(--pill-info)',
  exact_metadata: 'var(--pill-source-indigo)',
  fuzzy_metadata: 'var(--pill-warning)',
}

const color = computed(() => REASON_COLORS[props.reason])
const label = computed(() => {
  const key = props.short ? `tools.bookDuplicates.confidence.${props.reason}` : `tools.bookDuplicates.reasons.${props.reason}`
  const text = t(key)
  if (props.reason !== 'fuzzy_metadata' || props.similarity === null) return text
  return t('tools.bookDuplicates.confidence.withSimilarity', { label: text, percent: formatPercent(props.similarity) })
})
const chipStyle = computed(() =>
  props.quiet
    ? { color: 'var(--muted-foreground)', boxShadow: 'inset 0 0 0 1px var(--border)' }
    : {
        color: color.value,
        backgroundColor: `color-mix(in oklch, ${color.value} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color.value} 34%, transparent)`,
      },
)
</script>

<template>
  <span class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap" :style="chipStyle">
    <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: color }" aria-hidden="true" />
    {{ label }}
  </span>
</template>
