<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight } from '@lucide/vue'
import type { AnnotationHubItem, AnnotationItem } from '@bookorbit/types'
import AnnotationListItem from '@/features/annotations/components/AnnotationListItem.vue'

defineProps<{
  chapterTitle: string
  highlights: AnnotationItem[]
  selectedIds: Set<number>
  density: 'compact' | 'comfortable'
  savingIds: Set<number>
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  jump: [annotation: AnnotationItem]
  updateNote: [id: number, note: string | null]
  updateColor: [id: number, color: string]
  updateStyle: [id: number, style: string]
  trash: [id: number]
}>()

const expanded = ref(true)

function toggleExpanded() {
  expanded.value = !expanded.value
}

function handleToggleSelect(id: number) {
  emit('toggleSelect', id)
}

function handleJump(annotation: AnnotationItem | AnnotationHubItem) {
  emit('jump', annotation as AnnotationItem)
}

function handleUpdateNote(id: number, note: string | null) {
  emit('updateNote', id, note)
}

function handleUpdateColor(id: number, color: string) {
  emit('updateColor', id, color)
}

function handleUpdateStyle(id: number, style: string) {
  emit('updateStyle', id, style)
}

function handleTrash(id: number) {
  emit('trash', id)
}
</script>

<template>
  <div>
    <button
      class="sticky top-0 z-10 flex w-full items-center gap-2 rounded-md bg-background/95 px-1 py-2 text-left transition-colors hover:bg-muted/50"
      @click="toggleExpanded"
    >
      <ChevronDown v-if="expanded" :size="16" class="text-muted-foreground shrink-0" />
      <ChevronRight v-else :size="16" class="text-muted-foreground shrink-0" />
      <span class="truncate text-sm font-medium text-foreground">{{ chapterTitle }}</span>
      <span class="text-xs text-muted-foreground shrink-0">({{ highlights.length }})</span>
    </button>

    <div v-if="expanded" class="mt-1 space-y-2 md:ml-6">
      <AnnotationListItem
        v-for="h in highlights"
        :key="h.id"
        :annotation="h"
        :selected="selectedIds.has(h.id)"
        :density="density"
        :saving="savingIds.has(h.id)"
        mode="book"
        @toggle-select="handleToggleSelect"
        @jump="handleJump"
        @update-note="handleUpdateNote"
        @update-color="handleUpdateColor"
        @update-style="handleUpdateStyle"
        @trash="handleTrash"
      />
    </div>
  </div>
</template>
