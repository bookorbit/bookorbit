<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-vue-next'
import type { BookWriteAndRenameResult } from '@bookorbit/types'

const props = defineProps<{
  result: BookWriteAndRenameResult
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const writeStatusIcon = computed(() => {
  if (props.result.write.status === 'success') return CheckCircle2
  if (props.result.write.status === 'failed') return XCircle
  return Info
})

const writeStatusClass = computed(() => {
  if (props.result.write.status === 'success') return 'text-green-600 dark:text-green-400'
  if (props.result.write.status === 'failed') return 'text-destructive'
  return 'text-muted-foreground'
})

const renameStatusIcon = computed(() => {
  if (props.result.rename.status === 'success') return CheckCircle2
  if (props.result.rename.status === 'failed') return XCircle
  return Info
})

const renameStatusClass = computed(() => {
  if (props.result.rename.status === 'success') return 'text-green-600 dark:text-green-400'
  if (props.result.rename.status === 'failed') return 'text-destructive'
  return 'text-muted-foreground'
})

const writeLabel = computed(() => {
  const { status, reason, fieldsWritten } = props.result.write
  if (status === 'success') return `Written (${fieldsWritten.length} field${fieldsWritten.length !== 1 ? 's' : ''})`
  if (status === 'failed') return reason ?? 'Write failed'
  return reason ?? 'Skipped'
})

const renameLabel = computed(() => {
  const { status, reason, newPath } = props.result.rename
  if (status === 'success') return newPath ? `Renamed to ${newPath.split('/').pop()}` : 'File renamed'
  if (status === 'failed') return reason ?? 'Rename failed'
  return reason ?? 'Skipped'
})

const hasWarning = computed(() => !props.result.libraryAutoWriteEnabled || !props.result.libraryAutoRenameEnabled)

function handleDismiss() {
  emit('dismiss')
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card p-3 text-sm space-y-2">
    <div class="flex items-start justify-between gap-2">
      <div class="space-y-1.5 min-w-0">
        <div class="flex items-center gap-2">
          <component :is="writeStatusIcon" :class="['size-3.5 shrink-0', writeStatusClass]" />
          <span class="font-medium">Write:</span>
          <span class="text-muted-foreground truncate">{{ writeLabel }}</span>
        </div>
        <div class="flex items-center gap-2">
          <component :is="renameStatusIcon" :class="['size-3.5 shrink-0', renameStatusClass]" />
          <span class="font-medium">Rename:</span>
          <span class="text-muted-foreground truncate">{{ renameLabel }}</span>
        </div>
        <div v-if="hasWarning" class="flex items-start gap-1.5 text-amber-600 dark:text-amber-400 pt-0.5">
          <AlertTriangle class="size-3.5 shrink-0 mt-px" />
          <span>
            Auto-{{
              !result.libraryAutoWriteEnabled && !result.libraryAutoRenameEnabled
                ? 'write and rename are'
                : !result.libraryAutoWriteEnabled
                  ? 'write is'
                  : 'rename is'
            }}
            disabled in library settings. Changes won't sync automatically on future saves.
          </span>
        </div>
      </div>
      <button class="shrink-0 rounded p-0.5 hover:bg-muted transition-colors text-muted-foreground" @click="handleDismiss">
        <X class="size-3.5" />
      </button>
    </div>
  </div>
</template>
