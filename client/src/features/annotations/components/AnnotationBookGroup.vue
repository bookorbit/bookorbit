<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import type { AnnotationHubItem } from '@bookorbit/types'
import AnnotationBookThumb from './AnnotationBookThumb.vue'
import AnnotationCard from './AnnotationCard.vue'

const props = defineProps<{
  bookId: number
  bookTitle: string
  author: string | null
  items: AnnotationHubItem[]
  selectedIds: Set<number>
  savingIds: Set<number>
  trashed: boolean
  density: 'compact' | 'comfortable'
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  jump: [annotation: AnnotationHubItem]
  trash: [id: number]
  restore: [id: number]
  purge: [id: number]
  updateNote: [id: number, note: string | null]
  updateColor: [id: number, color: string]
  updateStyle: [id: number, style: string]
}>()

const expanded = ref(true)

const bookLink = { name: 'book-detail', params: { bookId: props.bookId }, query: { tab: 'highlights' } }

function toggleExpanded() {
  expanded.value = !expanded.value
}

function handleToggleSelect(id: number) {
  emit('toggleSelect', id)
}

function handleJump(annotation: AnnotationHubItem) {
  emit('jump', annotation)
}

function handleTrash(id: number) {
  emit('trash', id)
}

function handleRestore(id: number) {
  emit('restore', id)
}

function handlePurge(id: number) {
  emit('purge', id)
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
</script>

<template>
  <div>
    <div class="sticky top-0 z-10 flex items-center gap-2 rounded-md bg-background/95 px-1 py-2 backdrop-blur">
      <button type="button" class="flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground" @click="toggleExpanded">
        <ChevronDown v-if="expanded" :size="16" />
        <ChevronRight v-else :size="16" />
      </button>
      <AnnotationBookThumb :book-id="bookId" :title="bookTitle" class="h-9 w-7" />
      <div class="flex min-w-0 flex-col">
        <RouterLink :to="bookLink" class="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary hover:underline">
          {{ bookTitle }}
        </RouterLink>
        <span v-if="author" class="truncate text-xs text-muted-foreground">{{ author }}</span>
      </div>
      <span class="shrink-0 text-xs text-muted-foreground">({{ items.length }})</span>
    </div>

    <div v-if="expanded" class="mt-1 flex flex-col gap-2 md:ml-7">
      <AnnotationCard
        v-for="annotation in items"
        :key="annotation.id"
        :annotation="annotation"
        :selected="selectedIds.has(annotation.id)"
        :trashed="trashed"
        :density="density"
        :show-book-header="false"
        :saving="savingIds.has(annotation.id)"
        @toggle-select="handleToggleSelect"
        @jump="handleJump"
        @trash="handleTrash"
        @restore="handleRestore"
        @purge="handlePurge"
        @update-note="handleUpdateNote"
        @update-color="handleUpdateColor"
        @update-style="handleUpdateStyle"
      />
    </div>
  </div>
</template>
