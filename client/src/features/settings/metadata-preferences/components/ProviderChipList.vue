<script setup lang="ts">
import { ref } from 'vue'
import { GripVertical, X } from 'lucide-vue-next'
import type { MetadataProviderKey, ProviderStatus } from '@projectx/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'

const REORDER_TYPE = 'application/x-field-chip-index'

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
  e.dataTransfer!.setData(REORDER_TYPE, String(index))
  e.stopPropagation()
}

function onDragOver(index: number, e: DragEvent) {
  if (!e.dataTransfer?.types.includes(REORDER_TYPE)) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  if (draggingIndex.value !== null && draggingIndex.value !== index) {
    dragOverIndex.value = index
  }
}

function onDragLeave(index: number) {
  if (dragOverIndex.value === index) dragOverIndex.value = null
}

function onDrop(targetIndex: number, e: DragEvent) {
  if (!e.dataTransfer?.types.includes(REORDER_TYPE)) return
  e.stopPropagation()
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

function removeProvider(index: number) {
  const updated = [...props.providers]
  updated.splice(index, 1)
  emit('update:providers', updated)
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5 min-h-[26px] items-center">
    <div
      v-for="(key, index) in providers"
      :key="key"
      :draggable="!disabled"
      :title="statusFor(key)?.label ?? key"
      class="flex items-center gap-1 h-6 pl-1.5 pr-1 rounded text-xs font-medium select-none"
      :style="providerChipStyle(key, !isUsable(key))"
      :class="[
        !disabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        draggingIndex === index ? 'opacity-30 scale-95' : '',
        dragOverIndex === index ? 'ring-2 ring-white/60 scale-105' : '',
      ]"
      style="transition: transform 0.12s ease"
      @dragstart="onDragStart(index, $event)"
      @dragover="onDragOver(index, $event)"
      @dragleave="onDragLeave(index)"
      @drop="onDrop(index, $event)"
      @dragend="onDragEnd"
    >
      <GripVertical v-if="!disabled" :size="10" class="opacity-50 shrink-0" />
      <span class="opacity-70 tabular-nums leading-none">{{ index + 1 }}</span>
      <span>{{ PROVIDER_SHORT_LABELS[key] ?? key }}</span>
      <button
        v-if="!disabled"
        class="ml-0.5 h-4 w-4 flex items-center justify-center rounded-sm opacity-60 hover:opacity-100 hover:bg-white/20 transition-opacity"
        @click.stop="removeProvider(index)"
        @mousedown.stop
      >
        <X :size="12" :stroke-width="3" />
      </button>
    </div>

    <span v-if="providers.length === 0 && !disabled" class="text-xs text-muted-foreground/40 italic h-6 flex items-center px-1">
      drag a provider here
    </span>
  </div>
</template>
