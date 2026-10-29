<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useScrollOverflow } from '@/composables/useScrollOverflow'
import { formatNumber } from '@/i18n/formatters'

const props = defineProps<{
  years: { year: number; reads: number }[]
  year: number | null
  quarter: number | null
  currentYear: number
}>()

const emit = defineEmits<{ year: [year: number | null]; quarter: [quarter: number] }>()

const { t } = useI18n()
const yearScroller = ref<HTMLElement | null>(null)
const { hasStartOverflow, hasEndOverflow, measure: measureYearOverflow } = useScrollOverflow(yearScroller)

/** Every year with a finish, plus this year and whichever year is open, newest first. */
const yearOptions = computed(() => {
  const counts = new Map(props.years.map((entry) => [entry.year, entry.reads]))
  for (const year of [props.currentYear, props.year]) if (year !== null && !counts.has(year)) counts.set(year, 0)
  return [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([year, reads]) => ({ year, reads }))
})

const SEGMENT = 'flex items-center gap-1 rounded-lg bg-muted p-1'
const BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:flex-1 max-sm:justify-center max-sm:px-2'
const SCROLL_BUTTON =
  'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function buttonClass(active: boolean) {
  return [BUTTON, active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']
}

function handleYear(year: number | null) {
  emit('year', year)
}

function handleAllTime() {
  emit('year', null)
}

function scrollYears(direction: -1 | 1) {
  const element = yearScroller.value
  if (!element) return
  const inlineDirection = getComputedStyle(element).direction === 'rtl' ? -direction : direction
  element.scrollBy({ left: inlineDirection * Math.max(160, element.clientWidth * 0.75), behavior: 'auto' })
}

function handleNewerYears() {
  scrollYears(-1)
}

function handleOlderYears() {
  scrollYears(1)
}

function handleQuarter(quarter: number) {
  emit('quarter', quarter)
}

async function revealSelectedYear() {
  await nextTick()
  const element = yearScroller.value
  const selected = element?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (element && selected && element.scrollWidth > element.clientWidth) {
    const containerRect = element.getBoundingClientRect()
    const selectedRect = selected.getBoundingClientRect()
    if (selectedRect.left < containerRect.left || selectedRect.right > containerRect.right) {
      element.scrollLeft += selectedRect.left - containerRect.left
    }
  }
  measureYearOverflow()
}

watch([() => props.year, yearOptions], revealSelectedYear, { immediate: true })
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
    <div :class="[SEGMENT, 'min-w-0 max-w-full overflow-hidden']" role="group" :aria-label="t('readingHistory.period.year')">
      <button
        v-if="hasStartOverflow"
        type="button"
        :class="SCROLL_BUTTON"
        :aria-label="t('readingHistory.period.newerYears')"
        @click="handleNewerYears"
      >
        <ChevronLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
      </button>
      <div ref="yearScroller" class="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto" data-year-scroller>
        <button
          v-for="option in yearOptions"
          :key="option.year"
          type="button"
          :class="buttonClass(year === option.year)"
          :aria-pressed="year === option.year"
          @click="handleYear(option.year)"
        >
          {{ option.year }}
          <span class="text-[11px] font-semibold tabular-nums" :class="year === option.year ? 'text-primary' : 'text-muted-foreground'">{{
            formatNumber(option.reads)
          }}</span>
        </button>
      </div>
      <button
        v-if="hasEndOverflow"
        type="button"
        :class="SCROLL_BUTTON"
        :aria-label="t('readingHistory.period.olderYears')"
        @click="handleOlderYears"
      >
        <ChevronRight class="size-4 rtl:rotate-180" aria-hidden="true" />
      </button>
      <button type="button" :class="buttonClass(year === null)" :aria-pressed="year === null" @click="handleAllTime">
        {{ t('readingHistory.period.allTime') }}
      </button>
    </div>
    <div v-if="year !== null" :class="SEGMENT" role="group" :aria-label="t('readingHistory.period.quarterGroup')">
      <button
        v-for="value in [1, 2, 3, 4]"
        :key="value"
        type="button"
        :class="buttonClass(quarter === value)"
        :aria-pressed="quarter === value"
        @click="handleQuarter(value)"
      >
        {{ t('readingHistory.period.quarter', { quarter: value }) }}
      </button>
    </div>
  </div>
</template>
