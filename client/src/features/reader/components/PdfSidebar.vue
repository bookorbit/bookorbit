<script setup lang="ts">
import { List } from 'lucide-vue-next'
import PdfOutlineTree from './PdfOutlineTree.vue'
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
  <div
    class="flex flex-col shrink-0 overflow-hidden"
    style="width: 200px; background: rgba(40, 44, 48, 1); border-right: 1px solid rgba(0,0,0,0.4)"
  >
    <!-- Header -->
    <div
      class="flex items-center gap-1.5 px-3 py-2.5 shrink-0 text-xs text-white/50"
      style="border-bottom: 1px solid rgba(0,0,0,0.4)"
    >
      <List :size="12" />
      Outline
    </div>

    <!-- Outline -->
    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="outlineLoading" class="flex items-center justify-center h-16">
        <div class="w-4 h-4 rounded-full border border-white/20 border-t-white/50 animate-spin" />
      </div>
      <div v-else-if="!outline.length" class="px-4 py-6 text-xs text-white/30 text-center leading-relaxed">
        No outline available for this document.
      </div>
      <PdfOutlineTree v-else :items="outline" :depth="0" @go-to-page="emit('goToPage', $event)" />
    </div>
  </div>
</template>

