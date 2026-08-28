<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, X } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  done: number
  total: number
}>()

const emit = defineEmits<{ stop: [] }>()

const { t } = useI18n()

/**
 * Nothing has moved until the first file reports back. The wait before that is preparation:
 * resolving every candidate and detaching the library watcher. Drawing a 0% bar through it read
 * as a stalled rename, so the two phases look different.
 */
const preparing = computed(() => props.done === 0)

const percent = computed(() => (props.total ? Math.round((props.done / props.total) * 100) : 0))

function handleStop(): void {
  emit('stop')
}

/**
 * A run is in flight and files are moving, so the dialog is deliberately not dismissable. Stopping
 * is an explicit decision made with the Stop button, never a stray Escape or a click outside.
 */
function preventDismiss(event: Event): void {
  event.preventDefault()
}
</script>

<template>
  <DialogRoot :open="props.open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-[2px]" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 shadow-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        @escape-key-down="preventDismiss"
        @pointer-down-outside="preventDismiss"
        @interact-outside="preventDismiss"
      >
        <DialogTitle class="flex items-center gap-2 text-base font-semibold">
          <Loader2 v-if="preparing" class="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          {{ preparing ? t('tools.bulkRename.run.preparing') : t('tools.bulkRename.run.title', { done: props.done, total: props.total }) }}
        </DialogTitle>

        <DialogDescription class="mt-1.5 text-sm text-muted-foreground">
          {{ preparing ? t('tools.bulkRename.run.preparingHint') : t('tools.bulkRename.run.runningHint') }}
        </DialogDescription>

        <div v-if="preparing" class="mt-3.5 mb-2 h-2 animate-pulse rounded-full bg-muted motion-reduce:animate-none" aria-hidden="true" />
        <div
          v-else
          class="mt-3.5 mb-2 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-valuenow="props.done"
          aria-valuemin="0"
          :aria-valuemax="props.total"
        >
          <span class="block h-full rounded-full bg-primary transition-[width] duration-150" :style="{ width: `${percent}%` }" />
        </div>

        <div class="mt-4 flex justify-end">
          <Button variant="outline" @click="handleStop">
            <X class="size-3.5" aria-hidden="true" />
            {{ t('tools.bulkRename.run.stop') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
