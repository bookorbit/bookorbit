<script setup lang="ts">
import { List } from 'lucide-vue-next'
import PdfOutlineTree from './OutlineTree.vue'
import type { OutlineItem } from '../composables/usePdfOutline'

defineProps<{
  totalPages: number
  currentPage: number
  outline: OutlineItem[]
  outlineLoading: boolean
}>()

const emit = defineEmits<{
  goToPage: [page: number]
}>()
</script>

<template>
  <div class="flex flex-col shrink-0 overflow-hidden border-r border-border bg-card px-1.5 w-64">
    <!-- Header -->
    <div class="flex items-center gap-1.5 px-3 py-2.5 shrink-0 text-xs text-muted-foreground border-b border-border">
      <List :size="12" />
      Outline
    </div>

    <!-- Outline -->
    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="outlineLoading" class="flex items-center justify-center h-16">
        <div class="w-4 h-4 rounded-full border border-muted-foreground/30 border-t-muted-foreground animate-spin" />
      </div>
      <div v-else-if="!outline.length" class="px-4 py-6 text-xs text-muted-foreground text-center leading-relaxed">
        No outline available for this document.
      </div>
      <PdfOutlineTree v-else :items="outline" :depth="0" @go-to-page="emit('goToPage', $event)" />
    </div>
  </div>
</template>
