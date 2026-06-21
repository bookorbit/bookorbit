<script setup lang="ts">
import { computed } from 'vue'
import { MonitorSmartphone } from '@lucide/vue'
import type { BookReadingSessionStats, ReadingSessionSourceBucket } from '@bookorbit/types'
import { READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'

const props = defineProps<{
  stats: BookReadingSessionStats | null
}>()

const BUCKET_TOKEN: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${total}s`
}

const totalSeconds = computed(() => (props.stats?.bySource ?? []).reduce((sum, slice) => sum + slice.totalSeconds, 0))

const segments = computed(() => {
  const total = totalSeconds.value
  return (props.stats?.bySource ?? []).map((slice) => ({
    bucket: slice.bucket,
    label: READING_SESSION_SOURCE_BUCKET_LABELS[slice.bucket],
    token: BUCKET_TOKEN[slice.bucket],
    seconds: slice.totalSeconds,
    sessions: slice.totalSessions,
    widthPercent: total > 0 ? (slice.totalSeconds / total) * 100 : 0,
    percent: total > 0 ? Math.round((slice.totalSeconds / total) * 100) : 0,
  }))
})

// Only meaningful once a book has been read across more than one source.
const shouldShow = computed(() => segments.value.length >= 2 && totalSeconds.value > 0)
</script>

<template>
  <div v-if="shouldShow" class="rounded-lg border border-border bg-card p-4">
    <p class="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <MonitorSmartphone class="size-3.5" />
      Where you read this book
    </p>
    <div class="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      <div
        v-for="seg in segments"
        :key="seg.bucket"
        class="h-full"
        :style="{ width: `${seg.widthPercent}%`, backgroundColor: `var(${seg.token})` }"
        :title="`${seg.label}: ${seg.percent}%`"
      />
    </div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      <div v-for="seg in segments" :key="seg.bucket" class="flex items-center gap-1.5 text-xs">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: `var(${seg.token})` }" />
        <span class="font-medium text-foreground">{{ seg.label }}</span>
        <span class="text-muted-foreground">{{ seg.percent }}% · {{ formatDuration(seg.seconds) }}</span>
      </div>
    </div>
  </div>
</template>
