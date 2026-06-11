<script setup lang="ts">
import type { AnnotationItem } from '@bookorbit/types'
import AnnotationListItem from '@/features/annotations/components/AnnotationListItem.vue'

defineProps<{
  highlight: AnnotationItem
}>()

const emit = defineEmits<{
  updateNote: [id: number, note: string | null]
  updateColor: [id: number, color: string]
  updateStyle: [id: number, style: string]
  delete: [id: number]
}>()

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
  emit('delete', id)
}
</script>

<template>
  <AnnotationListItem
    :annotation="highlight"
    :selectable="false"
    mode="book"
    density="comfortable"
    @update-note="handleUpdateNote"
    @update-color="handleUpdateColor"
    @update-style="handleUpdateStyle"
    @trash="handleTrash"
  />
</template>
