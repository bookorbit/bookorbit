<script setup lang="ts">
import { computed } from 'vue'
import type { KoreaderBookStats } from '@bookorbit/types'

const props = defineProps<{
  stats: KoreaderBookStats | null
  total: number
  loading: boolean
}>()

const CARD_CLASS = 'rounded-md border border-border bg-card px-2.5 py-2 sm:px-3 sm:py-2.5'
const CARD_COUNT = 6

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const yr = Math.floor(mo / 12)
  return `${yr} year${yr === 1 ? '' : 's'} ago`
}

const statCards = computed(() => [
  {
    label: 'Reading Time',
    value: props.stats ? formatDuration(props.stats.totalReadSecs) : '0s',
  },
  {
    label: 'Pages Read',
    value: String(props.stats?.totalReadPages ?? 0),
  },
  {
    label: 'Sessions',
    value: String(props.total),
  },
  {
    label: 'Highlights',
    value: String(props.stats?.highlightsCount ?? 0),
  },
  {
    label: 'Notes',
    value: String(props.stats?.notesCount ?? 0),
  },
  {
    label: 'Last Opened',
    value: props.stats ? formatRelative(props.stats.lastOpenAt) : '-',
  },
])
</script>

<template>
  <div
    class="grid grid-cols-2 gap-1.5 transition-opacity sm:gap-2 md:grid-cols-6"
    :class="{ 'opacity-50 pointer-events-none': loading && stats !== null }"
  >
    <template v-if="stats === null && loading">
      <div v-for="i in CARD_COUNT" :key="i" :class="CARD_CLASS">
        <div class="h-3 w-16 rounded bg-muted animate-shimmer mb-2" />
        <div class="h-6 w-12 rounded bg-muted animate-shimmer" />
      </div>
    </template>
    <template v-else>
      <div v-for="card in statCards" :key="card.label" data-testid="stat-card" :class="CARD_CLASS">
        <p class="mb-0.5 text-[10px] text-muted-foreground sm:text-[11px]">{{ card.label }}</p>
        <p class="text-base font-semibold text-foreground sm:text-lg">{{ card.value }}</p>
      </div>
    </template>
  </div>
</template>
