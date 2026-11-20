<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TaxonomyKind, TaxonomyName, TaxonomySummary } from '@bookorbit/types'
import type { LetterGroup } from '../lib/taxonomy-text'
import TaxonomyChip from './TaxonomyChip.vue'

/** Every name as a chip: the biggest first when browsing by letter, then one section per letter. */
defineProps<{
  kind: TaxonomyKind
  groups: LetterGroup<TaxonomySummary>[]
  top: TaxonomyName[]
  query?: string
  libraryId?: number | null
}>()

const { t } = useI18n()
</script>

<template>
  <div class="grid gap-1">
    <section v-if="top.length" class="cloud-section cloud-top" :aria-label="t('taxonomy.index.mostBooks')">
      <span class="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase" aria-hidden="true">{{
        t('taxonomy.index.mostBooks')
      }}</span>
      <div class="flex min-w-0 flex-wrap gap-1.5">
        <TaxonomyChip v-for="item in top" :key="item.id" :kind="kind" :item="item" :library-id="libraryId" />
      </div>
    </section>

    <section v-for="group in groups" :key="group.key" class="cloud-section" :class="group.label ? '' : 'cloud-flat'">
      <h2 v-if="group.label" class="text-[18px] leading-7 font-bold tracking-[-0.01em] text-foreground">{{ group.label }}</h2>
      <div class="flex min-w-0 flex-wrap gap-1.5">
        <TaxonomyChip v-for="item in group.items" :key="item.id" :kind="kind" :item="item" :query="query" :library-id="libraryId" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.cloud-section {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 0 12px;
  padding: 12px 14px;
  border-radius: 12px;
}

.cloud-section + .cloud-section {
  border-top: 1px solid var(--border);
  border-radius: 0;
}

.cloud-top {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  background: var(--card);
}

.cloud-flat {
  grid-template-columns: minmax(0, 1fr);
}

@media (max-width: 767px) {
  .cloud-section {
    grid-template-columns: 30px minmax(0, 1fr);
    padding: 10px 2px;
  }
  .cloud-top {
    padding: 12px;
  }
  .cloud-top,
  .cloud-flat {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
