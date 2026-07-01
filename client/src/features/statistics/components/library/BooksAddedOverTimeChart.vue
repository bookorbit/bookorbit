<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { TrendingUp } from '@lucide/vue'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useBooksAddedOverTime } from '../../composables/useBooksAddedOverTime'
import { useStatisticsConfig } from '../../composables/useStatisticsConfig'
import ChartCard from '../ChartCard.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const { t } = useI18n()

const { data, loading, error } = useBooksAddedOverTime()
const { filters, setGranularity, setDateRange } = useStatisticsConfig()

const dateRangeLabels = computed<Record<string, string>>(() => ({
  'all-time': t('statistics.charts.booksAddedOverTime.allTime'),
  'last-5-years': t('statistics.charts.booksAddedOverTime.last5Years'),
  'last-year': t('statistics.charts.booksAddedOverTime.lastYear'),
}))

const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  const isYearly = filters.value.booksOverTimeGranularity === 'yearly'
  const labels = data.value.items.map((d) => (isYearly ? String(d.year) : `${MONTH_NAMES[d.month - 1]} ${d.year}`))

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        return `${p.name}: <strong>${p.value}</strong> books`
      },
    },
    grid: { left: '3%', right: '4%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        rotate: 45,
        interval: Math.max(0, Math.floor(data.value.items.length / 8) - 1),
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: data.value.items.map((d) => d.count),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 40,
      },
    ],
  }
})

function handleMonthly() {
  setGranularity('monthly')
}

function handleYearly() {
  setGranularity('yearly')
}

function handleAllTime() {
  setDateRange('all-time')
}

function handleLast5Years() {
  setDateRange('last-5-years')
}

function handleLastYear() {
  setDateRange('last-year')
}
</script>

<template>
  <ChartCard :title="t('statistics.charts.booksAddedOverTime.title')" :icon="TrendingUp" :color-index="3" :loading :error :empty="!data.items.length">
    <template #controls>
      <div class="flex items-center gap-1">
        <div class="border-border flex rounded-md border text-xs">
          <button
            :class="[
              'rounded-l-md px-2 py-1 transition-colors',
              filters.booksOverTimeGranularity === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="handleMonthly"
          >
            {{ t('statistics.charts.booksAddedOverTime.monthly') }}
          </button>
          <button
            :class="[
              'rounded-r-md px-2 py-1 transition-colors',
              filters.booksOverTimeGranularity === 'yearly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="handleYearly"
          >
            {{ t('statistics.charts.booksAddedOverTime.yearly') }}
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button class="border-border text-muted-foreground hover:text-foreground rounded-md border px-2 py-1 text-xs transition-colors">
              {{ dateRangeLabels[filters.booksOverTimeRange] }}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="text-xs">
            <DropdownMenuItem @click="handleAllTime">{{ t('statistics.charts.booksAddedOverTime.allTime') }}</DropdownMenuItem>
            <DropdownMenuItem @click="handleLast5Years">{{ t('statistics.charts.booksAddedOverTime.last5Years') }}</DropdownMenuItem>
            <DropdownMenuItem @click="handleLastYear">{{ t('statistics.charts.booksAddedOverTime.lastYear') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>

    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
