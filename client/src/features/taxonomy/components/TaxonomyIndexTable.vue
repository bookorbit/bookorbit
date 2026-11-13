<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import type { TaxonomyIndexSort, TaxonomyKind, TaxonomySummary } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import type { SortDirection } from '../api/taxonomy'
import type { LetterGroup } from '../lib/taxonomy-text'
import TaxonomyIndexRow from './TaxonomyIndexRow.vue'

/** The dense index: one row per name, sortable from its head, filed under letters when sorted by name. */
const props = defineProps<{
  kind: TaxonomyKind
  groups: LetterGroup<TaxonomySummary>[]
  sort: TaxonomyIndexSort
  order: SortDirection
  query?: string
}>()

const emit = defineEmits<{
  open: [id: number]
  sort: [field: TaxonomyIndexSort]
}>()

const { t } = useI18n()

const columns = computed<{ key: string; label: string; field: TaxonomyIndexSort | null; end?: boolean }[]>(() => [
  { key: 'nm', label: props.kind === 'tag' ? 'taxonomy.index.columnTag' : 'taxonomy.index.columnGenre', field: 'name' },
  { key: 'bk', label: 'taxonomy.index.columnBooks', field: 'bookCount', end: true },
  { key: 'rd', label: 'taxonomy.index.columnRead', field: 'readProgress', end: true },
  { key: 'lb', label: 'taxonomy.index.columnLibraries', field: null, end: true },
  { key: 'ad', label: 'taxonomy.index.columnAdded', field: 'lastAddedAt', end: true },
])

function ariaSort(field: TaxonomyIndexSort | null) {
  if (!field) return undefined
  if (props.sort !== field) return 'none'
  return props.order === 'asc' ? 'ascending' : 'descending'
}

function handleSort(field: TaxonomyIndexSort | null) {
  if (field) emit('sort', field)
}

function handleOpen(id: number) {
  emit('open', id)
}
</script>

<template>
  <div
    class="taxonomy-index overflow-clip rounded-xl border border-border bg-card"
    role="table"
    :aria-label="kind === 'tag' ? t('taxonomy.index.tagsTitle') : t('taxonomy.index.genresTitle')"
  >
    <div class="index-head" role="row">
      <span />
      <template v-for="column in columns" :key="column.key">
        <button
          v-if="column.field"
          type="button"
          role="columnheader"
          class="index-head-cell"
          :class="[`cell-${column.key}`, column.end ? 'justify-end' : '']"
          :data-active="sort === column.field ? '' : undefined"
          :aria-sort="ariaSort(column.field)"
          @click="handleSort(column.field)"
        >
          {{ t(column.label) }}
          <component :is="order === 'asc' ? ChevronUp : ChevronDown" :size="11" class="index-head-arrow shrink-0" aria-hidden="true" />
        </button>
        <span v-else role="columnheader" class="index-head-cell" :class="[`cell-${column.key}`, column.end ? 'justify-end' : '']">
          {{ t(column.label) }}
        </span>
      </template>
    </div>

    <template v-for="group in groups" :key="group.key">
      <div v-if="group.label" class="index-group" role="row">
        <span role="rowheader">{{ group.label }}</span>
        <span class="font-medium text-muted-foreground tabular-nums">{{ formatNumber(group.items.length) }}</span>
        <span class="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      <TaxonomyIndexRow v-for="item in group.items" :key="item.id" :item="item" :query="query" @open="handleOpen" />
    </template>
  </div>
</template>

<style scoped>
.taxonomy-index {
  --cover-h: 39px;
  --cover-w: 26px;
}

.index-head {
  display: grid;
  align-items: center;
  gap: 0 14px;
  padding: 0 14px;
  height: 34px;
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  grid-template-columns: [cv] 88px [nm] minmax(180px, 1fr) [bk] 76px [rd] 84px [lb] 96px [ad] 104px;
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

button.index-head-cell:hover,
.index-head-cell[data-active] {
  color: var(--foreground);
}

button.index-head-cell:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
  border-radius: 4px;
}

.index-head-arrow {
  opacity: 0;
  transition: opacity 0.12s;
}

button.index-head-cell:hover .index-head-arrow {
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
  top: 34px;
  z-index: 20;
  background: var(--surface-3);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--foreground);
}

@media (max-width: 1199px) {
  .index-head {
    grid-template-columns: [cv] 76px [nm] minmax(140px, 1fr) [bk] 72px [rd] 80px [ad] 96px;
  }
  .cell-lb {
    display: none;
  }
}

@media (max-width: 849px) {
  .taxonomy-index {
    --cover-h: 36px;
    --cover-w: 24px;
  }
  .index-head {
    display: none;
  }
  .index-group {
    top: 0;
    padding: 0 12px;
  }
}

/* Edge to edge once the sidebar is a drawer; beside an open sidebar the table keeps its frame. */
@media (max-width: 768px) {
  .taxonomy-index {
    margin-inline: calc(var(--shell-content-gutter) * -1) calc(var(--shell-gap) * -1);
    border-inline: 0;
    border-radius: 0;
  }
}
</style>
