<script setup lang="ts">
import { X } from '@lucide/vue'
import type { ActiveFilterChip } from '../lib/filter-chips'

defineProps<{ chips: ActiveFilterChip[] }>()
const emit = defineEmits<{ remove: [id: string]; clearAll: [] }>()

function handleRemove(id: string) {
  emit('remove', id)
}

function handleClearAll() {
  emit('clearAll')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs text-muted-foreground">Active:</span>
    <button
      v-for="chip in chips"
      :key="chip.id"
      type="button"
      class="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/70"
      :aria-label="`Remove filter ${chip.label}`"
      @click="handleRemove(chip.id)"
    >
      {{ chip.label }}
      <X :size="12" class="text-muted-foreground" />
    </button>
    <button
      type="button"
      class="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      @click="handleClearAll"
    >
      Clear all
    </button>
  </div>
</template>
