<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from 'vue'
import { Search, BookOpen, Loader2, PencilLine } from '@lucide/vue'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey } from '@bookorbit/types'
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
  selectFieldRules: []
  select: [MetadataCandidate]
}>()

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const form = reactive({
  title: props.searchDefaults.title ?? '',
  author: props.searchDefaults.author ?? '',
  isbn: props.searchDefaults.isbn ?? '',
})
const isFormCollapsed = ref(false)

const canSearch = computed(() => !!(form.title.trim() || form.isbn.trim()))
const searchSummary = computed(() => {
  const parts = [form.title.trim(), form.author.trim(), form.isbn.trim()].filter(Boolean)
  return parts.length ? parts.join(' - ') : 'Untitled query'
})
const hasFieldRuleScope = computed(() => props.providers.some((provider) => provider.selectedByFieldRules !== undefined))
const allProviderKeys = computed(() => props.providers.map((provider) => provider.key))
const fieldRuleProviderKeys = computed(() => props.providers.filter((provider) => provider.selectedByFieldRules).map((provider) => provider.key))
const providersOutsideFieldRules = computed(() => props.providers.filter((provider) => provider.selectedByFieldRules === false))
const providersOutsideFieldRuleText = computed(() => providersOutsideFieldRules.value.map((provider) => provider.label).join(', '))
const allProvidersSelected = computed(() => sameProviderSelection(allProviderKeys.value))
const fieldRuleProvidersSelected = computed(() => sameProviderSelection(fieldRuleProviderKeys.value))
const hasFieldRuleScopeOption = computed(
  () => hasFieldRuleScope.value && providersOutsideFieldRules.value.length > 0 && fieldRuleProviderKeys.value.length > 0,
)
const customProviderSelection = computed(
  () => props.providers.length > 0 && !allProvidersSelected.value && !(hasFieldRuleScopeOption.value && fieldRuleProvidersSelected.value),
)

watch(
  () => props.hasSearched,
  (hasSearched) => {
    if (hasSearched && !props.isStreaming) {
      isFormCollapsed.value = true
    }
  },
  { immediate: true },
)

function runSearch() {
  if (!canSearch.value) return
  isFormCollapsed.value = true
  emit('search', {
    title: form.title.trim(),
    author: form.author.trim(),
    isbn: form.isbn.trim(),
  })
}

function expandSearchForm() {
  isFormCollapsed.value = false
}

function handleClearFilter() {
  emit('clearFilter')
}

function handleSelectFieldRules() {
  emit('selectFieldRules')
}

function handleToggleProvider(provider: MetadataProviderKey) {
  emit('toggleProvider', provider)
}

function handleSelectCandidate(candidate: MetadataCandidate) {
  emit('select', candidate)
}

function sameProviderSelection(keys: MetadataProviderKey[]) {
  if (!keys.length) return false
  const selected = new Set(props.selectedProviders)
  return selected.size === keys.length && keys.every((key) => selected.has(key))
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Search form card -->
    <div v-if="!isFormCollapsed" class="px-4 pt-4 pb-3 shrink-0">
      <div class="rounded-lg border border-border bg-card p-3 shadow-sm">
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_auto]">
          <div class="relative col-span-2 min-w-0 md:col-span-1">
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
            class="col-span-2 h-8 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow md:col-span-1"
            placeholder="Author"
            @keydown.enter="runSearch"
          />
          <input
            v-model="form.isbn"
            class="h-8 min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="ISBN"
            @keydown.enter="runSearch"
          />
          <button
            class="relative flex items-center justify-center gap-1.5 h-8 w-28 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all disabled:opacity-40 hover:opacity-90 active:scale-95 overflow-hidden group"
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
    <div v-else class="px-4 pt-4 pb-3 shrink-0">
      <div class="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
        <div class="flex items-center gap-2">
          <Search class="size-3.5 text-muted-foreground shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active query</p>
            <p class="text-sm font-medium text-foreground truncate">{{ searchSummary }}</p>
          </div>
          <button
            class="h-7 px-2.5 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
            @click="expandSearchForm"
          >
            <PencilLine class="size-3.5" />
            Edit
          </button>
        </div>
      </div>
    </div>

    <!-- Provider filter pills -->
    <div v-if="providers.length" class="flex items-center gap-1.5 px-4 pb-2 flex-wrap shrink-0">
      <div class="inline-flex h-6 items-stretch overflow-hidden rounded-full border border-border bg-background shadow-xs" aria-label="Search scope">
        <button
          class="h-full px-2.5 text-[11px] font-medium transition-colors"
          :class="
            allProvidersSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="handleClearFilter"
        >
          {{ hasFieldRuleScope ? 'All enabled' : 'All' }}
        </button>
        <button
          v-if="hasFieldRuleScopeOption"
          class="h-full px-2.5 text-[11px] font-medium transition-colors"
          :class="
            fieldRuleProvidersSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="handleSelectFieldRules"
        >
          Field Rules
        </button>
        <span
          v-if="customProviderSelection"
          class="h-full px-2.5 bg-primary text-primary-foreground text-[11px] font-medium shadow-sm flex items-center"
        >
          Custom
        </span>
      </div>
      <button
        v-for="p in providers"
        :key="p.key"
        class="h-6 px-2.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 active:scale-95"
        :title="p.selectedByFieldRules === false ? `${p.label} is enabled but not in Field Rules` : p.label"
        :class="selectedProviders.includes(p.key) ? '' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'"
        :style="selectedProviders.includes(p.key) ? providerActivePillStyle(p.key) : {}"
        @click="handleToggleProvider(p.key)"
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
    <div
      v-if="providersOutsideFieldRules.length"
      class="mx-4 mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground shrink-0"
    >
      <span class="font-medium text-foreground">Not in Field Rules:</span>
      {{ providersOutsideFieldRuleText }}. Included in manual search with All enabled, but not used by automatic metadata fetch.
    </div>

    <!-- Results (scrollable) -->
    <div class="flex-1 overflow-y-auto px-4 pb-4">
      <!-- Skeleton grid while loading with no results yet -->
      <div v-if="isStreaming && !filteredResults.length" class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div v-for="n in 8" :key="n" class="rounded-lg border border-border/40 bg-card overflow-hidden animate-pulse flex gap-3 p-2.5">
          <div class="rounded-lg bg-muted shrink-0" :style="{ width: '88px', aspectRatio: coverAspectRatio }" />
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
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MetadataResultCard
          v-for="(candidate, i) in filteredResults"
          :key="`${candidate.provider}-${candidate.providerId}-${i}`"
          :candidate="candidate"
          :providers="providers"
          @select="handleSelectCandidate"
        />
      </div>
    </div>
  </div>
</template>
