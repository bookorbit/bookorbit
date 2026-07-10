<script setup lang="ts">
import { AlertTriangle, RotateCcw } from '@lucide/vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

const props = defineProps<{
  open: boolean
  resetting: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function handleClose() {
  emit('close')
}

function handleConfirm() {
  emit('confirm')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/20" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <div class="flex gap-3">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle class="size-4" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-base font-semibold text-foreground">Reset reading state?</DialogTitle>
            <p class="mt-1.5 text-sm leading-6 text-muted-foreground">
              This clears BookOrbit and synced Kobo/KOReader progress, reading sessions, and reading dates for this book. Highlights, notes, and book
              files are kept.
            </p>
          </div>
        </div>

        <p v-if="props.error" class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {{ props.error }}
        </p>

        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            class="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="props.resetting"
            @click="handleClose"
          >
            Cancel
          </button>
          <button
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="props.resetting"
            @click="handleConfirm"
          >
            <RotateCcw class="size-3.5" />
            {{ props.resetting ? 'Resetting...' : 'Reset reading state' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
