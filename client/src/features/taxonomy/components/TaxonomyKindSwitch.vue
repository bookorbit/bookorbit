<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TAXONOMY_KINDS, type TaxonomyKind } from '@bookorbit/types'
import { segmentItem, segmentTrack } from '@/components/browse-header/browse-header'
import { formatNumber } from '@/i18n/formatters'

/** Genres | Tags. Each side counts the names with books in the chosen libraries; phones drop the counts. */
const props = defineProps<{
  kind: TaxonomyKind
  totals: Record<TaxonomyKind, number>
}>()

const emit = defineEmits<{ select: [kind: TaxonomyKind] }>()

const { t } = useI18n()

const LABELS: Record<TaxonomyKind, string> = { genre: 'taxonomy.index.genresTitle', tag: 'taxonomy.index.tagsTitle' }

function handleSelect(kind: TaxonomyKind) {
  if (kind !== props.kind) emit('select', kind)
}
</script>

<template>
  <div :class="segmentTrack" role="tablist" :aria-label="t('taxonomy.index.kindSwitch')">
    <button
      v-for="option in TAXONOMY_KINDS"
      :key="option"
      type="button"
      role="tab"
      :class="segmentItem"
      :aria-selected="kind === option"
      @click="handleSelect(option)"
    >
      {{ t(LABELS[option]) }}
      <span class="hidden text-[11.5px] text-muted-foreground tabular-nums md:inline">{{ formatNumber(totals[option]) }}</span>
    </button>
  </div>
</template>
