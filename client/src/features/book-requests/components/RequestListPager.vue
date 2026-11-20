<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'

/**
 * The range and the pager together at the foot of the list: which rows these are out of how many,
 * and every way to another page within a hand's width of each other.
 */
const props = defineProps<{
  page: number
  pageSize: number
  total: number
  /** Rows actually on this page, which a local drop can leave short of the page size. */
  shown: number
}>()

const emit = defineEmits<{ go: [page: number] }>()

const { t } = useI18n()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.total, (props.page - 1) * props.pageSize + Math.max(props.shown, 0)))

/** At most seven slots: both ends, the current page with a neighbour each side, and gaps. */
const slots = computed<Array<number | 'gap-start' | 'gap-end'>>(() => {
  const count = pageCount.value
  const current = props.page
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const start = Math.max(2, Math.min(current - 1, count - 4))
  const end = Math.min(count - 1, Math.max(current + 1, 5))
  const middle = Array.from({ length: end - start + 1 }, (_, index) => start + index)
  return [1, ...(start > 2 ? (['gap-start'] as const) : []), ...middle, ...(end < count - 1 ? (['gap-end'] as const) : []), count]
})

function goPrevious() {
  emit('go', props.page - 1)
}

function goNext() {
  emit('go', props.page + 1)
}

function goTo(page: number) {
  if (page !== props.page) emit('go', page)
}

const PAGE_BUTTON =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none'
</script>

<template>
  <div class="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3 py-2">
    <p class="text-[13px] text-muted-foreground tabular-nums">
      {{ t('bookRequests.list.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) }) }}
    </p>
    <nav v-if="pageCount > 1" class="flex items-center gap-0.5" :aria-label="t('bookRequests.list.pagination')">
      <button
        type="button"
        :class="[PAGE_BUTTON, 'text-foreground hover:bg-accent']"
        :disabled="page <= 1"
        :aria-label="t('common.pagination.previousPage')"
        @click="goPrevious"
      >
        <ChevronLeft :size="16" class="rtl:rotate-180" aria-hidden="true" />
      </button>
      <template v-for="slot in slots" :key="slot">
        <span
          v-if="typeof slot !== 'number'"
          class="inline-flex h-8 min-w-6 items-center justify-center text-[13px] text-muted-foreground max-sm:hidden"
          aria-hidden="true"
          >…</span
        >
        <button
          v-else
          type="button"
          :class="[PAGE_BUTTON, slot === page ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-accent', 'max-sm:hidden']"
          :aria-current="slot === page ? 'page' : undefined"
          :aria-label="t('common.pagination.goToPage', { page: slot })"
          @click="goTo(slot)"
        >
          {{ formatNumber(slot) }}
        </button>
      </template>
      <span class="px-2 text-[13px] text-muted-foreground tabular-nums sm:hidden">
        {{ t('common.pagination.pageOf', { page: formatNumber(page), totalPages: formatNumber(pageCount) }) }}
      </span>
      <button
        type="button"
        :class="[PAGE_BUTTON, 'text-foreground hover:bg-accent']"
        :disabled="page >= pageCount"
        :aria-label="t('common.pagination.nextPage')"
        @click="goNext"
      >
        <ChevronRight :size="16" class="rtl:rotate-180" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>
