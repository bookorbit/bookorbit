<script setup lang="ts">
import { computed } from 'vue'
import type { BulkRenameStatus } from '@bookorbit/types'

const props = defineProps<{ status: BulkRenameStatus }>()

const config = computed(() => {
  switch (props.status) {
    case 'will_rename':
      return { label: 'Will Rename', classes: 'border-primary/40 bg-primary/15 text-primary' }
    case 'unchanged':
      return { label: 'Unchanged', classes: 'border-border/70 bg-muted text-muted-foreground' }
    case 'collision':
      return { label: 'Collision', classes: 'border-amber-500/40 bg-amber-500/15 text-amber-500' }
    case 'no_pattern':
      return { label: 'No Pattern', classes: 'border-border/70 bg-muted text-muted-foreground' }
    case 'error':
      return { label: 'Error', classes: 'border-destructive/40 bg-destructive/15 text-destructive' }
    default:
      return { label: props.status, classes: 'border-border/70 bg-muted text-muted-foreground' }
  }
})
</script>

<template>
  <span
    class="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium leading-none"
    :class="config.classes"
  >
    {{ config.label }}
  </span>
</template>
