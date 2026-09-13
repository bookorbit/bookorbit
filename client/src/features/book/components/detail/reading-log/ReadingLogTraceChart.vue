<script setup lang="ts">
import { computed, onMounted, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import type { BookReadingSession, BookReadingSessionStats, ReadingSessionSourceBucket } from '@bookorbit/types'
import { toReadingSessionSourceBucket, READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes, readCssColor } from '@/lib/echarts'

const props = defineProps<{
  sessions: BookReadingSession[]
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const chartTheme = computed(() => getBookorbitThemeName(themeStore.resolvedTheme, themeStore.accent))
const option = shallowRef({})

onMounted(() => initChartThemes())

const DAY_MS = 24 * 60 * 60 * 1000
const BUCKET_TOKEN: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

function localDayKey(iso: string): string {
  const value = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

// Days come from the sessions themselves rather than from `dailySummary`, whose keys are cut in
// the account's time zone: a reader an hour either side of it would otherwise plot every session
// into the first column.
const activeDays = computed(() => [...new Set(props.sessions.map((session) => localDayKey(session.startedAt)))].sort())

const hasData = computed(() => props.sessions.length > 0)

/** One sitting has no useful day axis: plot the sessions themselves instead. */
const singleSitting = computed(() => activeDays.value.length <= 1)

function dayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  return formatDate(new Date(year!, month! - 1, day!), { month: 'short', day: 'numeric' })
}

function timeLabel(iso: string): string {
  return formatDate(new Date(iso), { hour: '2-digit', minute: '2-digit' })
}

function renderTraceItem(
  params: { dataIndex: number },
  api: {
    value: (dim: number) => number
    coord: (data: number[]) => [number, number]
    size: (data: number[]) => [number, number]
    visual: (key: string) => string | number
  },
) {
  const index = api.value(0)
  const low = api.value(1)
  const high = api.value(2)
  const slot = api.value(3)
  const slots = Math.max(1, api.value(4))

  const top = api.coord([index, high])
  const bottom = api.coord([index, low])
  const band = api.size([1, 0])[0]
  const width = Math.max(2.5, Math.min(11, (band - 2) / slots))
  const offset = (slot - (slots - 1) / 2) * width
  const height = Math.max(3, bottom[1] - top[1])

  return {
    type: 'rect',
    shape: { x: top[0] + offset - width / 2, y: top[1], width, height, r: Math.min(width / 2, 3) },
    style: { fill: String(api.visual('color')), opacity: Number(api.visual('opacity') ?? 1) },
  }
}

watchEffect(() => {
  if (!hasData.value) {
    option.value = {}
    return
  }

  const ordered = [...props.sessions].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))

  let categories: string[]
  let indexOf: (session: BookReadingSession) => number
  if (singleSitting.value) {
    categories = ordered.map((session) => timeLabel(session.startedAt))
    const positions = new Map(ordered.map((session, index) => [session.id, index]))
    indexOf = (session) => positions.get(session.id) ?? 0
  } else {
    const first = Date.parse(`${activeDays.value[0]}T12:00:00Z`)
    const last = Date.parse(`${activeDays.value[activeDays.value.length - 1]!}T12:00:00Z`)
    const keys: string[] = []
    for (let stamp = first; stamp <= last; stamp += DAY_MS) keys.push(new Date(stamp).toISOString().slice(0, 10))
    categories = keys
    const positions = new Map(keys.map((key, index) => [key, index]))
    indexOf = (session) => positions.get(localDayKey(session.startedAt)) ?? 0
  }

  const perSlot = new Map<number, number>()
  for (const session of ordered) {
    const index = indexOf(session)
    perSlot.set(index, (perSlot.get(index) ?? 0) + 1)
  }
  const seen = new Map<number, number>()

  const seriesData = ordered.map((session) => {
    const index = indexOf(session)
    const slot = seen.get(index) ?? 0
    seen.set(index, slot + 1)
    const delta = session.progressDelta ?? 0
    const end = Math.max(0, Math.min(100, session.endProgress ?? 0))
    const from = Math.max(0, Math.min(100, end - delta))
    const backwards = delta < -0.5
    const color = backwards ? readCssColor('--pill-warning') : readCssColor(BUCKET_TOKEN[toReadingSessionSourceBucket(session.source)])
    return {
      value: [index, Math.min(from, end), Math.max(from, end), slot, perSlot.get(index) ?? 1],
      itemStyle: { color, opacity: backwards ? 0.95 : 0.85 },
      startedAt: session.startedAt,
      durationSeconds: session.durationSeconds,
      from,
      end,
      backwards,
      sourceLabel: READING_SESSION_SOURCE_BUCKET_LABELS[toReadingSessionSourceBucket(session.source)],
    }
  })

  // Where one attempt gave way to the next, so a reread reads as a break rather than a fall.
  const attemptBreaks: { xAxis: number }[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.attemptId === ordered[index - 1]!.attemptId) continue
    attemptBreaks.push({ xAxis: indexOf(ordered[index]!) })
  }

  option.value = {
    grid: { left: 34, right: 12, top: 12, bottom: 22, containLabel: false },
    tooltip: {
      trigger: 'item',
      formatter: (params: {
        data: { startedAt: string; durationSeconds: number; from: number; end: number; backwards: boolean; sourceLabel: string }
      }) => {
        const data = params.data
        if (!data) return ''
        const minutes = Math.max(1, Math.round(data.durationSeconds / 60))
        return [
          `<strong>${singleSitting.value ? timeLabel(data.startedAt) : `${dayLabel(localDayKey(data.startedAt))} ${timeLabel(data.startedAt)}`}</strong>`,
          t('book.detail.readingLog.band.tooltipCovered', { from: data.from.toFixed(1), to: data.end.toFixed(1) }),
          t('book.detail.readingLog.band.tooltipMinutes', { minutes }),
          data.sourceLabel,
        ].join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: singleSitting.value ? categories : categories.map(dayLabel),
      boundaryGap: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { opacity: 0.35 } },
      axisLabel: { fontSize: 10, hideOverlap: true, margin: 8 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { fontSize: 10, formatter: (value: number) => `${value}%` },
    },
    series: [
      {
        type: 'custom',
        renderItem: renderTraceItem,
        data: seriesData,
        encode: { x: 0, y: [1, 2] },
        markLine: attemptBreaks.length
          ? {
              symbol: 'none',
              silent: true,
              label: { show: false },
              lineStyle: { type: 'dashed', width: 1.2, opacity: 0.9 },
              data: attemptBreaks,
            }
          : undefined,
      },
    ],
  }
})
</script>

<template>
  <div v-if="hasData" class="relative min-h-0 flex-1 transition-opacity" :class="{ 'opacity-50': loading }">
    <VChart :theme="chartTheme" :option autoresize class="absolute inset-0" />
  </div>
  <div v-else-if="loading" class="flex flex-1 items-end gap-1 px-2 pb-5 pt-2" aria-hidden="true">
    <div v-for="bar in 18" :key="bar" class="flex-1 rounded-t bg-muted animate-shimmer" :style="{ height: `${18 + ((bar * 37) % 60)}%` }" />
  </div>
  <div v-else class="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
    <p class="text-[13px] font-medium text-foreground">{{ t('book.detail.readingLog.band.traceEmpty') }}</p>
    <p class="max-w-[46ch] text-xs leading-relaxed text-muted-foreground">{{ t('book.detail.readingLog.band.traceEmptyHint') }}</p>
  </div>
</template>
