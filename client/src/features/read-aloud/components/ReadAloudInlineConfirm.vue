<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { Loader2 } from '@lucide/vue'

/**
 * A destructive action that asks in place: the button turns into the question and its two answers,
 * so the decision happens where the user is looking instead of in a modal on top of the card.
 */
const props = defineProps<{
  label: string
  prompt: string
  confirmLabel: string
  keepLabel: string
  busy?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ confirm: [] }>()

const confirming = ref(false)
const triggerButton = ref<HTMLButtonElement | null>(null)
const keepButton = ref<HTMLButtonElement | null>(null)
const promptId = useId()

watch(
  () => props.busy,
  async (busy, wasBusy) => {
    if (busy || !wasBusy || !confirming.value) return
    // The action failed or finished without unmounting this control: hand the keyboard back.
    confirming.value = false
    await nextTick()
    triggerButton.value?.focus()
  },
)

async function handleAsk(): Promise<void> {
  if (props.disabled || props.busy) return
  confirming.value = true
  await nextTick()
  keepButton.value?.focus()
}

async function handleKeep(): Promise<void> {
  confirming.value = false
  await nextTick()
  triggerButton.value?.focus()
}

function handleConfirm(): void {
  if (props.busy) return
  emit('confirm')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  void handleKeep()
}
</script>

<template>
  <div v-if="confirming" role="group" :aria-labelledby="promptId" class="inline-flex flex-wrap items-center gap-2" @keydown="handleKeydown">
    <span :id="promptId" class="text-[12.5px] font-medium text-foreground">{{ prompt }}</span>
    <button
      ref="keepButton"
      type="button"
      class="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :disabled="busy"
      @click="handleKeep"
    >
      {{ keepLabel }}
    </button>
    <button
      type="button"
      class="inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-2.5 text-[12.5px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      :aria-disabled="busy ? 'true' : undefined"
      @click="handleConfirm"
    >
      <Loader2 v-if="busy" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ confirmLabel }}
    </button>
  </div>
  <button
    v-else
    ref="triggerButton"
    type="button"
    class="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    :disabled="disabled"
    @click="handleAsk"
  >
    {{ label }}
  </button>
</template>
