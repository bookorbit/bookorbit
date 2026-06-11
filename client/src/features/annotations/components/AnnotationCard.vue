<script setup lang="ts">
import type { AnnotationHubItem, AnnotationItem } from '@bookorbit/types'
import AnnotationListItem from './AnnotationListItem.vue'

defineProps<{
  annotation: AnnotationHubItem
  selected: boolean
  trashed: boolean
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  jump: [annotation: AnnotationHubItem]
  trash: [id: number]
  restore: [id: number]
  purge: [id: number]
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
</script>

<template>
  <AnnotationListItem
    :annotation="annotation"
    :selected="selected"
    :trashed="trashed"
    mode="hub"
    density="comfortable"
    @toggle-select="handleToggleSelect"
    @jump="handleJump"
    @trash="handleTrash"
    @restore="handleRestore"
    @purge="handlePurge"
  />
</template>
