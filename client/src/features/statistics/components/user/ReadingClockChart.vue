<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Clock } from '@lucide/vue'
import type { ReadingSessionSourceBucket } from '@bookorbit/types'

import { useThemeStore } from '@/stores/theme'
import { getBreakdownSeries, type BreakdownDimension } from '../../lib/breakdown'
import { useUserPeakReadingHours } from '../../composables/useUserPeakReadingHours'
import BreakdownSelect from '../BreakdownSelect.vue'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

// prettier-ignore
const HOUR_LABELS = [
  '12a', '1a',  '2a',  '3a',  '4a',  '5a',
  '6a',  '7a',  '8a',  '9a',  '10a', '11a',
  '12p', '1p',  '2p',  '3p',  '4p',  '5p',
  '6p',  '7p',  '8p',  '9p',  '10p', '11p',
]

const MIN_EVENTS = 20

const themeStore = useThemeStore()
const { data, loading, error } = useUserPeakReadingHours()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((s, d) => s + d.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)
const dimension = ref<BreakdownDimension>('source')

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

const peakHour = computed(() => {
  if (!data.value.length) return null
  return data.value.reduce((best, d) => (d.readingSeconds > best.readingSeconds ? d : best))
})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const formatKeys = [...new Set(data.value.flatMap((d) => Object.keys(d.byFormat)))].sort()
  const seriesMeta = getBreakdownSeries(dimension.value, `${themeStore.theme}:${themeStore.accent}`, formatKeys)

  const series = seriesMeta.map((meta) => ({
    type: 'bar',
    name: meta.label,
    data: data.value.map(
      (d) => ((dimension.value === 'source' ? d.bySource?.[meta.key as ReadingSessionSourceBucket] : d.byFormat?.[meta.key]) ?? 0) / 60,
    ),
    coordinateSystem: 'polar',
    stack: 'clock',
    itemStyle: { color: meta.color },
  }))

  option.value = {
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    polar: { radius: ['18%', '74%'], center: ['50%', '46%'] },
    angleAxis: {
      type: 'category',
      data: HOUR_LABELS,
      startAngle: 82.5,
      clockwise: false,
      axisLabel: { fontSize: 10 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    radiusAxis: {
      min: 0,
      axisLabel: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      axisPointer: { type: 'none' },
      formatter: (params: { dataIndex: number; seriesName: string; data: number; color: string }[]) => {
        if (!params.length) return ''
        const idx = params[0]!.dataIndex
        const from = HOUR_LABELS[idx]
        const to = HOUR_LABELS[(idx + 1) % 24]
        const totalSeconds = data.value[idx]?.readingSeconds ?? 0
        const events = data.value[idx]?.eventsCount ?? 0
        const eventLabel = events === 1 ? 'session' : 'sessions'
        const active = params.filter((p) => p.data > 0)
        const formatRows =
          active.length > 0
            ? `<div style="border-top:1px solid rgba(128,128,128,0.2);margin-top:5px;padding-top:5px">${active
                .map((p) => {
                  const sourceSeconds = (p.data ?? 0) * 60
                  return (
                    `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">` +
                    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></span>` +
                    `<span style="color:rgba(180,180,180,0.9)">${p.seriesName}</span>` +
                    `<span style="margin-left:auto;padding-left:12px">${formatDuration(sourceSeconds)}</span>` +
                    `</div>`
                  )
                })
                .join('')}</div>`
            : ''
        return (
          `<div style="font-size:12px;line-height:1.5">` +
          `<div><span style="font-weight:600">${from} – ${to}</span> <span style="color:rgba(180,180,180,0.9);margin-left:4px">${formatDuration(totalSeconds)} · ${events} ${eventLabel}</span></div>` +
          formatRows +
          `</div>`
        )
      },
    },
    series,
  }
})
</script>

<template>
  <ChartCard title="Reading Clock" :icon="Clock" :color-index="5" :loading :error :empty="isEmpty">
    <template #controls>
      <BreakdownSelect v-model="dimension" />
    </template>
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Clock"
      title="Not enough data yet"
      :description="`Need at least ${MIN_EVENTS} reading sessions for this chart.`"
    />
    <template v-else>
      <div v-if="peakHour" class="text-muted-foreground mb-1 text-center text-xs">
        Peak: <span class="text-foreground font-medium">{{ HOUR_LABELS[peakHour.hour] }}</span>
      </div>
      <VChart :option autoresize style="height: calc(100% - 20px)" />
    </template>
  </ChartCard>
</template>
