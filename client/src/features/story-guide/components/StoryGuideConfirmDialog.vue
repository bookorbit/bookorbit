<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

import { Button } from '@/components/ui/button'
import type { StoryGuideConfirmation, StoryGuideConfirmationChoice } from '../lib/story-guide-confirmation'

const props = defineProps<{
  confirmation: StoryGuideConfirmation | null
  /** The choice whose request is on its way; every choice waits for it. */
  busyChoice: string | null
  /** Where focus goes when the dialog closes: the control that opened it, when it is still there. */
  returnFocus?: () => HTMLElement | null
}>()

const emit = defineEmits<{ choose: [choice: StoryGuideConfirmationChoice]; close: [] }>()

/** Kept while the dialog closes, so its text does not vanish before it does. */
const shown = ref<StoryGuideConfirmation | null>(props.confirmation)

watch(
  () => props.confirmation,
  (next) => {
    if (next) shown.value = next
  },
)

/** Three choices do not fit in a row: they stack, the actions first and Cancel last. */
const stacked = computed(() => (shown.value?.choices.length ?? 0) > 2)
const orderedChoices = computed(() => {
  const choices = shown.value?.choices ?? []
  return stacked.value ? [...choices.filter((choice) => choice.action), ...choices.filter((choice) => !choice.action)] : choices
})

/**
 * Focus starts on the choice that only closes the dialog, wherever the layout puts it, so Enter
 * never sends anything. A dialog without one (Keep building?) starts with no choice focused.
 */
function handleOpenAutoFocus(event: Event) {
  const content = event.target instanceof HTMLElement ? event.target : null
  if (!content) return
  event.preventDefault()
  const closer = content.querySelector<HTMLElement>('[data-choice="cancel"]')
  ;(closer ?? content).focus()
}

function handleCloseAutoFocus(event: Event) {
  const target = props.returnFocus?.()
  if (!target?.isConnected) return
  event.preventDefault()
  target.focus()
}

function handleOpenChange(open: boolean) {
  if (!open && props.busyChoice === null) emit('close')
}

function handleChoice(choice: StoryGuideConfirmationChoice) {
  if (props.busyChoice !== null) return
  if (choice.action) emit('choose', choice)
  else emit('close')
}
</script>

<template>
  <DialogRoot :open="confirmation !== null" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        v-if="shown"
        aria-modal="true"
        data-testid="story-guide-confirmation"
        @open-auto-focus="handleOpenAutoFocus"
        @close-auto-focus="handleCloseAutoFocus"
        class="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div v-if="shown.destructive" class="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle class="size-5 text-destructive" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ shown.title }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ shown.message }}</DialogDescription>
            <p v-if="shown.estimate" class="mt-2 text-sm tabular-nums text-foreground" data-testid="story-guide-confirmation-estimate">
              {{ shown.estimate }}
            </p>
          </div>
        </div>
        <div class="mt-6 flex gap-2" :class="stacked ? 'flex-col' : 'flex-col-reverse sm:flex-row sm:justify-end'">
          <Button
            v-for="choice in orderedChoices"
            :key="choice.id"
            :variant="choice.variant"
            :disabled="busyChoice !== null"
            :data-choice="choice.id"
            @click="handleChoice(choice)"
          >
            <Loader2 v-if="busyChoice === choice.id" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ choice.label }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
