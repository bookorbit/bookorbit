<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'

type PaginationMessageKeys = {
  label: string
  previousPage: string
  nextPage: string
  goToPage: string
}

const props = defineProps<{
  page: number
  totalPages: number
  messageKeys?: PaginationMessageKeys
}>()

const emit = defineEmits<{
  'update:page': [value: number]
}>()

const { t } = useI18n()
const defaultMessageKeys: PaginationMessageKeys = {
  label: 'common.pagination.label',
  previousPage: 'common.pagination.previousPage',
  nextPage: 'common.pagination.nextPage',
  goToPage: 'common.pagination.goToPage',
}
const messageKeys = computed(() => props.messageKeys ?? defaultMessageKeys)

const pageNumbers = computed(() => {
  const last = props.totalPages
  const pages = new Set([1, 2, props.page - 1, props.page, props.page + 1, last - 1, last])
  const sorted = [...pages].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  return sorted.flatMap((page, index) => {
    const previous = sorted[index - 1]
    if (previous === undefined) return [page]
    if (page - previous === 2) return [previous + 1, page]
    if (page - previous > 2) return [-1, page]
    return [page]
  })
})

function handlePreviousPage(): void {
  if (props.page > 1) emit('update:page', props.page - 1)
}

function handleNextPage(): void {
  if (props.page < props.totalPages) emit('update:page', props.page + 1)
}

function handleGoToPage(page: number): void {
  emit('update:page', page)
}
</script>

<template>
  <nav v-if="totalPages > 1" class="flex min-w-0 items-center justify-center gap-1" :aria-label="t(messageKeys.label)">
    <button
      type="button"
      class="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :disabled="page <= 1"
      :aria-label="t(messageKeys.previousPage)"
      @click="handlePreviousPage"
    >
      <ChevronLeft :size="15" class="rtl:rotate-180" aria-hidden="true" />
    </button>

    <span aria-live="polite" class="min-w-0 px-2 text-center text-xs text-muted-foreground md:sr-only md:p-0">
      {{ t('common.pagination.pageOf', { page: formatNumber(page), totalPages: formatNumber(totalPages) }) }}
    </span>

    <div class="hidden items-center gap-1 md:flex">
      <template v-for="(entry, index) in pageNumbers" :key="`${entry}-${index}`">
        <span v-if="entry === -1" aria-hidden="true" class="px-1 text-xs text-muted-foreground">&hellip;</span>
        <button
          v-else
          type="button"
          class="grid h-8 min-w-8 place-items-center rounded-md border px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="entry === page ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent'"
          :aria-label="t(messageKeys.goToPage, { page: formatNumber(entry) })"
          :aria-current="entry === page ? 'page' : undefined"
          @click="handleGoToPage(entry)"
        >
          {{ formatNumber(entry) }}
        </button>
      </template>
    </div>

    <button
      type="button"
      class="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :disabled="page >= totalPages"
      :aria-label="t(messageKeys.nextPage)"
      @click="handleNextPage"
    >
      <ChevronRight :size="15" class="rtl:rotate-180" aria-hidden="true" />
    </button>
  </nav>
</template>
