<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import SeriesIndexRow from './SeriesIndexRow.vue'
import type { SeriesListSort, SortDirection } from '../types/series'
import type { SeriesGroup } from '../lib/series-grouping'

const props = defineProps<{
  groups: SeriesGroup[]
  sort: SeriesListSort
  order: SortDirection
  rowHeight: number
  /** Distance the sticky column head keeps from the top of the scroller. */
  headerOffset: number
}>()

const emit = defineEmits<{
  open: [seriesId: number]
  sort: [field: SeriesListSort]
}>()

const { t } = useI18n()

const COLUMNS: { key: string; label: string; field: SeriesListSort | null; align?: 'end' }[] = [
  { key: 'nm', label: 'series.index.columnSeries', field: 'name' },
  { key: 'tk', label: 'series.index.columnVolumes', field: 'bookCount' },
  { key: 'pg', label: 'series.index.columnRead', field: 'readProgress', align: 'end' },
  { key: 'nx', label: 'series.index.columnNext', field: null },
  { key: 'ad', label: 'series.index.columnAdded', field: 'lastAddedAt' },
]

const coverHeight = computed(() => props.rowHeight - 18)

function handleSort(field: SeriesListSort | null) {
  if (field) emit('sort', field)
}

function handleOpen(seriesId: number) {
  emit('open', seriesId)
}
</script>

<template>
  <div
    class="series-index overflow-clip rounded-xl border border-border bg-card max-[519px]:-mx-[var(--shell-content-gutter)] max-[519px]:rounded-none max-[519px]:border-x-0"
    role="table"
    :style="{
      '--index-row-height': `${rowHeight}px`,
      '--index-cover-height': `${coverHeight}px`,
      '--index-cover-width': `${Math.round(coverHeight / 1.5)}px`,
      '--index-cover-overlap': `${Math.round(coverHeight / 3.6)}px`,
      '--index-head-offset': `${headerOffset}px`,
    }"
  >
    <div class="index-head" role="row">
      <span />
      <button
        v-for="column in COLUMNS"
        :key="column.key"
        type="button"
        class="index-head-cell"
        :class="[`cell-${column.key}`, column.align === 'end' ? 'justify-end' : '']"
        :data-active="props.sort === column.field ? '' : undefined"
        :disabled="!column.field"
        :aria-sort="props.sort === column.field ? (props.order === 'asc' ? 'ascending' : 'descending') : 'none'"
        @click="handleSort(column.field)"
      >
        {{ t(column.label) }}
        <component :is="props.order === 'asc' ? ChevronUp : ChevronDown" v-if="column.field" :size="11" class="index-head-arrow shrink-0" />
      </button>
    </div>

    <template v-for="group in groups" :key="group.key">
      <div v-if="group.label" class="index-group">
        <span>{{ group.label }}</span>
        <span class="font-medium tabular-nums text-muted-foreground">{{ formatNumber(group.items.length) }}</span>
        <span class="h-px flex-1 bg-border" />
      </div>
      <SeriesIndexRow v-for="series in group.items" :key="series.id" :series="series" @open="handleOpen" />
    </template>
  </div>
</template>

<style scoped>
.index-head {
  display: grid;
  align-items: center;
  gap: 0 14px;
  padding: 0 14px;
  height: 34px;
  position: sticky;
  top: var(--index-head-offset);
  z-index: 30;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  grid-template-columns:
    [cv] 88px [nm] minmax(150px, 1.45fr) [tk] minmax(150px, 2fr)
    [pg] 62px [nx] minmax(110px, 1.05fr) [ad] 82px;
}

.index-head-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 100%;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  transition: color 0.12s;
}

.index-head-cell:not(:disabled):hover {
  color: var(--foreground);
}

.index-head-cell[data-active] {
  color: var(--foreground);
}

.index-head-arrow {
  opacity: 0;
  transition: opacity 0.12s;
}

.index-head-cell:not(:disabled):hover .index-head-arrow {
  opacity: 0.45;
}

.index-head-cell[data-active] .index-head-arrow {
  opacity: 1;
}

.index-group {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 31px;
  padding: 0 14px;
  position: sticky;
  top: calc(var(--index-head-offset) + 34px);
  z-index: 20;
  background: var(--surface-3);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--foreground);
}

@media (max-width: 1439px) {
  .index-head {
    grid-template-columns: [cv] 88px [nm] minmax(150px, 1.45fr) [tk] minmax(150px, 2fr) [pg] 62px [nx] minmax(108px, 1fr);
  }
  .cell-ad {
    display: none;
  }
}

@media (max-width: 1199px) {
  .index-head {
    grid-template-columns: [cv] 76px [nm] minmax(140px, 1.5fr) [tk] minmax(140px, 2fr) [pg] 60px;
  }
  .cell-nx {
    display: none;
  }
}

@media (max-width: 849px) {
  .index-head {
    display: none;
  }
  .index-group {
    top: var(--index-head-offset);
  }
}

@media (max-width: 519px) {
  .index-group {
    padding: 0 12px;
  }
}
</style>
