<script setup lang="ts">
import { Button } from '@/components/ui/button'
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
      <Button variant="outline" size="sm" v-if="canSyncNow" type="button" :disabled="disabled" @click="syncNow">
        <RefreshCw class="size-3.5" />
        Sync now
      </Button>
    </dd>
  </div>
</template>
