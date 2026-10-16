<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SeriesFacets } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import type { CompletionStatus } from '../types/series'
import { segmentItem, segmentTrack } from '@/components/browse-header/browse-header'
import { cn } from '@/lib/utils'

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

/* Each tab wears the colour its series show on their volume bars, so the bars read without a legend. */
const tabs = computed(() => [
  { value: null, label: t('series.status.all'), count: props.facets.all, dot: null },
  { value: 'in_progress' as const, label: t('series.status.reading'), count: props.facets.inProgress, dot: 'bg-volume-reading' },
  {
    value: 'not_started' as const,
    label: t('series.status.unread'),
    count: props.facets.notStarted,
    dot: 'ring-[1.5px] ring-muted-foreground ring-inset',
  },
  { value: 'complete' as const, label: t('series.status.complete'), count: props.facets.complete, dot: 'bg-volume-read' },
  {
    value: 'has_gaps' as const,
    label: t('series.status.gaps'),
    count: props.facets.hasGaps,
    dot: 'border border-volume-missing bg-[repeating-linear-gradient(135deg,var(--volume-missing)_0_1.5px,transparent_1.5px_3px)]',
  },
])

function handleSelect(value: CompletionStatus | null) {
  emit('select', value)
}
</script>

<template>
  <div :class="cn(segmentTrack, 'status-tabs max-w-full')" role="tablist" :aria-label="t('series.status.label')">
    <button
      v-for="tab in tabs"
      :key="tab.value ?? 'all'"
      type="button"
      role="tab"
      :class="segmentItem"
      :aria-selected="props.status === tab.value"
      @click="handleSelect(tab.value)"
    >
      <span v-if="tab.dot" class="size-2 shrink-0 rounded-full" :class="tab.dot" aria-hidden="true" />
      {{ tab.label }}
      <span class="text-[11.5px] tabular-nums" :class="props.status === tab.value ? 'text-primary' : 'text-muted-foreground'">{{
        formatNumber(tab.count)
      }}</span>
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
