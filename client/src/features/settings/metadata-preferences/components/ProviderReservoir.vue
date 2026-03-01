<script setup lang="ts">
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
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-border bg-muted/30">
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
        class="flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium select-none transition-transform"
        :style="providerChipStyle(status.key, !(status.enabled && status.configured))"
        :class="status.enabled && status.configured ? 'cursor-grab active:cursor-grabbing active:scale-95' : 'cursor-not-allowed'"
        @dragstart="onDragStart(status.key, $event)"
      >
        {{ PROVIDER_SHORT_LABELS[status.key] ?? status.key }}
      </div>
    </div>
    <span class="text-xs text-muted-foreground/60 hidden sm:block">drag onto any field row to assign</span>
  </div>
</template>
