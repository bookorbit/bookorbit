<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

interface Item {
  id: number
  name: string
}

const props = defineProps<{
  modelValue: Item[]
  placeholder?: string
  searchFn: (q: string) => Promise<Item[]>
}>()

const emit = defineEmits<{ 'update:modelValue': [Item[]] }>()

const query = ref('')
const results = ref<Item[]>([])
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
    const selectedIds = new Set(props.modelValue.map((i) => i.id))
    const res = await props.searchFn(query.value)
    results.value = res.filter((r) => !selectedIds.has(r.id))
    showDropdown.value = results.value.length > 0
  }, 200)
}

function addItem(item: Item) {
  if (!props.modelValue.some((v) => v.id === item.id)) {
    emit('update:modelValue', [...props.modelValue, item])
  }
  query.value = ''
  results.value = []
  showDropdown.value = false
}

function removeItem(id: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v.id !== id),
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Backspace' && !query.value && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
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
      <span v-for="item in modelValue" :key="item.id" class="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full text-xs">
        {{ item.name }}
        <button type="button" class="text-muted-foreground hover:text-foreground transition-colors" @click="removeItem(item.id)">
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
      <li v-for="item in results" :key="item.id" class="px-3 py-2 text-sm cursor-pointer hover:bg-muted" @mousedown.prevent="addItem(item)">
        {{ item.name }}
      </li>
    </ul>
  </div>
</template>
