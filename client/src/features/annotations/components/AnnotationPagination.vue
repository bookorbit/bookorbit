<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const { t } = useI18n()

const props = defineProps<{
  page: number
  totalPages: number
  rangeStart: number
  rangeEnd: number
  total: number
  unit?: string
}>()

const emit = defineEmits<{ 'update:page': [page: number] }>()

function goTo(page: number) {
  const clamped = Math.min(Math.max(page, 1), props.totalPages)
  if (clamped !== props.page) emit('update:page', clamped)
}

function firstPage() {
  goTo(1)
}

function previousPage() {
  goTo(props.page - 1)
}

function nextPage() {
  goTo(props.page + 1)
}

function lastPage() {
  goTo(props.totalPages)
}
</script>

<template>
  <div class="mt-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
    <span>{{ t('annotations.pagination.showing', { start: rangeStart, end: rangeEnd, total }) }}{{ unit ? ` ${unit}` : '' }}</span>
    <div v-if="totalPages > 1" class="flex items-center gap-1.5">
      <Button variant="outline" size="icon-sm" :disabled="page <= 1" :aria-label="t('annotations.pagination.firstPage')" @click="firstPage">
        <ChevronsLeft :size="14" />
      </Button>
      <Button variant="outline" size="icon-sm" :disabled="page <= 1" :aria-label="t('annotations.pagination.previousPage')" @click="previousPage">
        <ChevronLeft :size="14" />
      </Button>
      <span class="px-1">{{ t('annotations.pagination.pageOf', { page, totalPages }) }}</span>
      <Button variant="outline" size="icon-sm" :disabled="page >= totalPages" :aria-label="t('annotations.pagination.nextPage')" @click="nextPage">
        <ChevronRight :size="14" />
      </Button>
      <Button variant="outline" size="icon-sm" :disabled="page >= totalPages" :aria-label="t('annotations.pagination.lastPage')" @click="lastPage">
        <ChevronsRight :size="14" />
      </Button>
    </div>
  </div>
</template>
