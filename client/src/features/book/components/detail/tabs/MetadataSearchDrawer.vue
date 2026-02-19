<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { BookDetail, MetadataCandidate } from '@projectx/types'
import { useMetadataSearch } from '../../../composables/useMetadataSearch'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import MetadataSearchPanel from './MetadataSearchPanel.vue'
import MetadataDiffPanel from './MetadataDiffPanel.vue'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{
  close: []
  apply: [{ formPatch: MetadataPatch; coverUrl?: string }]
}>()

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
      <!-- Backdrop -->
      <div class="flex-1 bg-black/40 backdrop-blur-sm" @click="$emit('close')" />

      <!-- Drawer panel -->
      <div class="relative flex flex-col w-3/4 max-w-4xl h-full bg-background border-l border-border shadow-2xl">
        <!-- Close -->
        <button
          class="absolute top-3 right-3 z-10 size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="$emit('close')"
        >
          <X class="size-4" />
        </button>

        <!-- Title bar -->
        <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 pr-12">
          <p class="text-sm font-semibold">Search Metadata</p>
          <p class="text-xs text-muted-foreground truncate">{{ book.title }}</p>
        </div>

        <!-- Content -->
        <div class="flex-1 min-h-0">
          <MetadataSearchPanel
            v-if="view === 'search'"
            :book="book"
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
            :book="book"
            :candidate="selectedCandidate"
            :providers="providers"
            @back="backToSearch"
            @apply="handleApply"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
