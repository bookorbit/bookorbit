<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { X, Sparkles, ChevronRight } from 'lucide-vue-next'
import type { BookDetail, MetadataCandidate, MetadataSource } from '@projectx/types'
import { useMetadataSearch } from '../../../composables/useMetadataSearch'
import { useCoverVersions } from '../../../composables/useCoverVersions'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import MetadataSearchPanel from './MetadataSearchPanel.vue'
import MetadataDiffPanel from './MetadataDiffPanel.vue'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{
  close: []
  apply: [{ formPatch: MetadataPatch; coverUrl?: string }]
}>()

const { coverUrl } = useCoverVersions()
const bookCoverUrl = computed(() => coverUrl(props.book.id, 'cover'))
const searchDefaults = computed(() => ({
  title: props.book.title ?? undefined,
  author: props.book.authors[0]?.name ?? undefined,
  isbn: props.book.isbn13 ?? props.book.isbn10 ?? undefined,
}))

const currentSource = computed<MetadataSource>(() => ({
  title: props.book.title,
  subtitle: props.book.subtitle,
  description: props.book.description,
  publisher: props.book.publisher,
  publishedYear: props.book.publishedYear,
  language: props.book.language,
  pageCount: props.book.pageCount,
  seriesName: props.book.seriesName,
  seriesIndex: props.book.seriesIndex,
  isbn10: props.book.isbn10,
  isbn13: props.book.isbn13,
  authors: props.book.authors.map((a) => a.name),
  genres: props.book.genres,
}))
const {
  filteredResults,
  providerCounts,
  isStreaming,
  hasSearched,
  providers,
  selectedProviders,
  loadProviders,
  search,
  toggleProvider,
  clearProviderFilter,
} = useMetadataSearch()

const view = ref<'search' | 'diff'>('search')
const selectedCandidate = ref<MetadataCandidate | null>(null)
const currentProviderId = computed(() => (selectedCandidate.value ? (props.book.providerIds[selectedCandidate.value.provider] ?? null) : null))

onMounted(() => {
  loadProviders()
})

function handleSearch(params: { title: string; author: string; isbn: string }) {
  search({ ...params, bookId: props.book.id })
}

function selectCandidate(candidate: MetadataCandidate) {
  selectedCandidate.value = candidate
  view.value = 'diff'
}

function backToSearch() {
  view.value = 'search'
  selectedCandidate.value = null
}

function handleApply(patch: { formPatch: MetadataPatch; coverUrl?: string }) {
  emit('apply', patch)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex">
      <!-- Backdrop: hidden on mobile since the panel is full-screen there -->
      <div class="hidden sm:block flex-1 bg-black/50 backdrop-blur-sm" @click="$emit('close')" />

      <!-- Drawer panel: full-screen on mobile, right-side panel on sm+ -->
      <div class="relative flex flex-col w-full sm:w-3/4 sm:max-w-4xl h-full bg-background sm:border-l border-border shadow-2xl overflow-hidden">
        <!-- Gradient accent strip -->
        <div class="h-px w-full bg-linear-to-r from-transparent via-primary to-transparent shrink-0 opacity-60" />

        <!-- Ambient glow behind title -->
        <div class="absolute top-0 right-0 w-64 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

        <!-- Close button -->
        <button
          class="absolute top-3 right-3 z-10 size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all hover:scale-110"
          @click="$emit('close')"
        >
          <X class="size-4" />
        </button>

        <!-- Title bar -->
        <div class="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0 pr-12">
          <div class="size-7 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/20 shrink-0">
            <Sparkles class="size-3.5 text-primary" />
          </div>
          <p class="text-sm font-semibold shrink-0">Search Metadata</p>
          <ChevronRight class="size-3.5 text-border shrink-0 hidden sm:block" />
          <p class="text-xs text-muted-foreground truncate hidden sm:block">{{ book.title }}</p>

          <!-- Step indicator -->
          <div class="ml-auto flex items-center gap-1 shrink-0">
            <div class="h-1.5 w-6 rounded-full transition-all duration-300" :class="view === 'search' ? 'bg-primary' : 'bg-border'" />
            <div class="h-1.5 w-6 rounded-full transition-all duration-300" :class="view === 'diff' ? 'bg-primary' : 'bg-border'" />
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 min-h-0">
          <MetadataSearchPanel
            v-if="view === 'search'"
            :search-defaults="searchDefaults"
            :providers="providers"
            :filtered-results="filteredResults"
            :provider-counts="providerCounts"
            :selected-providers="selectedProviders"
            :is-streaming="isStreaming"
            :has-searched="hasSearched"
            @search="handleSearch"
            @toggle-provider="toggleProvider"
            @clear-filter="clearProviderFilter"
            @select="selectCandidate"
          />

          <MetadataDiffPanel
            v-else-if="view === 'diff' && selectedCandidate"
            :current="currentSource"
            :candidate="selectedCandidate"
            :providers="providers"
            :current-cover-url="bookCoverUrl"
            :current-provider-id="currentProviderId"
            @back="backToSearch"
            @apply="handleApply"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
