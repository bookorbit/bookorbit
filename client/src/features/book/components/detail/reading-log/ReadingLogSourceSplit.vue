<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MonitorSmartphone } from '@lucide/vue'
import type { BookReadingSessionStats, ReadingSessionSourceBucket } from '@bookorbit/types'
import { READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'

const props = withDefaults(
  defineProps<{
    stats: BookReadingSessionStats | null
    /** `panel` is the standalone card row; `stacked` is the narrow column form. */
    variant?: 'panel' | 'stacked'
  }>(),
  { variant: 'panel' },
)

const { t } = useI18n()

const BUCKET_TOKEN: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return t('book.detail.readingLog.vitals.durationHm', { hours, minutes })
  if (minutes > 0) return t('book.detail.readingLog.vitals.durationM', { minutes })
  return t('book.detail.readingLog.vitals.durationS', { seconds: total })
}

const totalSeconds = computed(() => (props.stats?.bySource ?? []).reduce((sum, slice) => sum + slice.totalSeconds, 0))

const segments = computed(() => {
  const total = totalSeconds.value
  return (props.stats?.bySource ?? []).map((slice) => ({
    bucket: slice.bucket,
    label: READING_SESSION_SOURCE_BUCKET_LABELS[slice.bucket],
    token: BUCKET_TOKEN[slice.bucket],
    seconds: slice.totalSeconds,
    widthPercent: total > 0 ? (slice.totalSeconds / total) * 100 : 0,
    percent: total > 0 ? Math.round((slice.totalSeconds / total) * 100) : 0,
  }))
})

// Only meaningful once a book has been read across more than one source.
const shouldShow = computed(() => segments.value.length >= 2 && totalSeconds.value > 0)
</script>

<template>
  <div v-if="shouldShow && variant === 'stacked'">
    <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        v-for="segment in segments"
        :key="segment.bucket"
        class="h-full"
        :style="{ width: `${segment.widthPercent}%`, backgroundColor: `var(${segment.token})` }"
        :title="`${segment.label}: ${segment.percent}%`"
      />
    </div>
    <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      <li v-for="segment in segments" :key="segment.bucket" class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: `var(${segment.token})` }" />
        <span class="font-medium text-foreground">{{ segment.label }}</span>
        <span class="tabular-nums">{{ segment.percent }}%</span>
      </li>
    </ul>
  </div>

  <section v-else-if="shouldShow" class="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-xs)]">
    <div class="flex flex-col gap-3 md:flex-row md:items-center">
      <p class="flex shrink-0 items-center gap-1.5 text-sm font-medium text-foreground">
        <MonitorSmartphone class="size-4 text-muted-foreground" />
        {{ t('book.detail.readingLog.sourceSplit.title') }}
      </p>
      <div class="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          v-for="segment in segments"
          :key="segment.bucket"
          class="h-full"
          :style="{ width: `${segment.widthPercent}%`, backgroundColor: `var(${segment.token})` }"
          :title="`${segment.label}: ${segment.percent}%`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1.5 md:justify-end">
        <div v-for="segment in segments" :key="segment.bucket" class="flex items-center gap-1.5 text-xs">
          <span class="size-2.5 rounded-full" :style="{ backgroundColor: `var(${segment.token})` }" />
          <span class="font-medium text-foreground">{{ segment.label }}</span>
          <span class="text-muted-foreground">{{ segment.percent }}% · {{ formatDuration(segment.seconds) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
