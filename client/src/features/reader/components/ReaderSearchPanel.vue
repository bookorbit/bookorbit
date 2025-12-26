<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Search, X } from 'lucide-vue-next'
import type { SearchResult } from '../composables/useSearch'

const props = defineProps<{
  results: SearchResult[]
  isSearching: boolean
  initialQuery?: string
}>()

const emit = defineEmits<{
  search: [query: string]
  clear: []
  navigate: [cfi: string]
  close: []
}>()

const inputValue = ref(props.initialQuery ?? '')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(inputValue, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val.trim()) {
    emit('clear')
    return
  }
  debounceTimer = setTimeout(() => {
    emit('search', val.trim())
  }, 600)
})

function onClear() {
  inputValue.value = ''
  emit('clear')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex">
    <div class="w-80 h-full bg-card text-card-foreground flex flex-col shadow-2xl border-r border-border" @click.stop>
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Search :size="16" class="text-muted-foreground shrink-0" />
        <input
          v-model="inputValue"
          type="text"
          placeholder="Search in book..."
          class="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autofocus
        />
        <button
          v-if="inputValue"
          class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          @click="onClear"
        >
          <X :size="14" />
        </button>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          @click="emit('close')"
          title="Close"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="isSearching" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 :size="16" class="animate-spin" />
          Searching…
        </div>

        <div v-else-if="inputValue && !isSearching && results.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
          No results found
        </div>

        <div v-else-if="!inputValue" class="px-4 py-8 text-center text-sm text-muted-foreground">Type to search</div>

        <ul v-else class="divide-y divide-border">
          <li
            v-for="(result, idx) in results"
            :key="idx"
            class="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
            @click="emit('navigate', result.cfi)"
          >
            <p class="text-sm leading-relaxed line-clamp-3 mb-1">
              <span class="text-muted-foreground">{{ result.excerpt.pre }}</span
              ><mark class="bg-yellow-300 text-yellow-900 rounded px-0.5">{{ result.excerpt.match }}</mark
              ><span class="text-muted-foreground">{{ result.excerpt.post }}</span>
            </p>
            <p v-if="result.sectionTitle" class="text-xs text-muted-foreground/60 truncate">
              {{ result.sectionTitle }}
            </p>
          </li>
        </ul>

        <p v-if="results.length > 0 && !isSearching" class="px-4 py-2 text-xs text-muted-foreground text-center border-t border-border">
          {{ results.length }} result{{ results.length !== 1 ? 's' : '' }}
        </p>
      </div>
    </div>

    <div class="flex-1" @click="emit('close')" />
  </div>
</template>
