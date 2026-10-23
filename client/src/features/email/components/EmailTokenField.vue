<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * A text field that tints each {{variable}} where it stands. A native field cannot style part of its
 * text, so the text is drawn by a mirror underneath and the field's own glyphs are transparent. The
 * mirror keeps the field's font and box exactly, or the caret would drift from the letters it sits
 * between, which is why a token is tinted rather than set in another face.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    id: string
    multiline?: boolean
    rows?: number
    disabled?: boolean
    placeholder?: string
  }>(),
  { multiline: false, rows: 8, disabled: false, placeholder: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; focus: [] }>()

const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
/** What the field shows right now, including text an input method is still composing. */
const shown = ref(props.modelValue)
const scrollLeft = ref(0)
const scrollTop = ref(0)

watch(
  () => props.modelValue,
  (value) => {
    if (field.value?.value !== value || shown.value !== value) shown.value = value
  },
)

const parts = computed(() => shown.value.split(/(\{\{\w+\}\})/g).filter(Boolean))

function isToken(part: string): boolean {
  return /^\{\{\w+\}\}$/.test(part)
}
function syncScroll() {
  scrollLeft.value = field.value?.scrollLeft ?? 0
  scrollTop.value = field.value?.scrollTop ?? 0
}
function handleInput(event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  shown.value = target.value
  if (!(event as InputEvent).isComposing) emit('update:modelValue', target.value)
  syncScroll()
}
function handleCompositionEnd(event: CompositionEvent) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  shown.value = target.value
  emit('update:modelValue', target.value)
}
function handleFocus() {
  emit('focus')
}

defineExpose({ field })

const BOX = 'rounded-md border px-3 text-foreground'
const TEXT_SINGLE = 'h-9 text-sm whitespace-pre'
const TEXT_MULTI = 'py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]'
</script>

<template>
  <div class="relative rounded-md bg-background" :class="disabled ? 'opacity-50' : ''">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 overflow-hidden border-transparent"
      :class="[BOX, multiline ? TEXT_MULTI : `${TEXT_SINGLE} flex items-center`]"
    >
      <div class="min-w-0" :class="multiline ? '' : 'whitespace-pre'" :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }">
        <template v-for="(part, index) in parts" :key="index"
          ><span
            v-if="isToken(part)"
            class="rounded-[3px] bg-primary/12 text-primary shadow-[0_0_0_1.5px_color-mix(in_oklch,var(--primary)_12%,transparent)]"
            >{{ part }}</span
          ><template v-else>{{ part }}</template></template
        >&#8203;
      </div>
    </div>
    <textarea
      v-if="multiline"
      :id="id"
      ref="field"
      :value="modelValue"
      :rows="rows"
      :disabled="disabled"
      :placeholder="placeholder"
      class="relative block w-full resize-y border-input bg-transparent text-transparent caret-foreground scrollbar-none selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      :class="[BOX, TEXT_MULTI]"
      @input="handleInput"
      @compositionend="handleCompositionEnd"
      @scroll="syncScroll"
      @focus="handleFocus"
    />
    <input
      v-else
      :id="id"
      ref="field"
      :value="modelValue"
      type="text"
      autocomplete="off"
      :disabled="disabled"
      :placeholder="placeholder"
      class="relative block w-full border-input bg-transparent text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      :class="[BOX, TEXT_SINGLE]"
      @input="handleInput"
      @compositionend="handleCompositionEnd"
      @scroll="syncScroll"
      @keyup="syncScroll"
      @click="syncScroll"
      @focus="handleFocus"
    />
  </div>
</template>
