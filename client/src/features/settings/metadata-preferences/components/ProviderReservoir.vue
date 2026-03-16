<script setup lang="ts">
import { GripVertical } from 'lucide-vue-next'
import type { ProviderStatus } from '@projectx/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'

defineProps<{
  statuses: ProviderStatus[]
}>()

function onDragStart(key: string, e: DragEvent) {
  e.dataTransfer!.effectAllowed = 'copy'
  e.dataTransfer!.setData('application/x-provider-key', key)
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <div
      v-for="status in statuses"
      :key="status.key"
      :draggable="status.enabled && status.configured"
      :title="
        !status.enabled
          ? `${status.label} - disabled`
          : !status.configured
            ? `${status.label} - not configured`
            : `Drag to assign ${status.label} to a field`
      "
      class="flex items-center gap-1.5 h-7 px-3 rounded text-[10px] font-bold uppercase tracking-tight select-none transition-all shadow-xs"
      :style="providerChipStyle(status.key, !(status.enabled && status.configured))"
      :class="
        status.enabled && status.configured ? 'cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95' : 'cursor-not-allowed opacity-40'
      "
      @dragstart="onDragStart(status.key, $event)"
    >
      <GripVertical v-if="status.enabled && status.configured" :size="10" class="shrink-0 -ml-1 opacity-50" />
      <span>{{ PROVIDER_SHORT_LABELS[status.key] ?? status.key }}</span>
    </div>
  </div>
</template>
