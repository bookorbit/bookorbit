<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardDrive } from '@lucide/vue'

import { formatBytes } from '@/lib/formatting'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { useLargestBooks } from '../../composables/useLargestBooks'
import type { ChartDrillDownTarget } from '../../lib/chart-drill-down'
import ChartCard from '../ChartCard.vue'
import ChartDrillDown from '../ChartDrillDown.vue'

const { t } = useI18n()

const { data, loading, error } = useLargestBooks()
// Ascending, because the category axis draws its first entry at the bottom: the largest sits on top.
const ascendingItems = computed(() => [...data.value.items].sort((a, b) => a.sizeBytes - b.sizeBytes))
const option = shallowRef({})

const targets = computed<ChartDrillDownTarget[]>(() =>
  ascendingItems.value
    .map((item, dataIndex) => ({
      dataIndex,
      text: t('statistics.drillDown.entrySize', { name: item.title, size: formatBytes(item.sizeBytes) }),
      to: { name: 'book-detail', params: { bookId: item.id } },
    }))
    .reverse(),
)

watchEffect(() => {
  if (!data.value.items.length) return

  const sortedItems = ascendingItems.value

  option.value = {
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      textStyle: { fontSize: 12 },
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        return `${p.name}: <strong>${formatBytes(p.value)}</strong>`
      },
    },
    grid: { left: '3%', right: '10%', bottom: '5%', top: '3%', containLabel: true },
    dataZoom: [
      {
        type: 'inside',
        yAxisIndex: 0,
        startValue: Math.max(0, sortedItems.length - 10),
        endValue: sortedItems.length - 1,
        zoomOnMouseWheel: false,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
      },
      {
        type: 'slider',
        yAxisIndex: 0,
        right: '2%',
        width: 15,
        borderColor: 'transparent',
        fillerColor: 'rgba(150, 150, 150, 0.2)',
        handleSize: 0,
        showDetail: false,
        brushSelect: false,
      },
    ],
    xAxis: {
      type: 'value',
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => formatBytes(v),
      },
    },
    yAxis: {
      type: 'category',
      data: sortedItems.map((d) => d.title),
      triggerEvent: true,
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        width: 200,
        overflow: 'truncate',
      },
    },
    series: [
      {
        type: 'bar',
        data: sortedItems.map((d) => d.sizeBytes),
        itemStyle: {
          borderRadius: [0, 3, 3, 0],
          color: (params: { dataIndex: number }) => getFormatColor(sortedItems[params.dataIndex]?.format),
        },
        barCategoryGap: '20%',
        barMaxWidth: 32,
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.largestBooks.title')" :icon="HardDrive" :color-index="2" :loading :error :empty="!data.items.length">
    <ChartDrillDown :option :targets :label="t('statistics.charts.largestBooks.title')" hit="category" />
  </ChartCard>
</template>
