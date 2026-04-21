<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import type { DismissedPairInfo } from '@bookorbit/types'

defineProps<{
  pairs: DismissedPairInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  undismiss: [idA: number | string, idB: number | string]
}>()

function handleUndismiss(pair: DismissedPairInfo): void {
  emit('undismiss', pair.idA, pair.idB)
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="loading" class="text-center py-4 text-sm text-muted-foreground">Loading dismissed pairs...</div>
    <div v-else-if="pairs.length === 0" class="text-center py-4 text-sm text-muted-foreground">No dismissed pairs</div>
    <div v-else class="divide-y divide-border border border-border rounded-lg overflow-hidden">
      <div
        v-for="pair in pairs"
        :key="`${pair.idA}-${pair.idB}`"
        class="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
      >
        <div class="flex-1 min-w-0">
          <span class="text-sm">{{ pair.nameA }}</span>
          <span class="text-muted-foreground mx-2">&harr;</span>
          <span class="text-sm">{{ pair.nameB }}</span>
          <span v-if="pair.reason" class="text-xs text-muted-foreground ml-2">({{ pair.reason }})</span>
        </div>
        <button
          class="inline-flex items-center gap-1 h-7 px-2 text-xs rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Restore this pair"
          @click="handleUndismiss(pair)"
        >
          <RotateCcw class="h-3.5 w-3.5" />
          Restore
        </button>
      </div>
    </div>
  </div>
</template>
