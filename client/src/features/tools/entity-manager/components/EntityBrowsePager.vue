<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'

import { ENTITY_PAGE_SIZES } from '../types'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
  totalPages: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const { t } = useI18n()

const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.page * props.pageSize, props.total))

/** Page numbers around the current page, with -1 marking a collapsed gap. */
const pageNumbers = computed<number[]>(() => {
  const last = props.totalPages
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)

  const around = [props.page - 1, props.page, props.page + 1].filter((p) => p > 1 && p < last)
  const pages = [1, ...around, last]

  return pages.flatMap((page, index) => {
    const previous = pages[index - 1]
    return previous !== undefined && page - previous > 1 ? [-1, page] : [page]
  })
})

function handlePrevPage(): void {
  emit('update:page', props.page - 1)
}

function handleNextPage(): void {
  emit('update:page', props.page + 1)
}

function handleGoToPage(page: number): void {
  emit('update:page', page)
}

function handlePageSize(size: number): void {
  emit('update:pageSize', size)
}
</script>

<template>
  <div class="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 pt-3">
    <div class="flex items-center gap-2">
      <span id="entity-rows-per-page" class="text-xs text-muted-foreground">{{ t('tools.entityManager.browse.rowsPerPage') }}</span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-labelledby="entity-rows-per-page"
          >
            {{ formatNumber(pageSize) }}
            <ChevronDown :size="13" class="text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-20">
          <DropdownMenuItem v-for="size in ENTITY_PAGE_SIZES" :key="size" @click="handlePageSize(size)">
            {{ formatNumber(size) }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <p class="text-xs text-muted-foreground tabular-nums">
      {{ t('tools.entityManager.browse.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) }) }}
    </p>

    <nav v-if="totalPages > 1" class="ms-auto flex items-center gap-1" :aria-label="t('tools.entityManager.browse.pagination')">
      <button
        type="button"
        class="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="page <= 1"
        :aria-label="t('tools.entityManager.browse.previousPage')"
        @click="handlePrevPage"
      >
        <ChevronLeft :size="15" aria-hidden="true" />
      </button>

      <template v-for="(entry, index) in pageNumbers" :key="`${entry}-${index}`">
        <span v-if="entry === -1" class="px-1 text-xs text-muted-foreground" :aria-label="t('tools.entityManager.browse.morePages')">&hellip;</span>
        <button
          v-else
          type="button"
          class="grid h-8 min-w-8 place-items-center rounded-md border px-2 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="
            entry === page
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
          "
          :aria-label="t('tools.entityManager.browse.goToPage', { page: formatNumber(entry) })"
          :aria-current="entry === page ? 'page' : undefined"
          @click="handleGoToPage(entry)"
        >
          {{ formatNumber(entry) }}
        </button>
      </template>

      <button
        type="button"
        class="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :disabled="page >= totalPages"
        :aria-label="t('tools.entityManager.browse.nextPage')"
        @click="handleNextPage"
      >
        <ChevronRight :size="15" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>
