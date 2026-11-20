<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { TaxonomySummary } from '@bookorbit/types'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import ActivateLink from '@/components/ActivateLink.vue'
import TaxonomyHighlight from './TaxonomyHighlight.vue'

const props = defineProps<{ item: TaxonomySummary; to: RouteLocationRaw; query?: string }>()

const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

/** A name whose books have no covers still shows one generated cover, so the column never sits empty. */
const covers = computed<(number | null)[]>(() => (props.item.coverBookIds.length ? props.item.coverBookIds.slice(0, 3) : [null]))

const readPercent = computed(() => (props.item.bookCount ? Math.round((props.item.readCount / props.item.bookCount) * 100) : 0))

const subline = computed(() =>
  props.item.readingCount
    ? t('taxonomy.index.readingAndLibraries', { reading: props.item.readingCount, libraries: props.item.libraryCount })
    : t('taxonomy.index.libraryCount', { count: props.item.libraryCount }),
)

const addedLabel = computed(() => (props.item.lastAddedAt ? formatRelativeFromNow(new Date(props.item.lastAddedAt)) : '-'))

const rowLabel = computed(() => t('taxonomy.index.rowLabel', { name: props.item.name, count: props.item.bookCount }))

function handleOpen() {
  emit('open', props.item.id)
}
</script>

<template>
  <ActivateLink
    :to="to"
    class="taxonomy-index-row cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    role="row"
    :aria-label="rowLabel"
    @activate="handleOpen"
    @keydown.space.prevent="handleOpen"
  >
    <div class="flex h-full min-w-0 items-center" aria-hidden="true">
      <div
        v-for="(bookId, i) in covers"
        :key="bookId ?? 'none'"
        class="relative h-(--cover-h) w-(--cover-w) shrink-0 overflow-hidden rounded-[2px] bg-surface-3 shadow-sm"
        :class="i > 0 ? '-ms-[11px]' : ''"
        :style="{ zIndex: 3 - i }"
      >
        <BookCoverArtwork
          :src="bookId === null ? null : coverUrl(bookId)"
          :has-cover="bookId !== null"
          :title="item.name"
          :seed="`${item.name}-${bookId ?? i}`"
          alt=""
          mode="fill-crop"
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>

    <div class="min-w-0">
      <div class="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
        <TaxonomyHighlight :name="item.name" :query="query" />
      </div>
      <div class="mt-0.5 truncate text-[12px] text-muted-foreground">{{ subline }}</div>
    </div>

    <div class="text-end text-[14px] font-semibold whitespace-nowrap text-foreground tabular-nums">{{ formatNumber(item.bookCount) }}</div>

    <div class="cell-rd min-w-0 text-end whitespace-nowrap tabular-nums">
      <span class="text-[14px] font-semibold text-foreground">{{ formatNumber(item.readCount) }}</span>
      <span class="text-[14px] text-muted-foreground">/{{ formatNumber(item.bookCount) }}</span>
      <div class="mt-[5px] h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div class="h-full rounded-full bg-primary" :style="{ width: `${readPercent}%` }" />
      </div>
    </div>

    <div class="cell-lb text-end text-[12.5px] text-foreground tabular-nums">{{ formatNumber(item.libraryCount) }}</div>

    <div class="cell-ad flex min-w-0 items-center justify-end gap-2 text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">
      <span>{{ addedLabel }}</span>
      <span
        class="row-go grid size-[26px] shrink-0 place-items-center rounded-md bg-surface-3 text-muted-foreground opacity-0 transition-opacity"
        aria-hidden="true"
      >
        <ChevronRight :size="13" />
      </span>
    </div>
  </ActivateLink>
</template>

<style scoped>
.taxonomy-index-row {
  display: grid;
  align-items: center;
  gap: 0 14px;
  height: 54px;
  padding: 0 14px;
  min-width: 0;
  grid-template-columns: [cv] 88px [nm] minmax(180px, 1fr) [bk] 76px [rd] 84px [lb] 96px [ad] 104px;
}

.taxonomy-index-row:hover .row-go,
.taxonomy-index-row:focus-visible .row-go {
  opacity: 1;
}

@media (max-width: 1199px) {
  .taxonomy-index-row {
    grid-template-columns: [cv] 76px [nm] minmax(140px, 1fr) [bk] 72px [rd] 80px [ad] 96px;
  }
  .cell-lb {
    display: none;
  }
}

@media (max-width: 849px) {
  .taxonomy-index-row {
    /* Three covers at 24px, each overlapping the last by 11px, so names line up row to row. */
    grid-template-columns: 50px minmax(0, 1fr) auto;
    height: auto;
    min-height: 58px;
    padding: 9px 12px;
    gap: 0 12px;
  }
  .cell-rd,
  .cell-lb,
  .cell-ad {
    display: none;
  }
}
</style>
