<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Play } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  libraryName: string
  renameCount: number
  skippedCount: number
  heldBackCount: number
  /** Books the preview could not resolve at all: no naming pattern, or a per-book error. */
  cannotRenameCount: number
  untouchedCount: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

function handleOpenChange(open: boolean): void {
  if (!open) emit('cancel')
}

function handleConfirm(): void {
  emit('confirm')
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-[2px]" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 shadow-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div class="flex items-start gap-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle class="size-4.5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <DialogTitle class="text-base font-semibold">
              {{ t('tools.bulkRename.confirmDialog.title', { count: props.renameCount }) }}
            </DialogTitle>
            <DialogDescription class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {{ t('tools.bulkRename.confirmDialog.body', { library: props.libraryName }) }}
            </DialogDescription>
          </div>
        </div>

        <dl class="mt-3.5 overflow-hidden rounded-md border border-border">
          <div class="flex items-baseline justify-between gap-3 px-2.5 py-1.5 text-sm">
            <dt>{{ t('tools.bulkRename.confirmDialog.willRename') }}</dt>
            <dd class="font-semibold text-primary tabular-nums">{{ props.renameCount }}</dd>
          </div>
          <div v-if="props.skippedCount" class="flex items-baseline justify-between gap-3 border-t border-border px-2.5 py-1.5 text-sm">
            <dt>{{ t('tools.bulkRename.confirmDialog.skippedByYou') }}</dt>
            <dd class="font-semibold tabular-nums">{{ props.skippedCount }}</dd>
          </div>
          <div v-if="props.heldBackCount" class="flex items-baseline justify-between gap-3 border-t border-border px-2.5 py-1.5 text-sm">
            <dt>{{ t('tools.bulkRename.confirmDialog.heldBack') }}</dt>
            <dd class="font-semibold text-warning tabular-nums">{{ props.heldBackCount }}</dd>
          </div>
          <div v-if="props.cannotRenameCount" class="flex items-baseline justify-between gap-3 border-t border-border px-2.5 py-1.5 text-sm">
            <dt>{{ t('tools.bulkRename.confirmDialog.cannotRename') }}</dt>
            <dd class="font-semibold text-warning tabular-nums">{{ props.cannotRenameCount }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-t border-border px-2.5 py-1.5 text-sm">
            <dt>{{ t('tools.bulkRename.confirmDialog.untouched') }}</dt>
            <dd class="font-semibold tabular-nums">{{ props.untouchedCount }}</dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button @click="handleConfirm">
            <Play class="size-3.5" aria-hidden="true" />
            {{ t('tools.bulkRename.confirmDialog.confirm', { count: props.renameCount }) }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
