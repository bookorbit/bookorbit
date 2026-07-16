<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { api } from '@/lib/api'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  modelValue: string[]
  endpoint: string
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const query = ref('')
const suggestions = ref<string[]>([])
const showDropdown = ref(false)
const activeIndex = ref(-1)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let latestRequestId = 0

watch(query, (q) => {
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
    suggestions.value = data.map((d) => d.name).filter((name) => !props.modelValue.includes(name))
    showDropdown.value = suggestions.value.length > 0
    activeIndex.value = -1
  }, 200)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  latestRequestId = -1
})

function addChip(value: string) {
  const trimmed = value.trim()
  if (!trimmed || props.modelValue.includes(trimmed)) return
  emit('update:modelValue', [...props.modelValue, trimmed])
  query.value = ''
  suggestions.value = []
  showDropdown.value = false
}

function removeChip(value: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== value),
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
      addChip(suggestions.value[activeIndex.value]!)
    } else if (query.value.trim()) {
      addChip(query.value)
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, -1)
  } else if (e.key === 'Escape') {
    showDropdown.value = false
  } else if (e.key === 'Backspace' && !query.value && props.modelValue.length > 0) {
    removeChip(props.modelValue[props.modelValue.length - 1]!)
  }
}

function onBlur() {
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}
</script>

<template>
  <div
    class="relative flex flex-wrap items-center gap-1 min-w-48 flex-1 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary"
  >
    <span
      v-for="chip in modelValue"
      :key="chip"
      class="flex items-center gap-1 h-5 px-1.5 rounded bg-primary/15 text-primary text-xs font-medium shrink-0"
    >
      {{ chip }}
      <button type="button" @click="removeChip(chip)" class="text-primary/60 hover:text-primary leading-none">
        <X :size="10" />
      </button>
    </span>
    <input
      v-model="query"
      type="text"
      :placeholder="modelValue.length === 0 ? (placeholder ?? t('book.filter.typeToSearch')) : ''"
      class="flex-1 min-w-20 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <div
      v-if="showDropdown"
      class="absolute top-full left-0 mt-1 z-50 w-full min-w-48 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
    >
      <button
        v-for="(suggestion, i) in suggestions"
        :key="suggestion"
        type="button"
        class="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
        :class="{ 'bg-accent': i === activeIndex }"
        @mousedown.prevent="addChip(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>
