<script setup lang="ts">
import type { AnnotationHubItem, AnnotationItem } from '@bookorbit/types'
import AnnotationListItem from './AnnotationListItem.vue'

withDefaults(
  defineProps<{
    annotation: AnnotationHubItem
    selected: boolean
    trashed: boolean
    showBookHeader?: boolean
    density?: 'compact' | 'comfortable'
    saving?: boolean
  }>(),
  {
    showBookHeader: true,
    density: 'comfortable',
    saving: false,
  },
)

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

function handleToggleSelect(id: number) {
  emit('toggleSelect', id)
}

function handleJump(annotation: AnnotationItem | AnnotationHubItem) {
  emit('jump', annotation as AnnotationHubItem)
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
  <AnnotationListItem
    :annotation="annotation"
    :selected="selected"
    :trashed="trashed"
    mode="hub"
    :density="density"
    :show-book-header="showBookHeader"
    :saving="saving"
    @toggle-select="handleToggleSelect"
    @jump="handleJump"
    @trash="handleTrash"
    @restore="handleRestore"
    @purge="handlePurge"
    @update-note="handleUpdateNote"
    @update-color="handleUpdateColor"
    @update-style="handleUpdateStyle"
  />
</template>
