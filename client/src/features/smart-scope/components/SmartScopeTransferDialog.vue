<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'

const props = defineProps<{ title: string; description: string; busy?: boolean; returnFocusTo?: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

function close() {
  if (!props.busy) emit('close')
}

function handleOpenChange(open: boolean) {
  if (!open) close()
}

function restoreFocus(event: Event) {
  const target = props.returnFocusTo
  if (!target) return
  event.preventDefault()
  requestAnimationFrame(() => {
    if (target.isConnected) target.focus()
  })
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        @close-auto-focus="restoreFocus"
        class="fixed inset-x-0 bottom-0 z-[70] flex max-h-[92svh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl focus-visible:outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100svh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
      >
        <header class="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground [overflow-wrap:anywhere]">{{ title }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ description }}</DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="-me-2 -mt-1 shrink-0"
            :aria-label="t('common.close')"
            :disabled="busy"
            @click="close"
          >
            <X class="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div class="overflow-y-auto px-4 py-4 sm:px-6">
          <slot />
        </div>
        <footer class="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-6">
          <slot name="actions" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
