<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Clock } from 'lucide-vue-next'

import { useUserPeakReadingHours } from '../../composables/useUserPeakReadingHours'
import ChartCard from '../ChartCard.vue'

const HOUR_LABELS = [
  '12am',
  '1am',
  '2am',
  '3am',
  '4am',
  '5am',
  '6am',
  '7am',
  '8am',
  '9am',
  '10am',
  '11am',
  '12pm',
  '1pm',
  '2pm',
  '3pm',
  '4pm',
  '5pm',
  '6pm',
  '7pm',
  '8pm',
  '9pm',
  '10pm',
  '11pm',
]

const MIN_EVENTS = 20

const { data, loading, error } = useUserPeakReadingHours()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((s, d) => s + d.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)

const peakHour = computed(() => {
  if (!data.value.length) return null
  return data.value.reduce((best, d) => (d.readingSeconds > best.readingSeconds ? d : best))
})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const values = data.value.map((d) => Math.round(d.readingSeconds / 60))

  option.value = {
    polar: { radius: ['20%', '80%'] },
    angleAxis: {
      type: 'category',
      data: HOUR_LABELS,
      startAngle: 90,
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
      trigger: 'item',
      formatter: (params: { dataIndex: number; data: number }) => {
        const label = HOUR_LABELS[params.dataIndex]
        const mins = params.data
        const events = data.value[params.dataIndex]?.eventsCount ?? 0
        const eventLabel = events === 1 ? 'session' : 'sessions'
        return `<strong>${label}</strong><br/>${mins} min<br/>${events} ${eventLabel}`
      },
    },
    series: [
      {
        type: 'bar',
        data: values,
        coordinateSystem: 'polar',
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Reading Clock" :icon="Clock" :color-index="5" :loading :error :empty="isEmpty">
    <div v-if="lowConfidence" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_EVENTS }} sessions for a stable clock
    </div>
    <template v-else>
      <div v-if="peakHour" class="text-muted-foreground mb-1 text-center text-xs">
        Peak: <span class="text-foreground font-medium">{{ HOUR_LABELS[peakHour.hour] }}</span>
      </div>
      <VChart :option autoresize style="height: calc(100% - 20px)" />
    </template>
  </ChartCard>
</template>
