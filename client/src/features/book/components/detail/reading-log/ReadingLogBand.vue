<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookReadingSession, BookReadingSessionStats } from '@bookorbit/types'
import { useReadingLogInsights } from '@/features/book/composables/useReadingLogInsights'
import ReadingLogProgressChart from './ReadingLogProgressChart.vue'
import ReadingLogTraceChart from './ReadingLogTraceChart.vue'

const props = defineProps<{
  sessions: BookReadingSession[]
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const { t } = useI18n()

const STORAGE_KEY = 'bookorbit.readingLog.bandView'
type BandView = 'curve' | 'trace'

function readStoredView(): BandView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'trace' ? 'trace' : 'curve'
  } catch {
    return 'curve'
  }
}

const view = ref<BandView>(readStoredView())

watch(view, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // A viewer with site data blocked simply does not get the preference remembered.
  }
})

const statsRef = computed(() => props.stats)
const { activeDays, spanDays } = useReadingLogInsights(statsRef)

const views = computed<{ value: BandView; label: string }[]>(() => [
  { value: 'curve', label: t('book.detail.readingLog.band.curve') },
  { value: 'trace', label: t('book.detail.readingLog.band.trace') },
])

const title = computed(() => (view.value === 'trace' ? t('book.detail.readingLog.band.traceTitle') : t('book.detail.readingLog.band.curveTitle')))

const subtitle = computed(() => {
  if (view.value === 'trace') {
    const backtracks = props.stats?.backtrackCount ?? 0
    return backtracks > 0
      ? t('book.detail.readingLog.band.traceSubWithBacktracks', { count: backtracks }, backtracks)
      : t('book.detail.readingLog.band.traceSub')
  }
  if (spanDays.value > 1) return t('book.detail.readingLog.band.curveSubDays', { active: activeDays.value, total: spanDays.value })
  if ((props.stats?.totalSessions ?? 0) > 0) return t('book.detail.readingLog.band.curveSubSitting')
  return ''
})

const legend = computed(() =>
  view.value === 'trace'
    ? [
        { key: 'bookorbit', label: 'BookOrbit', color: 'var(--pill-web)', shape: 'block' as const },
        { key: 'koreader', label: 'KOReader', color: 'var(--pill-koreader)', shape: 'block' as const },
        { key: 'kobo', label: 'Kobo', color: 'var(--pill-kobo)', shape: 'block' as const },
        { key: 'backtrack', label: t('book.detail.readingLog.band.legendBacktrack'), color: 'var(--pill-warning)', shape: 'block' as const },
      ]
    : [
        { key: 'position', label: t('book.detail.readingLog.band.legendPosition'), color: 'var(--primary)', shape: 'line' as const },
        { key: 'minutes', label: t('book.detail.readingLog.band.legendMinutes'), color: 'var(--primary)', shape: 'block' as const },
      ],
)

function handleViewClick(event: MouseEvent) {
  const value = (event.currentTarget as HTMLElement).dataset.bandView as BandView | undefined
  if (value) view.value = value
}
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card" :aria-label="title">
    <header class="flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ title }}</h2>
      <p v-if="subtitle" class="truncate text-[11px] text-muted-foreground">{{ subtitle }}</p>
      <ul class="ml-auto hidden items-center gap-3 sm:flex">
        <li v-for="entry in legend" :key="entry.key" class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            class="shrink-0"
            :class="entry.shape === 'line' ? 'h-0.5 w-2.5 rounded-full' : 'h-2 w-1.5 rounded-[2px]'"
            :style="{ backgroundColor: entry.color, opacity: entry.key === 'minutes' ? 0.4 : 1 }"
            aria-hidden="true"
          />
          {{ entry.label }}
        </li>
      </ul>
      <div
        class="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 sm:ml-0"
        role="group"
        :aria-label="t('book.detail.readingLog.band.switchAria')"
      >
        <button
          v-for="entry in views"
          :key="entry.value"
          :data-band-view="entry.value"
          class="h-5 rounded-md px-2 text-[11px] font-medium transition-colors"
          :class="view === entry.value ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="view === entry.value"
          @click="handleViewClick"
        >
          {{ entry.label }}
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col px-2.5 pb-2 pt-1.5">
      <ReadingLogTraceChart v-if="view === 'trace'" :sessions="sessions" :stats="stats" :loading="loading" />
      <ReadingLogProgressChart v-else :sessions="sessions" :stats="stats" :loading="loading" />
    </div>
  </section>
</template>
