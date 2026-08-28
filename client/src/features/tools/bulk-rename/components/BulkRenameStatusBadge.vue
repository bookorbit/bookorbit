<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BulkRenameStatus } from '@bookorbit/types'

const props = defineProps<{ status: BulkRenameStatus }>()

const { t } = useI18n()

const STATUS_CLASSES: Record<BulkRenameStatus, string> = {
  will_rename: 'border-primary/35 bg-primary/12 text-primary',
  unchanged: 'border-border bg-muted text-muted-foreground',
  collision: 'border-warning/35 bg-warning/14 text-warning',
  no_pattern: 'border-border bg-muted text-muted-foreground',
  error: 'border-destructive/35 bg-destructive/13 text-destructive',
}

const STATUS_LABELS: Record<BulkRenameStatus, string> = {
  will_rename: 'tools.bulkRename.status.willRename',
  unchanged: 'tools.bulkRename.status.unchanged',
  collision: 'tools.bulkRename.status.collision',
  no_pattern: 'tools.bulkRename.status.noPattern',
  error: 'tools.bulkRename.status.error',
}

const label = computed(() => t(STATUS_LABELS[props.status]))
const classes = computed(() => STATUS_CLASSES[props.status])
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1.5 text-[0.6875rem] font-semibold whitespace-nowrap"
    :class="classes"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    {{ label }}
  </span>
</template>
