<script setup lang="ts">
import { computed, inject, reactive, ref } from 'vue'
import { Search, BookOpen, Loader2 } from 'lucide-vue-next'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'
import MetadataResultCard from './MetadataResultCard.vue'
import { providerActivePillStyle } from '../../../lib/metadata-fetch'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'

const props = defineProps<{
  searchDefaults: { title?: string; author?: string; isbn?: string }
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

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const form = reactive({
  title: props.searchDefaults.title ?? '',
  author: props.searchDefaults.author ?? '',
  isbn: props.searchDefaults.isbn ?? '',
})

const canSearch = computed(() => !!(form.title.trim() || form.isbn.trim()))

function runSearch() {
  if (canSearch.value) emit('search', { ...form })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Search form card -->
    <div class="px-4 pt-4 pb-3 shrink-0">
      <div class="rounded-xl border border-border bg-card p-3 space-y-2 shadow-sm">
        <div class="flex gap-2">
          <div class="relative flex-1">
            <BookOpen class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              v-model="form.title"
              class="w-full h-8 rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
              placeholder="Title"
              @keydown.enter="runSearch"
            />
          </div>
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
            class="relative flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all disabled:opacity-40 hover:opacity-90 active:scale-95 overflow-hidden group"
            :disabled="!canSearch || isStreaming"
            @click="runSearch"
          >
            <span class="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <Loader2 v-if="isStreaming" class="size-3.5 animate-spin" />
            <Search v-else class="size-3.5" />
            {{ isStreaming ? 'Searching...' : 'Search' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Provider filter pills -->
    <div v-if="providers.length" class="flex items-center gap-1.5 px-4 pb-3 flex-wrap shrink-0">
      <button
        class="h-6 px-2.5 rounded-full text-xs font-medium transition-all active:scale-95"
        :class="
          !selectedProviders.length
            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
            : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
        "
        @click="$emit('clearFilter')"
      >
        All
      </button>
      <button
        v-for="p in providers"
        :key="p.key"
        class="h-6 px-2.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 active:scale-95"
        :class="
          selectedProviders.includes(p.key) || !selectedProviders.length
            ? ''
            : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
        "
        :style="selectedProviders.includes(p.key) || !selectedProviders.length ? providerActivePillStyle(p.key) : {}"
        @click="$emit('toggleProvider', p.key)"
      >
        {{ p.label }}
        <span
          v-if="providerCounts[p.key]"
          class="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold bg-black/10"
        >
          {{ providerCounts[p.key] }}
        </span>
        <span v-else-if="isStreaming" class="size-1.5 rounded-full bg-current animate-pulse" />
      </button>
    </div>

    <!-- Results (scrollable) -->
    <div class="flex-1 overflow-y-auto px-4 pb-4">
      <!-- Skeleton grid while loading with no results yet -->
      <div v-if="isStreaming && !filteredResults.length" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div v-for="n in 8" :key="n" class="rounded-xl border border-border/40 bg-card overflow-hidden animate-pulse flex gap-3 p-2.5">
          <div class="rounded-lg bg-muted shrink-0" :style="{ width: '64px', aspectRatio: coverAspectRatio }" />
          <div class="flex-1 flex flex-col justify-center gap-2 py-1">
            <div class="h-3 bg-muted rounded-md w-full" />
            <div class="h-2.5 bg-muted rounded-md w-3/4" />
            <div class="h-4 bg-muted rounded-md w-1/3 mt-1" />
          </div>
        </div>
      </div>

      <!-- No results -->
      <div v-else-if="!isStreaming && !filteredResults.length && hasSearched" class="py-12 flex flex-col items-center gap-3 text-muted-foreground">
        <div class="size-10 rounded-full bg-muted flex items-center justify-center">
          <BookOpen class="size-5" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium text-foreground">No results found</p>
          <p class="text-xs text-muted-foreground mt-0.5">Try adjusting the title or author</p>
        </div>
      </div>

      <!-- Instructions when no search yet -->
      <div v-else-if="!hasSearched" class="py-12 flex flex-col items-center gap-2 text-muted-foreground">
        <p class="text-sm">Search above, then click a result to start comparing metadata.</p>
      </div>

      <!-- Results grid -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
