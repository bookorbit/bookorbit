<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from '@lucide/vue'
import type { BookWriteAndRenameResult } from '@bookorbit/types'

const props = defineProps<{
  result: BookWriteAndRenameResult
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const { t } = useI18n()

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
  if (status === 'success') return t('book.detail.writeRename.written', { count: fieldsWritten.length }, fieldsWritten.length)
  if (status === 'failed') return reason ?? t('book.detail.writeRename.writeFailed')
  return reason ?? t('book.detail.writeRename.skipped')
})

const renameLabel = computed(() => {
  const { status, reason, newPath } = props.result.rename
  if (status === 'success')
    return newPath ? t('book.detail.writeRename.renamedTo', { name: newPath.split('/').pop() }) : t('book.detail.writeRename.fileRenamed')
  if (status === 'failed') return reason ?? t('book.detail.writeRename.renameFailed')
  return reason ?? t('book.detail.writeRename.skipped')
})

const hasWarning = computed(() => !props.result.libraryAutoWriteEnabled || !props.result.libraryAutoRenameEnabled)

const autoDisabledWarning = computed(() => {
  const { libraryAutoWriteEnabled, libraryAutoRenameEnabled } = props.result
  if (!libraryAutoWriteEnabled && !libraryAutoRenameEnabled) return t('book.detail.writeRename.autoWriteAndRenameDisabled')
  if (!libraryAutoWriteEnabled) return t('book.detail.writeRename.autoWriteDisabled')
  return t('book.detail.writeRename.autoRenameDisabled')
})

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
          <span class="font-medium">{{ t('book.detail.writeRename.writeLabel') }}</span>
          <span class="text-muted-foreground truncate">{{ writeLabel }}</span>
        </div>
        <div class="flex items-center gap-2">
          <component :is="renameStatusIcon" :class="['size-3.5 shrink-0', renameStatusClass]" />
          <span class="font-medium">{{ t('book.detail.writeRename.renameLabel') }}</span>
          <span class="text-muted-foreground truncate">{{ renameLabel }}</span>
        </div>
        <div v-if="hasWarning" class="flex items-start gap-1.5 text-amber-600 dark:text-amber-400 pt-0.5">
          <AlertTriangle class="size-3.5 shrink-0 mt-px" />
          <span>{{ autoDisabledWarning }}</span>
        </div>
      </div>
      <button class="shrink-0 rounded p-0.5 hover:bg-muted transition-colors text-muted-foreground" @click="handleDismiss">
        <X class="size-3.5" />
      </button>
    </div>
  </div>
</template>
