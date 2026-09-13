<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, Check, Layers } from '@lucide/vue'
import type { SeriesSummary } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import SeriesVolumeTrack from './SeriesVolumeTrack.vue'
import SeriesLibraryChip from './SeriesLibraryChip.vue'
import { seriesAuthorLine, seriesExtraAuthorCount, seriesRowFacts, seriesCoverSlots } from '../lib/series-summary'
import { STACK_MAX_VISIBLE, coverStackLayout, orderForStack } from '../lib/cover-stack-layout'

const props = defineProps<{ series: SeriesSummary }>()

const emit = defineEmits<{
  open: [seriesId: number]
}>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()

const facts = computed(() => seriesRowFacts(props.series))
const authorLine = computed(() => seriesAuthorLine(props.series))
const extraAuthors = computed(() => seriesExtraAuthorCount(props.series))

const allSlots = computed(() => seriesCoverSlots(props.series))

/** The fan, with the first volume in the middle. */
const stackSlots = computed(() => orderForStack(allSlots.value.slice(0, STACK_MAX_VISIBLE)))
const stackLayout = computed(() => coverStackLayout(stackSlots.value.length))

const publishedNote = computed(() => {
  const expected = props.series.expectedBookCount
  if (!expected || expected <= props.series.volumes.length) return null
  return t('series.card.publishedOf', { owned: facts.value.ownedVolumes, total: expected })
})

const cardNote = computed(() => {
  if (props.series.gapCount > 0) return null
  if (facts.value.isSingleVolume) return allSlots.value[0]?.title ?? t('series.card.oneVolume')
  if (facts.value.isComplete) return publishedNote.value ?? t('series.card.volumeCount', { count: facts.value.ownedVolumes })
  const base = publishedNote.value ?? t('series.card.volumeCount', { count: facts.value.ownedVolumes })
  return t('series.card.readSummary', { base, read: facts.value.readVolumes })
})

const gapPreview = computed(() => {
  const shown = props.series.gaps.map((gap) => `#${gap}`).join(', ')
  const rest = props.series.gapCount - props.series.gaps.length
  return rest > 0 ? t('series.gaps.previewMore', { shown, count: rest }) : shown
})

const progressLabel = computed(() =>
  facts.value.isSingleVolume ? t('series.card.oneVolumeShort') : `${formatNumber(facts.value.readVolumes)}/${formatNumber(facts.value.ownedVolumes)}`,
)

const cardLabel = computed(() => t('series.card.label', { name: props.series.name, read: facts.value.readVolumes, total: facts.value.ownedVolumes }))

function handleOpen() {
  emit('open', props.series.id)
}
</script>

