<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { ChevronsUpDown, X } from '@lucide/vue'
import type { AnnotationHubBookFacet } from '@bookorbit/types'

const props = defineProps<{
  searchFn: (q: string) => Promise<AnnotationHubBookFacet[]>
  placeholder?: string
}>()

const model = defineModel<number | 'all'>({ required: true })
const selectedLabel = defineModel<string | null>('selectedLabel', { required: true })

const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const options = ref<AnnotationHubBookFacet[]>([])
const showDropdown = ref(false)
const isFocused = ref(false)
const loading = ref(false)
const activeIndex = ref(-1)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let latestRequestId = 0

const hasSelection = computed(() => model.value !== 'all')
const inputValue = computed(() => (isFocused.value ? query.value : (selectedLabel.value ?? '')))
const showEmpty = computed(() => showDropdown.value && !loading.value && options.value.length === 0)

async function runSearch(q: string) {
  loading.value = true
  const requestId = ++latestRequestId
  try {
    const result = await props.searchFn(q)
    if (requestId !== latestRequestId) return
    options.value = result
    activeIndex.value = -1
  } finally {
    if (requestId === latestRequestId) loading.value = false
  }
}

function scheduleSearch(q: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void runSearch(q), 200)
}

function onFocus() {
  isFocused.value = true
  query.value = ''
  showDropdown.value = true
  void runSearch('')
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  showDropdown.value = true
  scheduleSearch(query.value)
}

function select(option: AnnotationHubBookFacet) {
  model.value = option.bookId
  selectedLabel.value = option.bookTitle ?? 'Unknown book'
  query.value = ''
  showDropdown.value = false
  isFocused.value = false
  inputRef.value?.blur()
}

function clear() {
  model.value = 'all'
  selectedLabel.value = null
  query.value = ''
  options.value = []
  showDropdown.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, options.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, -1)
  } else if (event.key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    const option = options.value[activeIndex.value]
    if (option) select(option)
  } else if (event.key === 'Escape') {
    showDropdown.value = false
  }
}

function onBlur() {
  setTimeout(() => {
    isFocused.value = false
    showDropdown.value = false
    query.value = ''
  }, 150)
}

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  latestRequestId = -1
})
</script>

<template>
  <div class="relative w-full sm:w-[14rem]">
    <input
      ref="inputRef"
      :value="inputValue"
      type="text"
      role="combobox"
      aria-label="Filter by book"
      :aria-expanded="showDropdown"
      :placeholder="placeholder ?? 'All books'"
      class="h-9 w-full rounded-md border border-border bg-background pl-2.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      @focus="onFocus"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <button
      v-if="hasSelection"
      type="button"
      aria-label="Clear book filter"
      class="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @mousedown.prevent="clear"
    >
      <X :size="14" />
    </button>
    <ChevronsUpDown v-else :size="14" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />

    <div
      v-if="showDropdown"
      class="absolute top-full left-0 mt-1 z-50 w-full min-w-[16rem] max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
    >
      <p v-if="loading && options.length === 0" class="px-3 py-2 text-sm text-muted-foreground">Searching...</p>
      <p v-else-if="showEmpty" class="px-3 py-2 text-sm text-muted-foreground">No books found</p>
      <button
        v-for="(option, index) in options"
        :key="option.bookId"
        type="button"
        role="option"
        :aria-selected="option.bookId === model"
        class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
        :class="{ 'bg-accent': index === activeIndex }"
        @mousedown.prevent="select(option)"
      >
        <span class="min-w-0 flex-1 truncate">{{ option.bookTitle ?? 'Unknown book' }}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{{ option.count }}</span>
      </button>
    </div>
  </div>
</template>
