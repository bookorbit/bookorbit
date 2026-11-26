<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SeriesUnitClass, SeriesUnitCounts } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { segmentItem, segmentTrack } from '@/components/browse-header/browse-header'
import { cn } from '@/lib/utils'
import { chapterGroupUnit, chapterUnitCount } from '../lib/series-unit-label'

/** The counts ignore the active tab, so every tab keeps saying what it holds. */
const props = defineProps<{
  unit: SeriesUnitClass | null
  counts: SeriesUnitCounts
}>()

const emit = defineEmits<{
  select: [unit: SeriesUnitClass | null]
}>()

const { t } = useI18n()

const tabs = computed(() => {
  const chapters = chapterUnitCount(props.counts)
  return [
    { value: null, label: t('series.units.tabs.all'), count: props.counts.volume + chapters },
    { value: 'volume' as const, label: t('series.units.tabs.volumes'), count: props.counts.volume },
    {
      value: 'chapter' as const,
      label: chapterGroupUnit(props.counts) === 'issue' ? t('series.units.tabs.issues') : t('series.units.tabs.chapters'),
      count: chapters,
    },
  ]
})

function handleSelect(value: SeriesUnitClass | null) {
  if (value === props.unit) return
  emit('select', value)
}
</script>

<template>
  <div :class="cn(segmentTrack, 'unit-tabs max-w-full')" role="tablist" :aria-label="t('series.units.tabs.label')">
    <button
      v-for="tab in tabs"
      :key="tab.value ?? 'all'"
      type="button"
      role="tab"
      :class="segmentItem"
      :aria-selected="props.unit === tab.value"
      :data-testid="`series-unit-tab-${tab.value ?? 'all'}`"
      @click="handleSelect(tab.value)"
    >
      {{ tab.label }}
      <span class="text-[11.5px] tabular-nums" :class="props.unit === tab.value ? 'text-primary' : 'text-muted-foreground'">{{
        formatNumber(tab.count)
      }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Long translations scroll inside the strip rather than pushing the books bar wider than a phone. */
@media (max-width: 639px) {
  .unit-tabs {
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .unit-tabs::-webkit-scrollbar {
    display: none;
  }
}
</style>
