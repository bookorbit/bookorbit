<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { HeartPulse } from '@lucide/vue'

import { useReadingRhythmWidget } from '../../composables/useReadingRhythmWidget'

const { data, loading, error } = useReadingRhythmWidget()
const { t } = useI18n()

const maxSeconds = computed(() => {
  if (!data.value) return 1
  return Math.max(1, ...data.value.days.map((d) => d.readingSeconds))
})

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()]!
}

const consistencyLabel = computed(() => {
  if (!data.value) return ''
  const activeDays = t('dashboard.widgets.readingRhythm.activeDays', { count: data.value.activeDays }, data.value.activeDays)
  return t('dashboard.widgets.readingRhythm.consistency', {
    activeDays,
    percent: data.value.consistencyPercent,
  })
})
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-2 flex items-center gap-2 self-start">
      <HeartPulse :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.readingRhythm.title') }}</span>
    </div>

    <div v-if="loading" class="flex flex-1 flex-col gap-2">
      <div class="flex-1 animate-pulse rounded bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <div v-else-if="!data || data.activeDays === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <HeartPulse :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.readingRhythm.empty') }}</p>
    </div>

    <div v-else class="flex flex-1 flex-col">
      <div class="flex flex-1 gap-[3px]">
        <div v-for="day in data.days" :key="day.date" class="flex flex-1 flex-col-reverse">
          <div
            class="w-full rounded-t-sm transition-all duration-300"
            :class="day.readingSeconds > 0 ? 'bg-primary/70' : 'bg-muted/50'"
            :style="{ height: `${Math.max(3, (day.readingSeconds / maxSeconds) * 100)}%`, minHeight: '3px' }"
          />
        </div>
      </div>

      <div class="flex gap-[3px] pb-1 pt-0.5">
        <div v-for="day in data.days" :key="day.date + '-lbl'" class="flex flex-1 justify-center">
          <span class="text-[8.5px] text-muted-foreground/70">{{ getDayLabel(day.date) }}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border/30 pt-1.5">
        <span class="text-[11px] text-muted-foreground"> {{ consistencyLabel }} </span>
        <span class="text-[11px] text-muted-foreground">
          {{ t('dashboard.widgets.readingRhythm.avgPerDay', { time: formatTime(data.avgSecondsPerDay) }) }}
        </span>
      </div>
    </div>
  </div>
</template>
