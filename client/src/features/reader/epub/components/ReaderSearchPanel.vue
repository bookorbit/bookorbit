<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Loader2, Search, X } from '@lucide/vue'
import type { SearchResult } from '../composables/useSearch'
import { MIN_SEARCH_QUERY_LENGTH } from '../composables/useSearch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()

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
const trimmedInputValue = computed(() => inputValue.value.trim())
const isTooShort = computed(() => trimmedInputValue.value.length > 0 && trimmedInputValue.value.length < MIN_SEARCH_QUERY_LENGTH)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(inputValue, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const normalized = val.trim()
  if (!normalized) {
    emit('clear')
    return
  }
  if (normalized.length < MIN_SEARCH_QUERY_LENGTH) {
    emit('clear')
    return
  }
  debounceTimer = setTimeout(() => {
    emit('search', normalized)
  }, 600)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function onClear() {
  inputValue.value = ''
  emit('clear')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end">
    <div class="flex-1" @click="emit('close')" />

    <div
      class="search-panel w-[19rem] sm:w-[20rem] md:w-[21.5rem] lg:w-[22.5rem] h-full bg-card text-card-foreground flex flex-col shadow-2xl border-l border-border"
      @click.stop
    >
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              @click="emit('close')"
            >
              <ChevronRight :size="18" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('common.close') }}</TooltipContent>
        </Tooltip>
        <Search :size="15" class="text-muted-foreground shrink-0" />
        <input
          v-model="inputValue"
          type="text"
          :placeholder="t('reader.search.placeholder', { min: MIN_SEARCH_QUERY_LENGTH })"
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
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="isSearching" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 :size="16" class="animate-spin" />
          {{ t('reader.search.searching') }}
        </div>

        <div v-else-if="isTooShort" class="px-4 py-8 text-center text-sm text-muted-foreground">
          {{ t('reader.search.tooShort', { min: MIN_SEARCH_QUERY_LENGTH }) }}
        </div>

        <div v-else-if="trimmedInputValue && !isSearching && results.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
          {{ t('reader.search.noResults') }}
        </div>

        <div v-else-if="!trimmedInputValue" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('reader.search.prompt') }}</div>

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
            <p v-if="result.sectionTitle" class="text-xs text-muted-foreground/80 truncate">
              {{ result.sectionTitle }}
            </p>
          </li>
        </ul>

        <p v-if="results.length > 0 && !isSearching" class="px-4 py-2 text-xs text-muted-foreground text-center border-t border-border">
          {{ t('reader.search.resultCount', { count: results.length }, results.length) }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  animation: slideInFromRight 0.25s ease;
}

@keyframes slideInFromRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
</style>
