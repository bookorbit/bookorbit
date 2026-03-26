<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Clock3 } from 'lucide-vue-next'

import { useUserPeakReadingHours } from '../../composables/useUserPeakReadingHours'
import ChartCard from '../ChartCard.vue'

const MIN_EVENTS = 20

const { data, loading, error } = useUserPeakReadingHours()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((sum, item) => sum + item.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number; dataIndex: number }>) => {
        const point = params[0]
        if (!point) return ''
        const events = data.value[point.dataIndex]?.eventsCount ?? 0
        const minuteLabel = point.data === 1 ? 'minute' : 'minutes'
        const eventLabel = events === 1 ? 'event' : 'events'
        return `${point.axisValue}<br/><strong>${point.data}</strong> ${minuteLabel}<br/>${events} ${eventLabel}`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.map((item) => `${String(item.hour).padStart(2, '0')}:00`),
      axisTick: { show: false },
      axisLabel: { fontSize: 11, interval: 1 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { fontSize: 11, formatter: '{value}m' },
      name: 'Minutes',
      nameTextStyle: { fontSize: 11, color: 'var(--muted-foreground)' },
    },
    series: [
      {
        type: 'bar',
        data: data.value.map((item) => Math.round(item.readingSeconds / 60)),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Peak Reading Hours" :icon="Clock3" :color-index="5" :loading :error :empty="isEmpty">
    <div v-if="lowConfidence" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_EVENTS }} reading events for a stable hourly profile
    </div>
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
