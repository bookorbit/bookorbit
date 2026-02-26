<script setup lang="ts">
import { ref } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import type { MetadataProviderKey, ProviderStatus } from '@projectx/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'

const props = defineProps<{
  providers: MetadataProviderKey[]
  statuses: ProviderStatus[]
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:providers': [value: MetadataProviderKey[]] }>()

function statusFor(key: MetadataProviderKey) {
  return props.statuses.find((s) => s.key === key)
}

function isUsable(key: MetadataProviderKey) {
  const s = statusFor(key)
  return s ? s.enabled && s.configured : true
}

const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent) {
  draggingIndex.value = index
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  if (draggingIndex.value !== null && draggingIndex.value !== index) {
    dragOverIndex.value = index
  }
}

function onDragLeave(index: number) {
  if (dragOverIndex.value === index) dragOverIndex.value = null
}

function onDrop(targetIndex: number) {
  if (draggingIndex.value === null || draggingIndex.value === targetIndex) return
  const updated = [...props.providers]
  const [moved] = updated.splice(draggingIndex.value, 1)
  updated.splice(targetIndex, 0, moved)
  emit('update:providers', updated)
  draggingIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  dragOverIndex.value = null
}

function chipTitle(key: MetadataProviderKey) {
  const s = statusFor(key)
  if (!s) return key
  if (!s.enabled) return `${s.label} (disabled)`
  if (!s.configured) return `${s.label} (API key required)`
  return s.label
}
</script>

<template>
  <div class="flex flex-wrap gap-1">
    <div
      v-for="(key, index) in providers"
      :key="key"
      :draggable="!disabled"
      :title="chipTitle(key)"
      class="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] font-medium select-none"
      :style="providerChipStyle(key, !isUsable(key))"
      :class="[
        !disabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        draggingIndex === index ? 'opacity-30 scale-95' : '',
        dragOverIndex === index ? 'ring-2 ring-white/70 scale-110 brightness-125' : '',
      ]"
      style="transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease"
      @dragstart="onDragStart(index, $event)"
      @dragover="onDragOver(index, $event)"
      @dragleave="onDragLeave(index)"
      @drop="onDrop(index)"
      @dragend="onDragEnd"
    >
      <GripVertical v-if="!disabled" :size="10" class="opacity-40 shrink-0" />
      <span class="opacity-40 tabular-nums leading-none">{{ index + 1 }}</span>
      {{ PROVIDER_SHORT_LABELS[key] ?? key }}
    </div>
  </div>
</template>
