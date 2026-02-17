<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
  searchFn: (q: string) => Promise<string[]>
}>()

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const query = ref('')
const results = ref<string[]>([])
const showDropdown = ref(false)
let debounceTimer: ReturnType<typeof setTimeout>

async function onInput() {
  clearTimeout(debounceTimer)
  if (!query.value.trim()) {
    results.value = []
    showDropdown.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    const res = await props.searchFn(query.value)
    results.value = res.filter((r) => !props.modelValue.includes(r))
    showDropdown.value = results.value.length > 0
  }, 200)
}

function addItem(item: string) {
  const trimmed = item.trim()
  if (trimmed && !props.modelValue.includes(trimmed)) {
    emit('update:modelValue', [...props.modelValue, trimmed])
  }
  query.value = ''
  results.value = []
  showDropdown.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && query.value.trim()) {
    e.preventDefault()
    addItem(query.value)
  } else if (e.key === 'Backspace' && !query.value && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

function removeItem(item: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== item),
  )
}

function onBlur() {
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}

onUnmounted(() => clearTimeout(debounceTimer))
</script>

<template>
  <div class="relative">
    <div
      class="min-h-10 flex flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm focus-within:ring-1 focus-within:ring-ring transition-shadow"
    >
      <span v-for="item in modelValue" :key="item" class="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full text-xs">
        {{ item }}
        <button type="button" class="text-muted-foreground hover:text-foreground transition-colors" @click="removeItem(item)">
          <X class="size-3" />
        </button>
      </span>
      <input
        v-model="query"
        class="flex-1 min-w-24 bg-transparent outline-none placeholder:text-muted-foreground"
        :placeholder="modelValue.length === 0 ? placeholder : ''"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>
    <ul v-if="showDropdown" class="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
      <li v-for="item in results" :key="item" class="px-3 py-2 text-sm cursor-pointer hover:bg-muted" @mousedown.prevent="addItem(item)">
        {{ item }}
      </li>
    </ul>
  </div>
</template>
