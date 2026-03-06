<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'

defineProps<{
  matchCount: number
  currentIndex: number
}>()

const emit = defineEmits<{
  close: []
  search: [query: string]
  next: []
  prev: []
  'update:matchCase': [v: boolean]
  'update:wholeWord': [v: boolean]
  'update:highlightAll': [v: boolean]
}>()

const query = ref('')
const matchCase = ref(false)
const wholeWord = ref(false)
const highlightAll = ref(true)
const inputRef = ref<HTMLInputElement | null>(null)

watch(query, (q) => emit('search', q))
watch(matchCase, () => emit('search', query.value))
watch(wholeWord, () => emit('search', query.value))

watch(matchCase, (v) => emit('update:matchCase', v))
watch(wholeWord, (v) => emit('update:wholeWord', v))
watch(highlightAll, (v) => emit('update:highlightAll', v))

defineExpose({
  focus() {
    nextTick(() => inputRef.value?.focus())
  },
  clear() {
    query.value = ''
  },
})
</script>

<template>
  <div class="flex items-center gap-1.5 px-3 py-1.5 shrink-0" style="background: rgba(60, 65, 70, 1); border-bottom: 1px solid rgba(0, 0, 0, 0.3)">
    <input
      ref="inputRef"
      v-model="query"
      type="search"
      placeholder="Find in document..."
      class="flex-1 min-w-0 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/30"
      style="max-width: 260px"
      @keydown.enter.exact="emit('next')"
      @keydown.enter.shift.exact.prevent="emit('prev')"
      @keydown.escape="emit('close')"
    />

    <!-- Match count -->
    <span class="text-xs text-white/40 tabular-nums shrink-0 min-w-[48px]">
      <template v-if="query && matchCount > 0">{{ currentIndex + 1 }} of {{ matchCount }}</template>
      <template v-else-if="query && matchCount === 0">No results</template>
    </span>

    <!-- Prev / Next -->
    <button class="viewer-btn w-7 h-7" :disabled="matchCount === 0" title="Previous match" @click="emit('prev')">
      <ChevronUp :size="13" />
    </button>
    <button class="viewer-btn w-7 h-7" :disabled="matchCount === 0" title="Next match" @click="emit('next')">
      <ChevronDown :size="13" />
    </button>

    <div class="w-px h-4 bg-white/15 mx-0.5 shrink-0" />

    <!-- Options -->
    <label class="flex items-center gap-1 text-xs text-white/60 hover:text-white/90 cursor-pointer select-none transition-colors">
      <input v-model="matchCase" type="checkbox" class="accent-blue-400 w-3 h-3" />
      Match Case
    </label>
    <label class="flex items-center gap-1 text-xs text-white/60 hover:text-white/90 cursor-pointer select-none transition-colors">
      <input v-model="wholeWord" type="checkbox" class="accent-blue-400 w-3 h-3" />
      Whole Words
    </label>
    <label class="flex items-center gap-1 text-xs text-white/60 hover:text-white/90 cursor-pointer select-none transition-colors">
      <input v-model="highlightAll" type="checkbox" class="accent-blue-400 w-3 h-3" />
      Highlight All
    </label>

    <div class="w-px h-4 bg-white/15 mx-0.5 shrink-0" />

    <button class="viewer-btn w-7 h-7" title="Close find bar" @click="emit('close')">
      <X :size="13" />
    </button>
  </div>
</template>
