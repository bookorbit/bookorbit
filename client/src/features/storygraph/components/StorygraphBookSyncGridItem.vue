<script setup lang="ts">
import { computed } from 'vue'
import { RefreshCw } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useStorygraphBookSyncState } from '../composables/useStorygraphBookSyncState'

const props = defineProps<{ bookId: number }>()
const bookIdRef = computed(() => props.bookId)
const { visible, syncEnabled, canSyncNow, statusText, statusClass, disabled, syncNow, setSyncEnabled } = useStorygraphBookSyncState(bookIdRef)
</script>

<template>
  <div v-if="visible" class="min-w-0">
    <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">StoryGraph Sync</dt>
    <dd class="mt-0.5 flex flex-wrap items-center gap-2">
      <ToggleSwitch
        :model-value="syncEnabled"
        :disabled="disabled"
        aria-label="Sync this book with StoryGraph"
        @update:model-value="setSyncEnabled"
      />
      <span class="min-w-0 truncate text-sm" :class="statusClass">{{ statusText }}</span>
      <button
        v-if="canSyncNow"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-muted/80 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled"
        @click="syncNow"
      >
        <RefreshCw class="size-3.5" />
        Sync now
      </button>
    </dd>
  </div>
</template>
