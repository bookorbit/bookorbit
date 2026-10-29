<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Highlighter, Repeat2 } from '@lucide/vue'
import type { ReadingHistoryItem } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'
import HistoryCover from './HistoryCover.vue'
import HistoryStars from './HistoryStars.vue'
import { formatDay, formatDayLong } from '../lib/history-format'
import { isReread } from '../lib/read-facts'

const props = defineProps<{ item: ReadingHistoryItem; selected: boolean }>()
const emit = defineEmits<{ select: [attemptId: number] }>()

const { t } = useI18n()

const title = computed(() => props.item.title ?? t('readingHistory.row.untitled'))
const marks = computed(() => props.item.highlightCount + props.item.journalCount)
const ribbon = computed(() => {
  if (props.item.outcome === 'abandoned')
    return {
      tone: 'bg-[color-mix(in_oklch,var(--pill-warning)_78%,black)]',
      label:
        props.item.progressPercent !== null
          ? t('readingHistory.row.abandonedAt', { percent: formatPercent(props.item.progressPercent / 100) })
          : t('readingHistory.row.abandoned'),
    }
  if (props.item.outcome === 'skimmed') return { tone: 'bg-[color-mix(in_oklch,var(--pill-info)_78%,black)]', label: t('readingHistory.row.skimmed') }
  if (props.item.removedAt) return { tone: 'bg-black/80', label: t('readingHistory.row.removedShort') }
  return null
})
const label = computed(() =>
  t('readingHistory.tile.label', {
    title: title.value,
    date: props.item.endedOn ? formatDayLong(props.item.endedOn) : t('readingHistory.row.noDate'),
  }),
)

function handleSelect() {
  emit('select', props.item.id)
}
</script>

<template>
  <button
    type="button"
    class="group flex min-w-0 flex-col gap-1.5 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    :aria-label="label"
    :aria-pressed="selected"
    @click="handleSelect"
  >
    <span class="relative block aspect-[2/3] w-full">
      <HistoryCover
        :item="item"
        class="h-full w-full rounded-md shadow-md transition-transform duration-150 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        :class="selected ? 'outline-2 outline-offset-2 outline-primary' : undefined"
      />
      <span
        v-if="isReread(item)"
        class="absolute end-1.5 top-1.5 inline-flex h-[18px] items-center gap-0.5 rounded-full bg-primary px-1.5 text-[10px] font-extrabold text-primary-foreground shadow-sm"
      >
        <Repeat2 class="size-2.5" aria-hidden="true" />{{ t('readingHistory.tile.readNumber', { n: item.readNumber }) }}
      </span>
      <span
        v-if="marks > 0 && !ribbon"
        class="absolute end-1.5 bottom-1.5 inline-flex h-[18px] items-center gap-0.5 rounded-full bg-black/75 px-1.5 text-[10px] font-bold text-white"
      >
        <Highlighter class="size-2.5" aria-hidden="true" />{{ marks }}
      </span>
      <span
        v-if="ribbon"
        class="absolute inset-x-0 bottom-0 truncate rounded-b-md px-1.5 py-0.5 text-center text-[10px] font-bold text-white"
        :class="ribbon.tone"
        >{{ ribbon.label }}</span
      >
    </span>
    <span class="line-clamp-2 text-xs leading-4 font-semibold text-foreground">{{ title }}</span>
    <span class="-mt-0.5 flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
      <span class="truncate">{{ item.endedOn ? formatDay(item.endedOn) : t('readingHistory.row.noDate') }}</span>
      <HistoryStars v-if="item.rating" :rating="item.rating" :size="10" />
    </span>
  </button>
</template>
