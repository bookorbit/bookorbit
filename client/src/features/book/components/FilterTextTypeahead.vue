<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  modelValue: string
  endpoint: string
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const suggestions = ref<string[]>([])
const showDropdown = ref(false)
const activeIndex = ref(-1)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let latestRequestId = 0

watch(
  () => props.modelValue,
  (q) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!q.trim()) {
      suggestions.value = []
      showDropdown.value = false
      return
    }
    debounceTimer = setTimeout(async () => {
      const requestId = ++latestRequestId
      const res = await api(`${props.endpoint}?q=${encodeURIComponent(q)}`)
      if (requestId !== latestRequestId) return
      if (!res.ok) return
      const data: { name: string }[] = await res.json()
      suggestions.value = data.map((d) => d.name)
      showDropdown.value = suggestions.value.length > 0
      activeIndex.value = -1
    }, 200)
  },
)

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  latestRequestId = -1
})

function select(value: string) {
  emit('update:modelValue', value)
  showDropdown.value = false
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, -1)
  } else if (e.key === 'Enter' && activeIndex.value >= 0) {
    e.preventDefault()
    const s = suggestions.value[activeIndex.value]
    if (s) select(s)
  } else if (e.key === 'Escape') {
    showDropdown.value = false
  }
}

function onBlur() {
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}
</script>

<template>
  <div class="relative flex-1 min-w-32">
    <input
      :value="modelValue"
      type="text"
      :placeholder="placeholder ?? t('book.filter.valuePlaceholder')"
      class="h-9 w-full rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <div
      v-if="showDropdown"
      class="absolute top-full left-0 mt-1 z-50 w-full min-w-40 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
    >
      <button
        v-for="(suggestion, i) in suggestions"
        :key="suggestion"
        type="button"
        class="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
        :class="{ 'bg-accent': i === activeIndex }"
        @mousedown.prevent="select(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>
