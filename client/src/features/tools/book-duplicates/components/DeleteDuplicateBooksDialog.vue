<script setup lang="ts">
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; count: number; deleting: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()

function handleOpenChange(open: boolean): void {
  if (!open && !props.deleting) emit('cancel')
}

function handleConfirm(): void {
  emit('confirm')
}

function handleCancel(): void {
  if (!props.deleting) emit('cancel')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle class="size-5 text-destructive" aria-hidden="true" />
          </div>
          <div>
            <DialogTitle class="text-lg font-semibold text-foreground">
              {{ t('tools.bookDuplicates.deleteDialog.title') }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              {{ t('tools.bookDuplicates.deleteDialog.description', { count: props.count }, props.count) }}
            </DialogDescription>
            <p class="mt-3 text-sm font-medium text-destructive">
              {{ t('tools.bookDuplicates.deleteDialog.warning') }}
            </p>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <Button variant="outline" :disabled="props.deleting" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" :disabled="props.deleting" @click="handleConfirm">
            <Loader2 v-if="props.deleting" class="animate-spin" aria-hidden="true" />
            {{ t('tools.bookDuplicates.deleteDialog.confirm', { count: props.count }, props.count) }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
