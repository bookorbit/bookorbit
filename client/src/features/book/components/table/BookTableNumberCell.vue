<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'

const props = defineProps<{
  value: number | null
  isActive: boolean
  isReadOnly?: boolean
  min?: number
  max?: number
  allowDecimal?: boolean
}>()

const emit = defineEmits<{
  activate: []
  save: [value: number | null]
  cancel: []
  navigate: [direction: 'next' | 'prev' | 'rowUp' | 'rowDown']
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const draft = ref<string>(props.value != null ? String(props.value) : '')
let wasCancelled = false

watch(
  () => props.isActive,
  (active) => {
    if (active) {
      wasCancelled = false
      draft.value = props.value != null ? String(props.value) : ''
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
)

const parsedValue = computed<number | null>(() => {
  const trimmed = String(draft.value).trim()
  if (!trimmed) return null
  const n = props.allowDecimal ? parseFloat(trimmed) : parseInt(trimmed, 10)
  if (isNaN(n)) return null
  if (props.min != null && n < props.min) return props.min
  if (props.max != null && n > props.max) return props.max
  return n
})

function handleBlur() {
  if (wasCancelled) return
  emitSaveIfChanged(parsedValue.value)
}

function emitSaveIfChanged(nextValue: number | null) {
  if (nextValue === props.value) {
    emit('cancel')
    return
  }
  emit('save', nextValue)
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.allowDecimal && !e.ctrlKey && !e.metaKey && e.key.length === 1 && !/^\d$/.test(e.key)) {
    e.preventDefault()
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    emitSaveIfChanged(parsedValue.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    wasCancelled = true
    emit('cancel')
  } else if (e.key === 'Tab') {
    e.preventDefault()
    emit('navigate', e.shiftKey ? 'prev' : 'next')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    emit('navigate', 'rowDown')
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    emit('navigate', 'rowUp')
  }
}

function handleClick() {
  if (!props.isReadOnly) emit('activate')
}
</script>

<template>
  <div class="relative w-full min-w-0">
    <input
      v-if="isActive"
      ref="inputRef"
      v-model="draft"
      :type="allowDecimal ? 'text' : 'number'"
      class="w-full rounded border border-primary/50 bg-background px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-primary/70"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />
    <span
      v-else
      class="block min-h-[20px] truncate rounded px-1 text-sm"
      :class="[isReadOnly ? 'text-foreground' : 'cursor-pointer hover:bg-primary/5', value != null ? 'text-foreground' : 'text-muted-foreground/40']"
      :title="value != null ? String(value) : ''"
      :tabindex="isReadOnly ? -1 : 0"
      :role="isReadOnly ? undefined : 'button'"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      {{ value != null ? value : '-' }}
    </span>
  </div>
</template>
