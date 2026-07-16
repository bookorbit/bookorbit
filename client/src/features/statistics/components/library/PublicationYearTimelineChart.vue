<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { TrendingUp } from '@lucide/vue'

import { usePublicationYearTimeline } from '../../composables/usePublicationYearTimeline'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = usePublicationYearTimeline()
const option = shallowRef({})

const currentYear = new Date().getFullYear()

const filled = computed(() => {
  const pts = data.value.items
  if (!pts.length) return []
  const byYear = new Map(pts.map((p) => [p.year, p]))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last) return []
  const min = first.year
  const max = last.year
  const result = []
  for (let y = min; y <= max; y++) {
    const p = byYear.get(y)
    result.push({ year: y, count: p?.count ?? 0, topTitles: p?.topTitles ?? [] })
  }
  return result
})

const movingAvg = computed(() => {
  const f = filled.value
  return f.map((_, i) => {
    const lo = Math.max(0, i - 2)
    const hi = Math.min(f.length - 1, i + 2)
    const sum = f.slice(lo, hi + 1).reduce((s, p) => s + p.count, 0)
    return +(sum / (hi - lo + 1)).toFixed(2)
  })
})

const goldenEra = computed(() => {
  const f = filled.value
  if (f.length < 2) return null
  const first = f[0]
  const last = f[f.length - 1]
  if (!first || !last) return null

  let best = { start: first.year, end: first.year, count: 0 }
  for (let i = 0; i < f.length; i++) {
    const current = f[i]
    if (!current) continue
    const windowEnd = current.year + 19
    const count = f
      .slice(i)
      .filter((p) => p.year <= windowEnd)
      .reduce((s, p) => s + p.count, 0)
    if (count > best.count) {
      best = { start: current.year, end: Math.min(windowEnd, last.year), count }
    }
  }
  return best
})

const peakItem = computed(() => {
  if (!filled.value.length) return null
  const first = filled.value[0]
  if (!first) return null
  return filled.value.reduce((best, p) => (p.count > best.count ? p : best), first)
})

const statCards = computed(() => {
  const items = data.value.items
  if (!items.length) return null
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return null
  const total = items.reduce((s, p) => s + p.count, 0)
  const last10 = items.filter((p) => p.year >= currentYear - 10).reduce((s, p) => s + p.count, 0)
  const classics = items.filter((p) => p.year < 1970).reduce((s, p) => s + p.count, 0)
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%')
  return [
    { label: 'Peak year', value: peakItem.value?.year ?? 0, sub: `${peakItem.value?.count ?? 0} books` },
    { label: 'Last 10 years', value: pct(last10), sub: 'of library' },
    { label: 'Classics', value: pct(classics), sub: 'pre-1970' },
    { label: 'Unique years', value: items.length, sub: 'with books' },
    { label: 'Year span', value: last.year - first.year, sub: 'years covered' },
    { label: 'Avg per year', value: items.length > 0 ? +(total / items.length).toFixed(1) : 0, sub: 'books' },
  ]
})

watchEffect(() => {
  option.value = {}
  const f = filled.value
  if (!f.length) return

  const years = f.map((p) => String(p.year))
  const counts = f.map((p) => p.count)
  const avg = movingAvg.value
  const peak = peakItem.value
  const era = goldenEra.value

  const markAreaData = era
    ? [
        [
          {
            xAxis: String(era.start),
            itemStyle: { color: 'rgba(128,128,128,0.07)' },
            label: { show: true, position: 'insideTopLeft', formatter: 'Golden Era', fontSize: 10, opacity: 0.45 },
          },
          { xAxis: String(era.end) },
        ],
      ]
    : []

  const markPointData = peak
    ? [
        {
          coord: [String(peak.year), peak.count],
          name: 'Peak',
          value: peak.year,
          symbolSize: 30,
          label: { fontSize: 9, fontWeight: 'bold' },
        },
      ]
    : []

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; seriesName: string; data: number }>) => {
        const main = params.find((p) => p.seriesName === 'Books')
        if (!main) return ''
        const year = parseInt(main.axisValue)
        const pt = data.value.items.find((p) => p.year === year)
        const count = main.data
        const bookLabel = count === 1 ? 'book' : 'books'
        let html = `<strong>${main.axisValue}</strong><br/>${count} ${bookLabel}`
        if (pt?.topTitles?.length) {
          html += '<br/><span style="opacity:0.65;font-size:11px">' + pt.topTitles.map((t) => `- ${t}`).join('<br/>') + '</span>'
        }
        return html
      },
    },
    grid: { left: '3%', right: '3%', bottom: 60, top: 16, containLabel: true },
    dataZoom: [
      {
        type: 'slider',
        bottom: 6,
        height: 18,
        start: 0,
        end: 100,
        borderColor: 'transparent',
        fillerColor: 'rgba(128,128,128,0.15)',
      },
      { type: 'inside' },
    ],
    xAxis: {
      type: 'category',
      data: years,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        interval: Math.max(0, Math.floor(years.length / 12) - 1),
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: 'Books',
        type: 'line',
        data: counts,
        smooth: 0.3,
        showSymbol: false,
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2 },
        markArea: {
          silent: true,
          data: markAreaData,
        },
        markPoint: {
          data: markPointData,
          label: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
        },
      },
      {
        name: '5yr Avg',
        type: 'line',
        data: avg,
        smooth: 0.4,
        showSymbol: false,
        lineStyle: { type: 'dashed', width: 1.5, opacity: 0.5 },
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.publicationYearTimeline.title')"
    :icon="TrendingUp"
    :color-index="4"
    :loading
    :error
    :empty="!data.items.length"
  >
    <div class="flex h-full flex-col">
      <VChart :option autoresize style="flex: 1; min-height: 0" />
      <div v-if="statCards" class="mt-2 grid grid-cols-6 gap-2 md:gap-8 px-1">
        <div v-for="card in statCards" :key="card.label" class="bg-muted/40 border-border/60 rounded-md border px-2 py-1 text-center">
          <p class="text-muted-foreground text-[10px] leading-none">{{ card.label }}</p>
          <p class="mt-1 text-sm font-semibold leading-none tabular-nums">{{ card.value }}</p>
          <p class="text-muted-foreground text-[10px] leading-none">{{ card.sub }}</p>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
