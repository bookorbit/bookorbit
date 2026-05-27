<script setup lang="ts">
import { computed } from 'vue'
import { Clock, BookOpen, Flame, Highlighter } from 'lucide-vue-next'
import { Skeleton } from '@/components/ui/skeleton'
import { useKoreaderStatsSummary } from '../../composables/useKoreaderStatsSummary'
import ChartEmptyState from '../ChartEmptyState.vue'

function formatReadingTime(seconds: number): string {
  if (seconds === 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const { data, loading } = useKoreaderStatsSummary()
const hasAnyData = computed(
  () =>
    data.value.totalSessions > 0 ||
    data.value.totalReadSecs > 0 ||
    data.value.totalHighlights > 0 ||
    data.value.totalNotes > 0 ||
    data.value.booksWithStats > 0 ||
    data.value.currentStreak > 0 ||
    data.value.longestStreak > 0,
)

const kpis = computed(() => [
  { label: 'Total Reading Time', value: formatReadingTime(data.value.totalReadSecs), icon: Clock, colorIndex: 1 },
  { label: 'Sessions', value: data.value.totalSessions.toLocaleString(), icon: BookOpen, colorIndex: 2 },
  { label: 'Current Streak', value: `${data.value.currentStreak}d`, icon: Flame, colorIndex: 3 },
  { label: 'Highlights', value: data.value.totalHighlights.toLocaleString(), icon: Highlighter, colorIndex: 4 },
])

const ICON_HUE_OFFSETS = [0, 45, 90, 135, 180, 225, 270, 315, 337]

function iconStyle(colorIndex: number) {
  const offset = ICON_HUE_OFFSETS[(colorIndex - 1) % ICON_HUE_OFFSETS.length] ?? 0
  const color = `oklch(from var(--primary) l c calc(h + ${offset}))`
  return { backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`, color }
}
</script>

<template>
  <div v-if="!loading && !hasAnyData" class="bg-card rounded-lg border p-4 sm:p-6">
    <ChartEmptyState :icon="BookOpen" title="No KOReader data yet" description="Sync reading progress from KOReader to populate these statistics." />
  </div>
  <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div v-for="kpi in kpis" :key="kpi.label" class="bg-card text-card-foreground flex items-center gap-3 rounded-lg border p-4 shadow-sm">
      <div class="shrink-0 rounded-md p-2" :style="iconStyle(kpi.colorIndex)">
        <component :is="kpi.icon" class="size-5" />
      </div>
      <div class="min-w-0">
        <p class="text-muted-foreground text-xs">{{ kpi.label }}</p>
        <Skeleton v-if="loading" class="mt-1 h-5 w-16" />
        <p v-else class="text-foreground text-lg font-bold leading-tight">{{ kpi.value }}</p>
      </div>
    </div>
  </div>
</template>
