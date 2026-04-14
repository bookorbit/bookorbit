<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3, BookCheck, BookOpen, BookText, Building2, CalendarPlus, CalendarRange, Globe, Layers, Tags, Users } from 'lucide-vue-next'

import { useStatisticsSummary } from '../composables/useStatisticsSummary'
import { useUserStatisticsSummary } from '../composables/useUserStatisticsSummary'

const { data, loading: libraryLoading } = useStatisticsSummary()
const { data: userData, loading: userLoading } = useUserStatisticsSummary()

const ICON_HUE_OFFSETS = [0, 45, 90, 135, 180, 225, 270, 315, 337]

function iconStyle(colorIndex: number) {
  const offset = ICON_HUE_OFFSETS[(colorIndex - 1) % ICON_HUE_OFFSETS.length] ?? 0
  const color = `oklch(from var(--primary) l c calc(h + ${offset}))`
  return { backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`, color }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
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
  { icon: BookOpen, label: 'Books', value: data.value ? formatNumber(data.value.totalBooks) : '-', colorIndex: 1 },
  { icon: Users, label: 'Authors', value: data.value ? formatNumber(data.value.totalAuthors) : '-', colorIndex: 2 },
  { icon: Layers, label: 'Series', value: data.value ? formatNumber(data.value.totalSeries) : '-', colorIndex: 3 },
  { icon: Building2, label: 'Publishers', value: data.value ? formatNumber(data.value.totalPublishers) : '-', colorIndex: 4 },
  { icon: BarChart3, label: 'Storage', value: data.value ? formatBytes(data.value.totalStorageBytes) : '-', colorIndex: 5 },
  { icon: Tags, label: 'Genres', value: data.value ? formatNumber(data.value.totalGenres) : '-', colorIndex: 6 },
  { icon: Globe, label: 'Languages', value: data.value ? formatNumber(data.value.totalLanguages) : '-', colorIndex: 7 },
  { icon: CalendarRange, label: 'Published', value: publicationRange.value, colorIndex: 8 },
  { icon: CalendarPlus, label: 'This Year', value: data.value ? formatNumber(data.value.booksAddedThisYear) : '-', colorIndex: 9 },
  { icon: BookText, label: 'Started', value: userData.value ? formatNumber(userData.value.startedBooks) : '-', colorIndex: 1 },
  { icon: BookOpen, label: 'In Progress', value: userData.value ? formatNumber(userData.value.inProgressBooks) : '-', colorIndex: 2 },
  { icon: BookCheck, label: 'Completed', value: userData.value ? formatNumber(userData.value.completedBooks) : '-', colorIndex: 3 },
  { icon: BarChart3, label: 'Avg Progress', value: avgProgress.value, colorIndex: 4 },
])
</script>

<template>
  <div class="relative overflow-hidden rounded-xl border bg-card">
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 to-transparent" />
    <BarChart3 class="pointer-events-none absolute -right-0 -top-2 opacity-[0.04]" :size="100" aria-hidden="true" />

    <div class="relative p-4">
      <div class="flex gap-3 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          v-for="(kpi, index) in kpis"
          :key="kpi.label"
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
