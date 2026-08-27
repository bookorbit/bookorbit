<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SeriesSummary, SeriesVolumeSlot } from '@bookorbit/types'
import { seriesRowFacts } from '../lib/series-summary'

/**
 * One segment per volume the series should have: read, in progress, in the library unread, or
 * missing. This is the list's answer to "how far am I, and what am I short of" - the question the
 * old percentage bar could not express, since a percentage cannot show a hole.
 */
const props = withDefaults(
  defineProps<{
    series: SeriesSummary
    /** Segments stop growing past this, so a two-volume series never reads as a full-width bar. */
    maxSegmentWidth?: number
    /** Centre it under a centred row of books; leave it at the start inside a ledger column. */
    align?: 'start' | 'center'
  }>(),
  { maxSegmentWidth: 26, align: 'start' },
)

const { t } = useI18n()

const facts = computed(() => seriesRowFacts(props.series))

const segments = computed<SeriesVolumeSlot[]>(() => props.series.volumes)

const label = computed(() => {
  const parts = [t('series.track.readCount', { count: facts.value.readVolumes })]
  if (facts.value.readingVolumes > 0) parts.push(t('series.track.readingCount', { count: facts.value.readingVolumes }))
  const unread = facts.value.ownedVolumes - facts.value.readVolumes - facts.value.readingVolumes
  if (unread > 0) parts.push(t('series.track.unreadCount', { count: unread }))
  if (props.series.gapCount > 0) parts.push(t('series.track.missingCount', { count: props.series.gapCount }))
  return parts.join(', ')
})

function segmentTitle(slot: SeriesVolumeSlot): string {
  const number = slot.index === null ? null : `#${slot.index}`
  if (slot.status === 'missing') return t('series.track.slotMissing', { number: number ?? '' }).trim()
  const name = slot.title ?? t('series.track.untitled')
  return [number, name].filter(Boolean).join(' ')
}
</script>

<template>
  <div
    v-if="segments.length > 0"
    class="flex h-full w-full min-w-0 items-stretch gap-0.5"
    :class="align === 'center' ? 'justify-center' : 'justify-start'"
    role="img"
    :aria-label="label"
    :style="{ '--volume-seg-max': `${maxSegmentWidth}px` }"
  >
    <span
      v-for="(slot, i) in segments"
      :key="`${slot.index ?? 'x'}-${slot.bookId ?? i}`"
      class="volume-seg min-w-0.5 flex-1 rounded-[2px]"
      :data-status="slot.status"
      :title="segmentTitle(slot)"
    />
  </div>
</template>

<style scoped>
.volume-seg {
  max-width: var(--volume-seg-max);
  background: var(--volume-unread);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 8%, transparent);
}

.volume-seg[data-status='read'] {
  background: var(--volume-read);
  box-shadow: none;
}

.volume-seg[data-status='reading'] {
  background: var(--volume-reading);
  box-shadow: none;
}

.volume-seg[data-status='missing'] {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklch, var(--volume-missing) 38%, transparent) 0 2px,
    color-mix(in oklch, var(--volume-missing) 7%, transparent) 2px 5px
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--volume-missing) 50%, transparent);
}
</style>
