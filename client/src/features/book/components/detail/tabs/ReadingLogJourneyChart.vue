<script setup lang="ts">
import { computed, onMounted, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { TrendingUp } from '@lucide/vue'
import type { BookReadingSession, BookReadingSessionStats } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'

const props = defineProps<{
  sessions: BookReadingSession[]
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const chartTheme = computed(() => getBookorbitThemeName(themeStore.theme, themeStore.accent))
const option = shallowRef({})

onMounted(() => initChartThemes())

const hasData = computed(() => {
  if (props.sessions.length > 0) return true
  const stats = props.stats
  if (!stats) return false
  return stats.progressSummary.length > 0 || stats.dailySummary.length > 0
})

function formatDayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSessionLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatSessionTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  if (minutes > 0) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
  return `${remainder}s`
}

const useSessionTimeline = computed(() => {
  if (props.sessions.length < 2) return false
  const days = new Set(props.sessions.map((session) => new Date(session.startedAt).toDateString()))
  return days.size === 1
})

const chartSubtitle = computed(() => (useSessionTimeline.value ? 'Progress across each recorded session' : 'Minutes read and progress by day'))

watchEffect(() => {
  const stats = props.stats
  if (!hasData.value || (!stats && props.sessions.length === 0)) {
    option.value = {}
    return
  }

  let labels: string[]
  let timestamps: string[]
  let progress: Array<number | null>
  let minutes: number[]
  let durationLabels: string[]

  if (useSessionTimeline.value) {
    const timeline = [...props.sessions].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime())
    labels = timeline.map((session) => formatSessionLabel(session.startedAt))
    timestamps = timeline.map((session) => formatSessionTimestamp(session.startedAt))
    progress = timeline.map((session) => session.endProgress)
    minutes = timeline.map((session) => Math.round((session.durationSeconds / 60) * 10) / 10)
    durationLabels = timeline.map((session) => formatDuration(session.durationSeconds))
  } else {
    const days = [
      ...new Set([...(stats?.progressSummary.map((point) => point.day) ?? []), ...(stats?.dailySummary.map((day) => day.day) ?? [])]),
    ].sort()
    const progressByDay = new Map(stats?.progressSummary.map((point) => [point.day, point.endProgress]) ?? [])
    const minutesByDay = new Map(stats?.dailySummary.map((day) => [day.day, day.totalMinutes]) ?? [])
    labels = days.map(formatDayLabel)
    timestamps = days.map(formatDayLabel)
    progress = days.map((day) => progressByDay.get(day) ?? null)
    minutes = days.map((day) => minutesByDay.get(day) ?? 0)
    durationLabels = minutes.map((value) => `${value} min`)
  }

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { seriesName: string; value: number | null; dataIndex: number }[]) => {
        if (!params.length) return ''
        const index = params[0]!.dataIndex
        const lines = params.flatMap((point) => {
          if (point.value == null) return []
          return point.seriesName === 'Progress'
            ? [`Progress: <strong>${point.value.toFixed(1)}%</strong>`]
            : [`Reading: <strong>${durationLabels[index] ?? ''}</strong>`]
        })
        return [timestamps[index] ?? '', ...lines].join('<br/>')
      },
    },
    grid: { left: 36, right: 38, top: 18, bottom: 26, containLabel: false },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { opacity: 0.35 } },
      axisLabel: { fontSize: 10, hideOverlap: true, margin: 10 },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 4,
        axisLabel: { fontSize: 10, formatter: (value: number) => `${value}%` },
      },
      {
        type: 'value',
        minInterval: 1,
        splitLine: { show: false },
        axisLabel: { fontSize: 10, formatter: (value: number) => `${value}m` },
      },
    ],
    series: [
      {
        name: 'Reading time',
        type: 'bar',
        yAxisIndex: 1,
        data: minutes,
        barMaxWidth: 18,
        itemStyle: { borderRadius: [4, 4, 0, 0], opacity: 0.42 },
      },
      {
        name: 'Progress',
        type: 'line',
        yAxisIndex: 0,
        data: progress,
        showSymbol: true,
        symbolSize: 6,
        connectNulls: true,
        lineStyle: { width: 2.5 },
        z: 3,
      },
    ],
  }
})
</script>

<template>
  <section
    class="flex min-h-[260px] flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-xs)]"
    aria-labelledby="progress-journey-heading"
  >
    <div class="mb-3 flex items-start gap-2.5">
      <div class="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
        <TrendingUp class="size-4" />
      </div>
      <div>
        <h2 id="progress-journey-heading" class="text-sm font-semibold text-foreground">{{ t('book.detail.readingLog.journey.title') }}</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ chartSubtitle }}</p>
      </div>
    </div>
    <div v-if="hasData" class="relative min-h-0 flex-1 transition-opacity" :class="{ 'opacity-50': loading }" style="min-height: 190px">
      <VChart :theme="chartTheme" :option autoresize class="absolute inset-0" />
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center py-10 text-center" style="min-height: 190px">
      <p class="text-sm font-medium text-foreground">{{ t('book.detail.readingLog.journey.empty') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.readingLog.journey.emptyHint') }}</p>
    </div>
  </section>
</template>
