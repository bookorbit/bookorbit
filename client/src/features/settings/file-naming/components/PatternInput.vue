<script setup lang="ts">
import { computed, ref } from 'vue'
import PatternText from './PatternText.vue'

const props = withDefaults(
  defineProps<{
    id: string
    modelValue: string
    ariaLabel?: string
    describedBy?: string
    invalid?: boolean
    readonly?: boolean
    disabled?: boolean
    placeholder?: string
  }>(),
  { readonly: false, disabled: false, invalid: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const entry = ref<HTMLTextAreaElement | null>(null)

const isEmpty = computed(() => props.modelValue.length === 0)

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  // Patterns are a single path expression; a pasted newline would silently corrupt one.
  const cleaned = target.value.replace(/[\r\n]+/g, '')
  if (cleaned !== target.value) target.value = cleaned
  emit('update:modelValue', cleaned)
}

function handleEnter(event: KeyboardEvent) {
  event.preventDefault()
}

/** Lets the token palette drop text at the caret instead of appending it. */
function insertAtCaret(text: string, caretOffset = text.length) {
  const field = entry.value
  if (!field || props.readonly || props.disabled) return
  const start = field.selectionStart ?? props.modelValue.length
  const end = field.selectionEnd ?? start
  const next = props.modelValue.slice(0, start) + text + props.modelValue.slice(end)
  emit('update:modelValue', next)
  requestAnimationFrame(() => {
    field.focus()
    const caret = start + caretOffset
    field.setSelectionRange(caret, caret)
  })
}

function focus() {
  entry.value?.focus()
}

defineExpose({ insertAtCaret, focus })
</script>

<template>
  <div
    class="relative rounded-md border bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/45"
    :class="[
      invalid ? 'border-destructive focus-within:border-destructive focus-within:ring-destructive/40' : 'border-input',
      disabled ? 'opacity-50' : '',
    ]"
  >
    <!-- The painted layer sits in normal flow so it, not JavaScript, sets the height. -->
    <pre
      aria-hidden="true"
      class="m-0 min-h-9 whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[13px] leading-6"
    ><span v-if="isEmpty" class="text-muted-foreground">{{ placeholder }}</span><PatternText v-else :pattern="modelValue" /></pre>

    <textarea
      :id="id"
      ref="entry"
      :value="modelValue"
      rows="1"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      :readonly="readonly"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-describedby="describedBy"
      :aria-invalid="invalid ? 'true' : undefined"
      class="absolute inset-0 size-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-2.5 py-1.5 font-mono text-[13px] leading-6 text-transparent caret-primary outline-none selection:bg-primary/30"
      @input="handleInput"
      @keydown.enter="handleEnter"
    />
  </div>
</template>

<style scoped>
pre,
textarea {
  tab-size: 2;
  overflow-wrap: break-word;
  word-break: normal;
}
</style>
