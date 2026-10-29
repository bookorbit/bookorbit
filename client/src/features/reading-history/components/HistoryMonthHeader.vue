<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReadingHistoryMonth } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { formatHours, formatMonthKey } from '../lib/history-format'

const props = defineProps<{ month: ReadingHistoryMonth }>()

const { t } = useI18n()

const label = computed(() => formatMonthKey(props.month.month, t))
const facts = computed(() => {
  const parts = [t('readingHistory.month.reads', { count: props.month.reads })]
  if (props.month.rereads) parts.push(t('readingHistory.month.rereads', { count: props.month.rereads }))
  const hours = formatHours(props.month.seconds)
  if (hours > 0) parts.push(t('readingHistory.month.hours', { hours }))
  return parts
})
const factsLabel = computed(() => formatList(facts.value))
</script>

<template>
  <div class="flex items-baseline gap-2.5 bg-gradient-to-b from-card from-[74%] to-transparent pt-2.5 pb-1">
    <h3 class="text-[10px] font-bold tracking-[0.13em] whitespace-nowrap text-foreground uppercase">{{ label }}</h3>
    <span class="h-px flex-1 self-center bg-border" aria-hidden="true" />
    <span class="shrink-0 text-[10.5px] font-semibold whitespace-nowrap text-muted-foreground tabular-nums" :aria-label="factsLabel">
      <template v-for="(fact, index) in facts" :key="fact"><template v-if="index > 0"> · </template>{{ fact }}</template>
    </span>
  </div>
</template>
