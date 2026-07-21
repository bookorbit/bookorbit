<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber as formatLocaleNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { BarChart3, BookCheck, BookOpen, BookText, Building2, CalendarPlus, CalendarRange, Globe, Layers, Tags, Users } from '@lucide/vue'

import { useStatisticsSummary } from '../composables/useStatisticsSummary'
import { useUserStatisticsSummary } from '../composables/useUserStatisticsSummary'

const { t } = useI18n()

const { data, loading: libraryLoading } = useStatisticsSummary()
const { data: userData, loading: userLoading } = useUserStatisticsSummary()

const ICON_HUE_OFFSETS = [0, 45, 90, 135, 180, 225, 270, 315, 337]

function iconStyle(colorIndex: number) {
  const offset = ICON_HUE_OFFSETS[(colorIndex - 1) % ICON_HUE_OFFSETS.length] ?? 0
  const color = `oklch(from var(--primary) l c calc(h + ${offset}))`
  return { backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`, color }
}

function formatNumber(n: number): string {
  return formatLocaleNumber(n)
}

const publicationRange = computed(() => {
  if (!data.value) return '-'
  const { publicationYearMin: min, publicationYearMax: max } = data.value
  if (!min && !max) return '-'
  if (min === max) return String(min)
  return `${min} - ${max}`
})

const avgProgress = computed(() => {
  if (!userData.value) return '-'
  return `${userData.value.meanProgressPercent.toFixed(1)}%`
})

const loading = computed(() => libraryLoading.value || userLoading.value)

const kpis = computed(() => [
  {
    icon: BookOpen,
    key: 'books',
    label: t('statistics.summary.books'),
    value: data.value ? formatNumber(data.value.totalBooks) : '-',
    colorIndex: 1,
  },
  {
    icon: Users,
    key: 'authors',
    label: t('statistics.summary.authors'),
    value: data.value ? formatNumber(data.value.totalAuthors) : '-',
    colorIndex: 2,
  },
  {
    icon: Layers,
    key: 'series',
    label: t('statistics.summary.series'),
    value: data.value ? formatNumber(data.value.totalSeries) : '-',
    colorIndex: 3,
  },
  {
    icon: Building2,
    key: 'publishers',
    label: t('statistics.summary.publishers'),
    value: data.value ? formatNumber(data.value.totalPublishers) : '-',
    colorIndex: 4,
  },
  {
    icon: BarChart3,
    key: 'storage',
    label: t('statistics.summary.storage'),
    value: data.value ? formatBytes(data.value.totalStorageBytes) : '-',
    colorIndex: 5,
  },
  { icon: Tags, key: 'genres', label: t('statistics.summary.genres'), value: data.value ? formatNumber(data.value.totalGenres) : '-', colorIndex: 6 },
  {
    icon: Globe,
    key: 'languages',
    label: t('statistics.summary.languages'),
    value: data.value ? formatNumber(data.value.totalLanguages) : '-',
    colorIndex: 7,
  },
  { icon: CalendarRange, key: 'published', label: t('statistics.summary.published'), value: publicationRange.value, colorIndex: 8 },
  {
    icon: CalendarPlus,
    key: 'thisYear',
    label: t('statistics.summary.thisYear'),
    value: data.value ? formatNumber(data.value.booksAddedThisYear) : '-',
    colorIndex: 9,
  },
  {
    icon: BookText,
    key: 'started',
    label: t('statistics.summary.started'),
    value: userData.value ? formatNumber(userData.value.startedBooks) : '-',
    colorIndex: 1,
  },
  {
    icon: BookOpen,
    key: 'inProgress',
    label: t('statistics.summary.inProgress'),
    value: userData.value ? formatNumber(userData.value.inProgressBooks) : '-',
    colorIndex: 2,
  },
  {
    icon: BookCheck,
    key: 'completed',
    label: t('statistics.summary.completed'),
    value: userData.value ? formatNumber(userData.value.completedBooks) : '-',
    colorIndex: 3,
  },
  { icon: BarChart3, key: 'avgProgress', label: t('statistics.summary.avgProgress'), value: avgProgress.value, colorIndex: 4 },
])
</script>

<template>
  <div class="relative overflow-hidden rounded-lg border bg-card">
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 to-transparent" />
    <BarChart3 class="pointer-events-none absolute -right-0 -top-2 opacity-[0.04]" :size="100" aria-hidden="true" />

    <div class="relative p-4">
      <div class="flex gap-3 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          v-for="(kpi, index) in kpis"
          :key="kpi.key"
          :class="[
            'border-border/60 bg-background/50 flex shrink-0 items-center gap-3 rounded-lg border px-4 py-2.5 animate-fade-up',
            loading ? 'opacity-60' : '',
          ]"
          :style="{ animationDelay: `${index * 50}ms` }"
        >
          <div class="shrink-0 rounded-md p-1.5" :style="iconStyle(kpi.colorIndex)">
            <component :is="kpi.icon" class="size-4" />
          </div>
          <div>
            <p class="text-foreground text-base font-semibold leading-tight tabular-nums">{{ kpi.value }}</p>
            <p class="text-muted-foreground text-xs">{{ kpi.label }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
