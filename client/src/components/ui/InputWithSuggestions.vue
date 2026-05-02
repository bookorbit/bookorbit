<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string | null
  searchFn: (q: string) => Promise<string[]>
  placeholder?: string
  disabled?: boolean
  class?: string
  maxlength?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const inputRef = ref<HTMLInputElement | null>(null)
const suggestions = ref<string[]>([])
const showDropdown = ref(false)
const activeIndex = ref(-1)
const dropdownStyle = ref<Record<string, string>>({})
const isFocused = ref(false)
const shouldSearchFromInput = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let latestRequestId = 0

function computeDropdownStyle() {
  if (!inputRef.value) return
  const rect = inputRef.value.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const maxH = 192
  if (spaceBelow < maxH && rect.top > maxH) {
    dropdownStyle.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: '9999',
    }
  } else {
    dropdownStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: '9999',
    }
  }
}

watch(
  () => props.modelValue,
  (q) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (props.disabled || !isFocused.value || !shouldSearchFromInput.value) {
      showDropdown.value = false
      activeIndex.value = -1
      return
    }
    if (!q?.trim()) {
      suggestions.value = []
      showDropdown.value = false
      return
    }
    shouldSearchFromInput.value = false
    debounceTimer = setTimeout(async () => {
      const requestId = ++latestRequestId
      const results = await props.searchFn(q)
      if (requestId !== latestRequestId) return
      suggestions.value = results
      if (results.length > 0) {
        computeDropdownStyle()
        showDropdown.value = true
      } else {
        showDropdown.value = false
      }
      activeIndex.value = -1
    }, 200)
  },
)

function onInput(e: Event) {
  shouldSearchFromInput.value = true
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function select(value: string) {
  shouldSearchFromInput.value = false
  emit('update:modelValue', value)
  showDropdown.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (showDropdown.value && suggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex.value = Math.max(activeIndex.value - 1, -1)
      return
    }
    if (e.key === 'Enter' && activeIndex.value >= 0) {
      e.preventDefault()
      const s = suggestions.value[activeIndex.value]
      if (s) select(s)
      return
    }
    if (e.key === 'Escape') {
      showDropdown.value = false
    }
  }
}

function onBlur() {
  isFocused.value = false
  shouldSearchFromInput.value = false
  if (debounceTimer) clearTimeout(debounceTimer)
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}

function onFocus() {
  isFocused.value = true
}
</script>

<template>
  <input
    ref="inputRef"
    :value="modelValue ?? ''"
    :placeholder="placeholder"
    :disabled="disabled"
    :maxlength="maxlength"
    :class="props.class"
    type="text"
    @input="onInput"
    @keydown="onKeydown"
    @focus="onFocus"
    @blur="onBlur"
  />
  <Teleport to="body">
    <div v-if="showDropdown" class="max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md" :style="dropdownStyle">
      <button
        v-for="(s, i) in suggestions"
        :key="s"
        type="button"
        class="w-full truncate px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
        :class="{ 'bg-accent': i === activeIndex }"
        @mousedown.prevent="select(s)"
      >
        {{ s }}
      </button>
    </div>
  </Teleport>
</template>
