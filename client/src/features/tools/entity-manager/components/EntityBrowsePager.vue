<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import PaginationNav from '@/components/PaginationNav.vue'
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
const paginationMessageKeys = {
  label: 'tools.entityManager.browse.pagination',
  previousPage: 'tools.entityManager.browse.previousPage',
  nextPage: 'tools.entityManager.browse.nextPage',
  goToPage: 'tools.entityManager.browse.goToPage',
}

const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.page * props.pageSize, props.total))

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

    <PaginationNav class="ms-auto" :page="page" :total-pages="totalPages" :message-keys="paginationMessageKeys" @update:page="handleGoToPage" />
  </div>
</template>
