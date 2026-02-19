<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Search } from 'lucide-vue-next'
import type { BookDetail, MetadataCandidate, MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'
import MetadataResultCard from './MetadataResultCard.vue'

const props = defineProps<{
  book: BookDetail
  providers: MetadataProviderInfo[]
  filteredResults: MetadataCandidate[]
  providerCounts: Partial<Record<MetadataProviderKey, number>>
  selectedProviders: MetadataProviderKey[]
  isStreaming: boolean
  hasSearched: boolean
}>()

const emit = defineEmits<{
  search: [{ title: string; author: string; isbn: string }]
  toggleProvider: [MetadataProviderKey]
  clearFilter: []
  select: [MetadataCandidate]
}>()

const form = reactive({
  title: props.book.title ?? '',
  author: props.book.authors[0]?.name ?? '',
  isbn: props.book.isbn13 ?? props.book.isbn10 ?? '',
})

const canSearch = computed(() => !!(form.title.trim() || form.isbn.trim()))

function runSearch() {
  if (canSearch.value) emit('search', { ...form })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Search form -->
    <div class="px-4 pt-4 pb-3 space-y-2 shrink-0">
      <div class="flex gap-2">
        <input
          v-model="form.title"
          class="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
          placeholder="Title"
          @keydown.enter="runSearch"
        />
        <input
          v-model="form.author"
          class="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
          placeholder="Author"
          @keydown.enter="runSearch"
        />
      </div>
      <div class="flex gap-2">
        <input
          v-model="form.isbn"
          class="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
          placeholder="ISBN"
          @keydown.enter="runSearch"
        />
        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          :disabled="!canSearch || isStreaming"
          @click="runSearch"
        >
          <Search class="size-3.5" />
          Search
        </button>
      </div>
    </div>

    <!-- Provider filter pills -->
    <div v-if="providers.length" class="flex items-center gap-1.5 px-4 pb-3 flex-wrap shrink-0">
      <button
        class="h-6 px-2.5 rounded-full text-xs font-medium transition-colors"
        :class="
          !selectedProviders.length
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:text-foreground'
        "
        @click="$emit('clearFilter')"
      >
        All
      </button>
      <button
        v-for="p in providers"
        :key="p.key"
        class="h-6 px-2.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1"
        :class="
          selectedProviders.includes(p.key)
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:text-foreground'
        "
        @click="$emit('toggleProvider', p.key)"
      >
        {{ p.label }}
        <span v-if="providerCounts[p.key]" class="opacity-70">{{ providerCounts[p.key] }}</span>
        <span v-else-if="isStreaming" class="size-1.5 rounded-full bg-current animate-pulse" />
      </button>
    </div>

    <!-- Results -->
    <div class="flex-1 overflow-y-auto px-4 pb-4">
      <div v-if="isStreaming && !filteredResults.length" class="py-8 flex flex-col items-center gap-2 text-muted-foreground">
        <div class="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <p class="text-sm">Searching...</p>
      </div>

      <div v-else-if="!isStreaming && !filteredResults.length && hasSearched" class="py-8 text-center text-sm text-muted-foreground">
        No results found.
      </div>

      <div v-else class="space-y-0.5">
        <MetadataResultCard
          v-for="(candidate, i) in filteredResults"
          :key="`${candidate.provider}-${candidate.providerId}-${i}`"
          :candidate="candidate"
          :providers="providers"
          @select="$emit('select', $event)"
        />
      </div>
    </div>
  </div>
</template>
