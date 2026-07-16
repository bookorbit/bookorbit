<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Waypoints } from '@lucide/vue'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useUserProgressFunnel } from '../../composables/useUserProgressFunnel'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

type FunnelMode = 'percent' | 'counts' | 'dropoff'

const MIN_STARTED = 10

const { t } = useI18n()

const { data, loading, error } = useUserProgressFunnel()
const option = shallowRef({})
const mode = ref<FunnelMode>('percent')

const current = computed(() => data.value.current)
const previous = computed(() => data.value.previous)

const stages = computed(() => {
  const raw = [
    { key: 'started', label: 'Started', count: current.value.started },
    { key: 'reached25', label: '25%', count: current.value.reached25 },
    { key: 'reached50', label: '50%', count: current.value.reached50 },
    { key: 'reached75', label: '75%', count: current.value.reached75 },
    { key: 'completed', label: 'Finished', count: current.value.completed },
  ] as const

  return raw.map((stage, index) => {
    const prevStage = index === 0 ? stage : (raw[index - 1] ?? stage)
    const prevStageCount = prevStage.count
    const conversionFromStart = current.value.started > 0 ? (stage.count / current.value.started) * 100 : 0
    const conversionFromPrev = prevStageCount > 0 ? (stage.count / prevStageCount) * 100 : 0
    const dropFromPrev = index === 0 ? 0 : Math.max(0, prevStageCount - stage.count)
    return {
      ...stage,
      conversionFromStart,
      conversionFromPrev,
      dropFromPrev,
    }
  })
})

const transitionMetrics = computed(() =>
  stages.value.slice(1).map((stage, index) => ({
    label: `${(stages.value[index] ?? stage).label} -> ${stage.label}`,
    conversion: stage.conversionFromPrev,
    drop: stage.dropFromPrev,
  })),
)

const startedCount = computed(() => current.value.started)
const completionRate = computed(() => (startedCount.value > 0 ? (current.value.completed / startedCount.value) * 100 : 0))
const previousCompletionRate = computed(() => {
  if (!previous.value || previous.value.started <= 0) return null
  return (previous.value.completed / previous.value.started) * 100
})

const comparisonSummary = computed(() => {
  if (!previous.value) return null
  const startedDelta = current.value.started - previous.value.started
  const currentRate = completionRate.value
  const prevRate = previousCompletionRate.value ?? 0
  const rateDelta = currentRate - prevRate
  return { startedDelta, rateDelta }
})

const isEmpty = computed(() => startedCount.value === 0)
const lowConfidence = computed(() => startedCount.value > 0 && startedCount.value < MIN_STARTED)
const isFlatFunnel = computed(() => stages.value.every((stage) => stage.count === startedCount.value))
const showFlatState = computed(() => !isEmpty.value && !lowConfidence.value && isFlatFunnel.value)

