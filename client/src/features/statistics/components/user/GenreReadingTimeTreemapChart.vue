<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Tag } from 'lucide-vue-next'

import { useThemeStore } from '@/stores/theme'
import { getThemePalette, readCssColor } from '@/lib/echarts'
import { useUserGenreReadingTime } from '../../composables/useUserGenreReadingTime'
import ChartCard from '../ChartCard.vue'

const MIN_GENRES = 2

const themeStore = useThemeStore()
const { data, loading, error } = useUserGenreReadingTime()

const totalSeconds = computed(() => data.value.reduce((s, item) => s + item.readingSeconds, 0))
const isEmpty = computed(() => totalSeconds.value === 0)
const hasEnoughData = computed(() => data.value.length >= MIN_GENRES)

const option = shallowRef({})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !hasEnoughData.value || !data.value.length) return

  const palette = getThemePalette(themeStore.theme, themeStore.accent, 0.8, 0.8)
  const background = readCssColor('--background')

  option.value = {
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: (params: { name: string; value: number }) => {
        const hours = (params.value / 3600).toFixed(1)
        const pct = totalSeconds.value > 0 ? ((params.value / totalSeconds.value) * 100).toFixed(1) : '0'
        return `<strong>${params.name}</strong><br/>${hours}h reading time<br/>${pct}% of total`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        top: 20,
        bottom: 20,
        data: data.value.map((item, i) => ({
          name: item.genre,
          value: item.readingSeconds,
          itemStyle: {
            color: palette[i % palette.length],
            borderWidth: 2,
            borderColor: background,
          },
        })),
        label: {
          show: true,
          fontSize: 12,
          fontWeight: 500,
          overflow: 'truncate',
          color: '#fff',
        },
        emphasis: { disabled: true },
        upperLabel: { show: false },
        levels: [
          {
            itemStyle: { borderWidth: 0, gapWidth: 3 },
          },
        ],
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Genre Reading Time" :icon="Tag" :color-index="6" :loading :error :empty="isEmpty">
    <div v-if="!hasEnoughData" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_GENRES }} genres with reading time
    </div>
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
