<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { SeriesSummary } from '@bookorbit/types'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import SeriesVolumeTrack from './SeriesVolumeTrack.vue'
import SeriesLibraryChip from './SeriesLibraryChip.vue'
import { parseAddedAt, seriesAuthorLine, seriesExtraAuthorCount, seriesRowFacts, seriesCoverSlots } from '../lib/series-summary'

const props = defineProps<{ series: SeriesSummary }>()

const emit = defineEmits<{
  open: [seriesId: number]
}>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const facts = computed(() => seriesRowFacts(props.series))
const authorLine = computed(() => seriesAuthorLine(props.series))
const extraAuthors = computed(() => seriesExtraAuthorCount(props.series))
const covers = computed(() => seriesCoverSlots(props.series).slice(0, 3))

const gapPreview = computed(() => {
  const shown = props.series.gaps.map((gap) => `#${gap}`).join(', ')
  const rest = props.series.gapCount - props.series.gaps.length
  return rest > 0 ? t('series.gaps.previewMore', { shown, count: rest }) : shown
})

const publishedNote = computed(() => {
  const expected = props.series.expectedBookCount
  if (!expected || expected <= props.series.volumes.length) return null
  return t('series.card.publishedOf', { owned: facts.value.ownedVolumes, total: expected })
})

const caption = computed(() => {
  if (props.series.gapCount > 0) return t('series.gaps.missingList', { list: gapPreview.value })
  if (facts.value.isSingleVolume) return covers.value[0]?.title ?? t('series.card.oneVolume')
  const base = publishedNote.value ?? t('series.card.volumeCount', { count: facts.value.ownedVolumes })
  if (facts.value.readingVolumes > 0) return t('series.index.captionReading', { base, count: facts.value.readingVolumes })
  return base
})

const nextKicker = computed(() => {
  if (facts.value.isComplete) return t('series.index.finished')
  if (facts.value.readingVolumes > 0) return t('series.index.reading')
  return facts.value.readVolumes > 0 ? t('series.index.next') : t('series.index.start')
})

const nextValue = computed(() => {
  if (facts.value.isComplete || !props.series.nextTitle) return null
  const number = props.series.nextIndex ? `#${props.series.nextIndex}` : null
  return [number, props.series.nextTitle].filter(Boolean).join(' · ')
})

const addedLabel = computed(() => {
  const date = parseAddedAt(props.series.lastAddedAt)
  return date ? formatRelativeFromNow(date) : '-'
})

const rowLabel = computed(() => t('series.card.label', { name: props.series.name, read: facts.value.readVolumes, total: facts.value.ownedVolumes }))

function handleOpen() {
  emit('open', props.series.id)
}
</script>

<template>
  <div
    class="series-index-row cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    tabindex="0"
    role="row"
    :aria-label="rowLabel"
    @click="handleOpen"
    @keydown.enter="handleOpen"
    @keydown.space.prevent="handleOpen"
  >
    <div class="cell-covers flex h-full min-w-0 items-center">
      <div
        v-for="(slot, i) in covers"
        :key="slot.bookId ?? `c${i}`"
        class="relative shrink-0 overflow-hidden rounded-[2px] bg-surface-3 shadow-sm"
        :class="i > 0 ? '-ml-[var(--index-cover-overlap)]' : ''"
        :style="{ zIndex: 3 - i, height: 'var(--index-cover-height)', width: 'var(--index-cover-width)' }"
      >
        <BookCoverArtwork
          :src="slot.bookId === null ? null : coverUrl(slot.bookId)"
          :has-cover="slot.bookId !== null"
          :title="slot.title ?? series.name"
          :seed="`${series.name}-${slot.bookId ?? i}`"
          alt=""
          mode="fill-crop"
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>

    <div class="cell-name min-w-0">
      <div class="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">{{ series.name }}</div>
      <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <SeriesLibraryChip :library-names="series.libraryNames" dot-only />
        <span v-if="authorLine" class="min-w-0 truncate">
          {{ extraAuthors > 0 ? t('series.authorsPlus', { authors: authorLine, count: extraAuthors }) : authorLine }}
        </span>
      </div>
    </div>

    <div class="cell-track flex min-w-0 flex-col gap-1.5">
      <div class="h-[9px] shrink-0">
        <SeriesVolumeTrack :series="series" />
      </div>
      <div class="truncate text-[11px]" :class="series.gapCount > 0 ? 'text-destructive' : 'text-muted-foreground'">{{ caption }}</div>
    </div>

    <div class="cell-progress min-w-0 text-right tabular-nums">
      <div class="whitespace-nowrap text-[14px] font-semibold" :class="facts.isComplete ? 'text-success' : 'text-foreground'">
        {{ formatNumber(facts.readVolumes) }}<span class="font-normal text-muted-foreground">/{{ formatNumber(facts.ownedVolumes) }}</span>
      </div>
      <div class="mt-px text-[11px] text-muted-foreground">{{ t('series.index.percent', { value: facts.percentRead }) }}</div>
    </div>

    <div class="cell-next flex min-w-0 items-center gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{{ nextKicker }}</div>
        <div v-if="nextValue" class="mt-px truncate text-[12.5px] text-foreground">{{ nextValue }}</div>
      </div>
      <span
        class="row-go grid size-[26px] shrink-0 place-items-center rounded-md bg-surface-3 text-muted-foreground opacity-0 transition-opacity"
        aria-hidden="true"
      >
        <ChevronRight :size="13" />
      </span>
    </div>

    <div class="cell-added truncate text-right text-[11.5px] tabular-nums text-muted-foreground">{{ addedLabel }}</div>
  </div>
</template>

<style scoped>
.series-index-row {
  display: grid;
  align-items: center;
  gap: 0 14px;
  padding: 0 14px;
  min-width: 0;
  height: var(--index-row-height);
  grid-template-columns:
    [cv] 88px [nm] minmax(150px, 1.45fr) [tk] minmax(150px, 2fr)
    [pg] 62px [nx] minmax(110px, 1.05fr) [ad] 82px;
}

.series-index-row:hover .row-go,
.series-index-row:focus-visible .row-go {
  opacity: 1;
}

/* Progressive column shedding: the row sheds what it cannot hold rather than scrolling sideways. */
@media (max-width: 1439px) {
  .series-index-row {
    grid-template-columns: [cv] 88px [nm] minmax(150px, 1.45fr) [tk] minmax(150px, 2fr) [pg] 62px [nx] minmax(108px, 1fr);
  }
  .cell-added {
    display: none;
  }
}

@media (max-width: 1199px) {
  .series-index-row {
    grid-template-columns: [cv] 76px [nm] minmax(140px, 1.5fr) [tk] minmax(140px, 2fr) [pg] 60px;
  }
  .cell-next {
    display: none;
  }
}

@media (max-width: 849px) {
  .series-index-row {
    grid-template-columns: [cv] auto [nm] minmax(0, 1fr) [pg] auto;
    grid-template-areas:
      'cv nm pg'
      'cv tk tk';
    height: auto;
    min-height: var(--index-row-height);
    padding: 10px 12px;
    gap: 7px 12px;
    align-content: center;
  }
  .cell-covers {
    grid-area: cv;
    align-self: center;
  }
  .cell-name {
    grid-area: nm;
    align-self: end;
  }
  .cell-progress {
    grid-area: pg;
    align-self: end;
  }
  .cell-track {
    grid-area: tk;
    align-self: start;
  }
}

@media (max-width: 519px) {
  .series-index-row {
    padding: 10px 12px;
    gap: 6px 11px;
  }
  .cell-covers > :nth-child(3) {
    display: none;
  }
}
</style>