const MODE_LABEL_KEYS: Record<FunnelMode, string> = {
  percent: 'statistics.charts.progressFunnel.modePercent',
  counts: 'statistics.charts.progressFunnel.modeCounts',
  dropoff: 'statistics.charts.progressFunnel.modeDropoff',
}
const selectedModeLabel = computed(() => t(MODE_LABEL_KEYS[mode.value]))

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || showFlatState.value) return

  if (mode.value === 'dropoff') {
    option.value = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ axisValue: string; data: number }>) => {
          const point = params[0]
          if (!point) return ''
          const plural = point.data === 1 ? 'book' : 'books'
          return `${point.axisValue}<br/>Drop-off: <strong>${point.data}</strong> ${plural}`
        },
      },
      grid: { left: '10%', right: '8%', bottom: '12%', top: '14%', containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        minInterval: 1,
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: transitionMetrics.value.map((metric) => metric.label),
        axisTick: { show: false },
        axisLabel: { fontSize: 11 },
        inverse: true,
      },
      series: [
        {
          type: 'bar',
          data: transitionMetrics.value.map((metric) => metric.drop),
          barWidth: 16,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            formatter: '{c}',
            fontSize: 11,
          },
        },
      ],
    }
    return
  }

  const funnelValues = stages.value.map((stage) => ({
    name: stage.label,
    value: mode.value === 'counts' ? stage.count : Number(stage.conversionFromStart.toFixed(1)),
    rawCount: stage.count,
    pct: Number(stage.conversionFromStart.toFixed(1)),
  }))

  const maxValue = mode.value === 'counts' ? Math.max(...stages.value.map((stage) => stage.count), 1) : 100

  option.value = {
    tooltip: {
      trigger: 'item',
      formatter: (params: { data: { name: string; rawCount: number; pct: number } }) => {
        const point = params.data
        const plural = point.rawCount === 1 ? 'book' : 'books'
        return `${point.name}<br/><strong>${point.rawCount}</strong> ${plural} (${point.pct.toFixed(1)}%)`
      },
    },
    series: [
      {
        type: 'funnel',
        sort: 'none',
        top: 18,
        bottom: 16,
        left: '16%',
        width: '68%',
        gap: 6,
        min: 0,
        max: maxValue,
        minSize: '28%',
        maxSize: '100%',
        label: {
          show: true,
          position: 'inside',
          fontSize: 11,
          formatter: (params: { data: { name: string; rawCount: number; pct: number } }) =>
            mode.value === 'counts' ? `${params.data.name}: ${params.data.rawCount}` : `${params.data.name}: ${params.data.pct.toFixed(1)}%`,
        },
        labelLine: { show: false },
        itemStyle: {
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          borderRadius: 3,
        },
        data: funnelValues,
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.progressFunnel.title')" :icon="Waypoints" :color-index="10" :loading :error :empty="isEmpty">
    <template #controls>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="border-border text-muted-foreground hover:text-foreground rounded-md border px-2 py-1 text-xs transition-colors">
            {{ selectedModeLabel }}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="text-xs">
          <DropdownMenuItem @click="mode = 'percent'">{{ t('statistics.charts.progressFunnel.modePercent') }}</DropdownMenuItem>
          <DropdownMenuItem @click="mode = 'counts'">{{ t('statistics.charts.progressFunnel.modeCounts') }}</DropdownMenuItem>
          <DropdownMenuItem @click="mode = 'dropoff'">{{ t('statistics.charts.progressFunnel.modeDropoff') }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Waypoints"
      :title="t('statistics.empty.notEnoughData')"
      :description="t('statistics.charts.progressFunnel.notEnoughData', { count: MIN_STARTED })"
    />
    <ChartEmptyState
      v-else-if="showFlatState"
      :icon="Waypoints"
      :title="t('statistics.charts.progressFunnel.noDropOffTitle')"
      :description="t('statistics.charts.progressFunnel.noDropOffDescription')"
    />
    <div v-else class="flex h-full min-h-0 flex-col gap-2.5">
      <div class="flex flex-wrap gap-1.5 text-xs">
        <span class="border-border bg-muted/20 rounded-md border px-2 py-1">
          {{ t('statistics.charts.progressFunnel.started', { count: current.started }) }}
          <span v-if="comparisonSummary" class="text-muted-foreground">
            ({{ comparisonSummary.startedDelta >= 0 ? '+' : '' }}{{ comparisonSummary.startedDelta }})
          </span>
        </span>
        <span class="border-border bg-muted/20 rounded-md border px-2 py-1">
          {{ completionRate.toFixed(1) }}%
          <span v-if="comparisonSummary" :class="comparisonSummary.rateDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'">
            ({{ comparisonSummary.rateDelta >= 0 ? '+' : '' }}{{ comparisonSummary.rateDelta.toFixed(1) }}pp)
          </span>
        </span>
      </div>

      <div class="border-border/60 bg-muted/10 min-h-[180px] flex-1 rounded-lg border p-2 md:min-h-[220px]">
        <VChart :option autoresize class="h-full w-full" />
      </div>
    </div>
  </ChartCard>
</template>
