<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MonitorSmartphone } from '@lucide/vue'
import type { BookReadingSessionStats, ReadingSessionSourceBucket } from '@bookorbit/types'
import { READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'

const props = withDefaults(
  defineProps<{
    stats: BookReadingSessionStats | null
    embedded?: boolean
    compact?: boolean
  }>(),
  { embedded: false, compact: false },
)

const { t } = useI18n()

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
  <section
    v-if="shouldShow"
    :class="
      compact
        ? 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs'
        : embedded
          ? 'mt-4 border-t border-border/70 pt-4'
          : 'rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-xs)]'
    "
  >
    <template v-if="compact">
      <span class="flex items-center gap-1.5 font-medium text-muted-foreground">
        <MonitorSmartphone class="size-3.5" />
        {{ t('book.detail.readingLog.sourceSplit.shortTitle') }}
      </span>
      <div class="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:w-28">
        <div
          v-for="seg in segments"
          :key="seg.bucket"
          class="h-full"
          :style="{ width: `${seg.widthPercent}%`, backgroundColor: `var(${seg.token})` }"
          :title="`${seg.label}: ${seg.percent}%`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1.5">
        <span v-for="seg in segments" :key="seg.bucket" class="flex items-center gap-1 text-muted-foreground">
          <span class="size-1.5 rounded-full" :style="{ backgroundColor: `var(${seg.token})` }" />
          <span class="font-medium text-foreground">{{ seg.label }}</span>
          {{ seg.percent }}%
        </span>
      </div>
    </template>

    <div v-else class="flex flex-col gap-3 md:flex-row md:items-center">
      <p class="flex shrink-0 items-center gap-1.5 text-sm font-medium text-foreground">
        <MonitorSmartphone class="size-4 text-muted-foreground" />
        {{ t('book.detail.readingLog.sourceSplit.title') }}
      </p>
      <div class="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          v-for="seg in segments"
          :key="seg.bucket"
          class="h-full"
          :style="{ width: `${seg.widthPercent}%`, backgroundColor: `var(${seg.token})` }"
          :title="`${seg.label}: ${seg.percent}%`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1.5 md:justify-end">
        <div v-for="seg in segments" :key="seg.bucket" class="flex items-center gap-1.5 text-xs">
          <span class="size-2.5 rounded-full" :style="{ backgroundColor: `var(${seg.token})` }" />
          <span class="font-medium text-foreground">{{ seg.label }}</span>
          <span class="text-muted-foreground">{{ seg.percent }}% · {{ formatDuration(seg.seconds) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
