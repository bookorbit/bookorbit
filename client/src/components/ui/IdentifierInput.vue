<script setup lang="ts">
import { normalizeIdentifierInput, type IdentifierInputKind } from '@bookorbit/types'

const props = defineProps<{ kind: IdentifierInputKind; modelValue?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function handleInput(event: Event) {
  if ((event as InputEvent).isComposing) return
  commit(event.target as HTMLInputElement)
}

function handleCompositionEnd(event: CompositionEvent) {
  commit(event.target as HTMLInputElement)
}

// Cleans in place rather than on save, so a pasted identifier is never cut by a length limit and
// the field shows exactly what will be stored. The caret stays after the same typed character.
function commit(input: HTMLInputElement) {
  const raw = input.value
  const normalized = normalizeIdentifierInput(props.kind, raw)
  if (normalized !== raw) {
    const caret = input.selectionStart
    input.value = normalized
    if (caret !== null && input.ownerDocument.activeElement === input) {
      const nextCaret = Math.min(normalizeIdentifierInput(props.kind, raw.slice(0, caret)).length, normalized.length)
      input.setSelectionRange(nextCaret, nextCaret)
    }
  }
  if (normalized !== (props.modelValue ?? '')) emit('update:modelValue', normalized)
}
</script>

<template>
  <input
    :value="modelValue ?? ''"
    type="text"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    @input="handleInput"
    @compositionend="handleCompositionEnd"
  />
</template>
