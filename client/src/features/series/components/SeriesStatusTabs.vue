<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SeriesFacets } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import type { CompletionStatus } from '../types/series'

/**
 * Counts come from the server for the whole library, not from the loaded page, so the tab a
 * reader is standing on can still say what the others hold across tens of thousands of series.
 */
const props = defineProps<{
  status: CompletionStatus | null
  facets: SeriesFacets
}>()

const emit = defineEmits<{
  select: [status: CompletionStatus | null]
}>()

const { t } = useI18n()

const tabs = computed(() => [
  { value: null, label: t('series.status.all'), count: props.facets.all },
  { value: 'in_progress' as const, label: t('series.status.reading'), count: props.facets.inProgress },
  { value: 'not_started' as const, label: t('series.status.unread'), count: props.facets.notStarted },
  { value: 'complete' as const, label: t('series.status.complete'), count: props.facets.complete },
  { value: 'has_gaps' as const, label: t('series.status.gaps'), count: props.facets.hasGaps },
])

function handleSelect(value: CompletionStatus | null) {
  emit('select', value)
}
</script>

<template>
  <div class="status-tabs flex max-w-full gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" :aria-label="t('series.status.label')">
    <button
      v-for="tab in tabs"
      :key="tab.value ?? 'all'"
      type="button"
      role="tab"
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors"
      :class="props.status === tab.value ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      :aria-selected="props.status === tab.value"
      @click="handleSelect(tab.value)"
    >
      {{ tab.label }}
      <span
        class="grid h-[18px] min-w-[19px] place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
        :class="props.status === tab.value ? 'bg-primary/12 text-foreground' : 'bg-surface-4 text-muted-foreground'"
      >
        {{ formatNumber(tab.count) }}
      </span>
    </button>
  </div>
</template>

<style scoped>
/* Below the point where all five fit, the strip scrolls rather than wrapping into the layout. */
@media (max-width: 639px) {
  .status-tabs {
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent 100%);
  }

  .status-tabs::-webkit-scrollbar {
    display: none;
  }
}
</style>
