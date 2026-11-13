<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TaxonomyKind, TaxonomyName } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { taxonomyRouteNames } from '../lib/taxonomy-text'
import TaxonomyHighlight from './TaxonomyHighlight.vue'

/** A genre or tag name with its book count, linking to its page. */
const props = withDefaults(
  defineProps<{
    kind: TaxonomyKind
    item: TaxonomyName
    query?: string
    libraryId?: number | null
    size?: 'md' | 'sm'
  }>(),
  { query: '', libraryId: null, size: 'md' },
)

const { t } = useI18n()

const to = computed(() => ({
  name: taxonomyRouteNames(props.kind).detail,
  params: { id: props.item.id },
  query: props.libraryId ? { libraryId: String(props.libraryId) } : undefined,
}))

const label = computed(() => t('taxonomy.index.rowLabel', { name: props.item.name, count: props.item.bookCount }))
</script>

<template>
  <RouterLink :to="to" class="taxonomy-chip" :data-size="size" :aria-label="label">
    <span class="truncate"><TaxonomyHighlight :name="item.name" :query="query" /></span>
    <span class="taxonomy-chip-count" aria-hidden="true">{{ formatNumber(item.bookCount) }}</span>
  </RouterLink>
</template>

<style scoped>
.taxonomy-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  height: 28px;
  padding-inline: 10px 4px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 500;
  transition:
    border-color 0.12s,
    background-color 0.12s;
}

.taxonomy-chip-count {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 20px;
  padding-inline: 6px;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--muted-foreground);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.taxonomy-chip:hover {
  border-color: color-mix(in oklch, var(--primary) 55%, var(--border));
  background: color-mix(in oklch, var(--primary) 8%, var(--card));
}

.taxonomy-chip:hover .taxonomy-chip-count {
  color: var(--foreground);
}

.taxonomy-chip:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.taxonomy-chip[data-size='sm'] {
  height: 26px;
  font-size: 12.5px;
}

.taxonomy-chip[data-size='sm'] .taxonomy-chip-count {
  height: 18px;
  font-size: 11px;
}

@media (max-width: 767px) {
  .taxonomy-chip[data-size='md'] {
    height: 32px;
    font-size: 13.5px;
  }
}
</style>
