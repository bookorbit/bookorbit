<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import type { RouteLocationRaw } from 'vue-router'
import { Layers, Wrench } from '@lucide/vue'
import type { TaxonomyKind, TaxonomyName } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'
import { taxonomyRouteNames } from '../lib/taxonomy-text'
import TaxonomyChip from './TaxonomyChip.vue'

/**
 * Names that read like this one, on one line: near-duplicates to jump to or tidy up. Phones get
 * more chips because the strip scrolls sideways there instead of stopping at the edge.
 */
const props = defineProps<{
  kind: TaxonomyKind
  items: TaxonomyName[]
  libraryId?: number | null
  /** Where "Tidy up" goes; editors only. */
  entityManagerTo?: RouteLocationRaw | null
}>()

const { t } = useI18n()
const isPhone = useMediaQuery('(max-width: 767px)')

const shown = computed(() => props.items.slice(0, isPhone.value ? 12 : 6))
const rest = computed(() => props.items.length - shown.value.length)

function itemRoute(item: TaxonomyName) {
  return {
    name: taxonomyRouteNames(props.kind).detail,
    params: { id: item.id },
    query: props.libraryId ? { libraryId: String(props.libraryId) } : undefined,
  }
}
</script>

<template>
  <div class="similar-strip" role="group" :aria-label="t('taxonomy.page.similarNames')">
    <span class="me-1 inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap text-muted-foreground" aria-hidden="true">
      <Layers :size="13" />
      {{ t('taxonomy.page.similarNames') }}
    </span>
    <TaxonomyChip v-for="item in shown" :key="item.id" :kind="kind" :item="item" :library-id="libraryId" size="sm" />
    <DropdownMenu v-if="rest > 0">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="h-[26px] rounded-lg border border-dashed border-border px-[9px] text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {{ t('taxonomy.page.moreSimilar', { count: rest }) }}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-60">
        <DropdownMenuLabel class="pt-[7px] pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {{ t('taxonomy.page.similarNames') }}
        </DropdownMenuLabel>
        <div class="max-h-[300px] overflow-y-auto">
          <DropdownMenuItem v-for="item in items" :key="item.id" as-child>
            <RouterLink :to="itemRoute(item)">
              <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
              <span class="ms-auto ps-3 text-xs text-muted-foreground tabular-nums">{{ formatNumber(item.bookCount) }}</span>
            </RouterLink>
          </DropdownMenuItem>
        </div>
        <template v-if="entityManagerTo">
          <DropdownMenuSeparator />
          <DropdownMenuItem as-child>
            <RouterLink :to="entityManagerTo">
              <Wrench :size="14" class="me-2" />
              {{ t('taxonomy.page.tidyUp') }}
            </RouterLink>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<style scoped>
.similar-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.similar-strip::-webkit-scrollbar {
  display: none;
}

.similar-strip > * {
  flex: none;
}

/* The strip scrolls, so it clips anything outside its box: rings stay inside the chips. */
.similar-strip :deep(.taxonomy-chip:focus-visible) {
  outline-offset: -2px;
}

@media (max-width: 768px) {
  .similar-strip {
    margin-inline: calc(var(--shell-content-gutter) * -1) calc(var(--shell-gap) * -1);
    padding-inline: var(--shell-content-gutter) var(--shell-gap);
  }
}
</style>
