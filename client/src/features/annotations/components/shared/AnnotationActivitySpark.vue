<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnotationHubActivityWeek } from '@bookorbit/types'
import { formatDate, formatNumber } from '@/i18n/formatters'

const props = defineProps<{
  weeks: AnnotationHubActivityWeek[]
  busiestWeek: AnnotationHubActivityWeek | null
  longestQuietWeeks: number
  topBookTitle: string | null
}>()

const { t } = useI18n()

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SPAN_WEEKS = 53

/**
 * Weeks with no marks are not rows, so the axis is padded here rather than in SQL: a year
 * with three quiet months should read as three quiet months, not as a shorter year.
 */
const axis = computed(() => {
  if (props.weeks.length === 0) return []
  const last = Date.parse(`${props.weeks[props.weeks.length - 1]!.weekStart}T00:00:00.000Z`)
  if (Number.isNaN(last)) return []
  const byStart = new Map(props.weeks.map((week) => [week.weekStart, week]))
  const slots: { key: string; week: AnnotationHubActivityWeek | null }[] = []
  for (let index = SPAN_WEEKS - 1; index >= 0; index -= 1) {
    const key = new Date(last - index * WEEK_MS).toISOString().slice(0, 10)
    slots.push({ key, week: byStart.get(key) ?? null })
  }
  return slots
})

const max = computed(() => Math.max(1, ...props.weeks.map((week) => week.count)))
const firstLabel = computed(() => {
  const first = axis.value[0]
  return first ? formatDate(new Date(`${first.key}T00:00:00.000Z`), { month: 'short', year: 'numeric' }) : ''
})
const lastLabel = computed(() => {
  const last = axis.value[axis.value.length - 1]
  return last ? formatDate(new Date(`${last.key}T00:00:00.000Z`), { month: 'short', year: 'numeric' }) : ''
})
const total = computed(() => props.weeks.reduce((sum, week) => sum + week.count, 0))
const summary = computed(() => t('annotations.hub.activitySummary', { count: total.value, from: firstLabel.value, to: lastLabel.value }))
const busiestLabel = computed(() =>
  props.busiestWeek ? formatDate(new Date(`${props.busiestWeek.weekStart}T00:00:00.000Z`), { day: 'numeric', month: 'short' }) : '',
)
</script>

<template>
  <div v-if="axis.length > 0">
    <div class="relative h-10 border-b border-border" role="img" :aria-label="summary">
      <span
        v-for="(slot, index) in axis"
        :key="slot.key"
        class="absolute bottom-0 flex flex-col-reverse overflow-hidden rounded-t-sm"
        :style="{
          left: `${(index * 100) / axis.length + 0.3}%`,
          width: `${100 / axis.length - 0.6}%`,
          height: slot.week ? `${Math.max(8, (slot.week.count / max) * 100)}%` : '0%',
        }"
      >
        <span
          v-for="origin in slot.week?.origins ?? []"
          :key="origin.origin"
          class="block w-full"
          :style="{ height: `${(origin.count / (slot.week?.count ?? 1)) * 100}%`, backgroundColor: `var(--pill-${origin.origin})` }"
        />
      </span>
    </div>
    <div class="mt-1.5 flex justify-between text-[10.5px] text-muted-foreground">
      <span>{{ firstLabel }}</span>
      <span>{{ lastLabel }}</span>
    </div>
    <dl class="mt-2 flex flex-col gap-0.5 text-[11.5px] leading-4 text-muted-foreground">
      <div v-if="busiestWeek" class="flex gap-1.5 truncate">
        <dt>{{ t('annotations.hub.busiestWeek') }}</dt>
        <dd class="font-semibold text-foreground">{{ busiestLabel }} &middot; {{ formatNumber(busiestWeek.count) }}</dd>
      </div>
      <div v-if="longestQuietWeeks > 0" class="flex gap-1.5 truncate">
        <dt>{{ t('annotations.hub.longestQuiet') }}</dt>
        <dd class="font-semibold text-foreground">{{ t('annotations.hub.weekCount', { count: longestQuietWeeks }) }}</dd>
      </div>
      <div v-if="topBookTitle" class="flex gap-1.5 truncate">
        <dt class="shrink-0">{{ t('annotations.hub.mostMarked') }}</dt>
        <dd class="truncate font-semibold text-foreground">{{ topBookTitle }}</dd>
      </div>
    </dl>
  </div>
</template>
