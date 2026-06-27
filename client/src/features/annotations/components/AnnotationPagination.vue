<script setup lang="ts">
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue'
import { Button } from '@/components/ui/button'

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
    <span>Showing {{ rangeStart }}-{{ rangeEnd }} of {{ total }}{{ unit ? ` ${unit}` : '' }}</span>
    <div v-if="totalPages > 1" class="flex items-center gap-1.5">
      <Button variant="outline" size="icon-sm" :disabled="page <= 1" aria-label="First page" @click="firstPage">
        <ChevronsLeft :size="14" />
      </Button>
      <Button variant="outline" size="icon-sm" :disabled="page <= 1" aria-label="Previous page" @click="previousPage">
        <ChevronLeft :size="14" />
      </Button>
      <span class="px-1">Page {{ page }} of {{ totalPages }}</span>
      <Button variant="outline" size="icon-sm" :disabled="page >= totalPages" aria-label="Next page" @click="nextPage">
        <ChevronRight :size="14" />
      </Button>
      <Button variant="outline" size="icon-sm" :disabled="page >= totalPages" aria-label="Last page" @click="lastPage">
        <ChevronsRight :size="14" />
      </Button>
    </div>
  </div>
</template>