<template>
  <article
    class="series-card group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-[border-color,box-shadow] duration-150 hover:border-ring hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-[519px]:flex-row"
    tabindex="0"
    role="button"
    :aria-label="cardLabel"
    @click="handleOpen"
    @keydown.enter="handleOpen"
    @keydown.space.prevent="handleOpen"
  >
    <div
      class="relative shrink-0 bg-linear-to-b from-surface-2 to-card px-2.5 pt-2 max-[519px]:flex max-[519px]:w-[136px] max-[519px]:flex-col max-[519px]:px-2 max-[519px]:py-2.5"
    >
      <div class="cover-stack relative isolate w-full" style="aspect-ratio: 5 / 4">
        <span class="absolute inset-x-[22%] bottom-[3%] h-3 rounded-full bg-black/25 blur-xl" aria-hidden="true" />

        <div
          v-for="(slot, i) in stackSlots"
          :key="slot.bookId ?? `s${i}`"
          class="stack-cover absolute overflow-hidden rounded-[3px] bg-surface-3"
          :style="stackLayout[i]"
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

        <span
          v-if="facts.ownedVolumes > 1"
          class="absolute right-1 top-1 z-20 inline-flex h-[21px] items-center gap-1 rounded-md border border-border bg-background/85 px-1.5 text-[11.5px] font-semibold tabular-nums text-foreground backdrop-blur-sm"
          :title="t('series.card.volumeCount', { count: facts.ownedVolumes })"
        >
          <Layers :size="11" class="text-muted-foreground" />
          {{ formatNumber(facts.ownedVolumes) }}
        </span>
      </div>

      <div class="mt-1.5 h-1.5">
        <SeriesVolumeTrack :series="series" :max-segment-width="40" align="center" />
      </div>

      <p class="flex min-w-0 items-center gap-1.5 py-2 text-[11.5px] text-muted-foreground max-[519px]:hidden">
        <span
          v-if="series.gapCount > 0"
          class="inline-flex h-[21px] shrink-0 items-center gap-1 rounded-md bg-destructive/15 px-1.5 font-semibold text-destructive"
        >
          <AlertCircle :size="12" />
          {{ t('series.gaps.missingCount', { count: series.gapCount }) }}
        </span>
        <span v-if="series.gapCount > 0" class="min-w-0 flex-1 truncate">{{ gapPreview }}</span>
        <span
          v-else-if="facts.isComplete"
          class="inline-flex h-[21px] shrink-0 items-center gap-1 rounded-md bg-success/15 px-1.5 font-semibold text-success"
        >
          <Check :size="12" />
          {{ t('series.card.complete') }}
        </span>
        <span v-if="series.gapCount === 0" class="min-w-0 flex-1 truncate" :title="cardNote ?? undefined">{{ cardNote }}</span>
      </p>
    </div>

    <div
      class="flex min-w-0 flex-1 flex-col gap-0.5 border-t border-border px-3 pb-2.5 pt-2.5 max-[519px]:justify-center max-[519px]:border-l max-[519px]:border-t-0"
    >
      <h3 class="line-clamp-2 break-words text-[14.5px] font-semibold leading-snug tracking-[-0.014em] text-foreground">{{ series.name }}</h3>
      <p v-if="authorLine" class="truncate text-[12.5px] text-muted-foreground">
        {{ extraAuthors > 0 ? t('series.authorsPlus', { authors: authorLine, count: extraAuthors }) : authorLine }}
      </p>

      <div class="mt-auto flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 pt-2 max-[519px]:mt-1.5 max-[519px]:flex-nowrap">
        <span
          v-if="facts.readingVolumes > 0"
          class="inline-flex h-[21px] shrink-0 items-center rounded-md bg-warning/15 px-1.5 text-[11.5px] font-semibold text-warning"
        >
          {{ t('series.status.reading') }}
        </span>
        <span
          v-else-if="facts.isComplete"
          class="inline-flex h-[21px] shrink-0 items-center gap-1 rounded-md bg-success/15 px-1.5 text-[11.5px] font-semibold text-success"
        >
          <Check :size="12" />
          {{ t('series.status.read') }}
        </span>
        <SeriesLibraryChip :library-names="series.libraryNames" class="series-card-library min-w-0" />
        <span class="ml-auto shrink-0 text-[12.5px] font-semibold tabular-nums" :class="facts.isComplete ? 'text-success' : 'text-muted-foreground'">
          {{ progressLabel }}
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
/*
 * The whole hover effect is one custom property on the stack: each cover reads it through its own
 * `--offset`, so the fan spreads without Vue touching a single cover. Only `transform` animates -
 * no filter, no opacity, no will-change - which is what keeps a page of fifty stacks cheap.
 */
.stack-cover {
  aspect-ratio: 2 / 3;
  transform-origin: bottom center;
  transform: translateX(calc(var(--stack-spread, 0px) * var(--offset))) rotate(calc(var(--stack-tilt, 0deg) * var(--offset))) scale(var(--scale, 1));
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.series-card:hover .cover-stack,
.series-card:focus-visible .cover-stack {
  --stack-spread: 7px;
  --stack-tilt: 2.4deg;
}

/* One chip is enough on a phone row: the reading state wins, the library is a filter anyway. */
@media (max-width: 519px) {
  .series-card:has(.text-warning, .text-success) .series-card-library {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stack-cover {
    transition: none;
  }

  .series-card:hover .cover-stack,
  .series-card:focus-visible .cover-stack {
    --stack-spread: 0px;
    --stack-tilt: 0deg;
  }
}
</style>
