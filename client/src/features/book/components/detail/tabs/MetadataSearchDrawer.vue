<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Sparkles } from '@lucide/vue'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { getBookMediaProfile } from '@bookorbit/types'
import type { BookDetail, BookMetadataLockField, CoverMedium, MetadataCandidate, MetadataProviderKey, MetadataSource } from '@bookorbit/types'
import { useMetadataSearch } from '../../../composables/useMetadataSearch'
import { useCoverVersions } from '../../../composables/useCoverVersions'
import type { MetadataDiffApply } from '../../../composables/useMetadataDiff'
import type { SecondCoverInput } from '../../../composables/useSecondCoverRow'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import { coverFieldMedium, coverTileState, otherMedium } from '../../../lib/cover-slots'
import MetadataSearchPanel from './MetadataSearchPanel.vue'
import MetadataDiffPanel from './MetadataDiffPanel.vue'
import MangabakaVolumeBrowser from '../mangabaka/MangabakaVolumeBrowser.vue'

const props = defineProps<{ book: BookDetail; lockedFields: BookMetadataLockField[] }>()
const emit = defineEmits<{
  close: []
  apply: [MetadataDiffApply]
}>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()
const libraryAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const isAudiobookSearch = computed(() => getBookMediaProfile(props.book.files).primaryMediaKind === 'audiobook')

/** The slot the main results fill: the medium the book is searched as, if the book has it. */
const mainCoverMedium = computed<CoverMedium>(() => {
  const searched: CoverMedium = isAudiobookSearch.value ? 'audio' : 'ebook'
  return props.book.coverMedia.includes(searched) ? searched : (coverFieldMedium(props.book) ?? searched)
})
/** A book with both media also gets the other medium's cover row, from a search run as that medium. */
const secondCoverMedium = computed<CoverMedium | null>(() => {
  const other = otherMedium(mainCoverMedium.value)
  return props.book.coverMedia.includes(other) ? other : null
})

/** An empty slot has no current cover, rather than the other slot's image the server would fall back to. */
function slotCoverUrl(medium: CoverMedium): string {
  const state = coverTileState(props.book, medium, libraryAspectRatio.value)
  return state.hasImage ? coverUrl(props.book.id, 'cover', state.version, medium) : ''
}
const mainCoverUrl = computed(() => slotCoverUrl(mainCoverMedium.value))
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
  publishedDate: props.book.publishedDate,
  publishedYear: props.book.publishedYear,
  language: props.book.language,
  pageCount: props.book.pageCount,
  communityRatings: props.book.communityRatings,
  seriesName: props.book.seriesName,
  seriesIndex: props.book.seriesIndex,
  isbn10: props.book.isbn10,
  isbn13: props.book.isbn13,
  authors: props.book.authors.map((a) => a.name),
  genres: props.book.genres,
  narrators: props.book.audioMetadata?.narrators.map((n) => n.name) ?? [],
  durationSeconds: props.book.audioMetadata?.durationSeconds ?? null,
  abridged: props.book.audioMetadata?.abridged ?? null,
  hardcoverEditionId: props.book.hardcoverEditionId,
}))

const {
  filteredResults,
  providerCounts,
  interruptedProviders,
  isStreaming,
  hasSearched,
  providers,
  selectedProviders,
  loadProviders,
  search,
  toggleProvider,
  selectFieldRuleProviders,
  clearProviderFilter,
  coverProviderOrder,
  audioCoverProviderOrder,
} = useMetadataSearch()
const secondSearch = useMetadataSearch()
const { results: secondResults, isStreaming: secondSearching } = secondSearch

const secondCover = computed<SecondCoverInput | null>(() => {
  const medium = secondCoverMedium.value
  if (!medium) return null
  return {
    medium,
    candidates: secondResults.value,
    priority: secondCoverPriority.value,
    currentUrl: slotCoverUrl(medium),
    searching: secondSearching.value,
  }
})
const secondCoverPriority = computed(() => (secondCoverMedium.value === 'audio' ? audioCoverProviderOrder.value : coverProviderOrder.value))

const view = ref<'search' | 'diff'>('search')
const selectedCandidate = ref<MetadataCandidate | null>(null)
const lastSearchTitle = ref<string | undefined>(undefined)
const drawerTitle = computed(() =>
  view.value === 'search' ? t('book.detail.editMetadata.searchDrawer.searchTitle') : t('book.detail.editMetadata.searchDrawer.compareTitle'),
)
const drawerSubtitle = computed(() =>
  view.value === 'search' ? t('book.detail.editMetadata.searchDrawer.searchSubtitle') : t('book.detail.editMetadata.searchDrawer.compareSubtitle'),
)

onMounted(() => {
  loadProviders(props.book.id)
})

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function runMetadataSearch(params: { title: string; author: string; isbn: string }) {
  search({ ...params, bookId: props.book.id, isAudiobook: isAudiobookSearch.value })
  const medium = secondCoverMedium.value
  if (!medium) return
  // The ISBN names the main medium's edition; Hardcover would pin it and iTunes would answer with it.
  void secondSearch.search({
    title: params.title,
    author: params.author,
    bookId: props.book.id,
    mediaKind: medium === 'audio' ? 'audiobook' : 'ebook',
    ...(secondCoverPriority.value.length ? { providers: secondCoverPriority.value } : {}),
  })
}

function handleSearch(params: { title: string; author: string; isbn: string }) {
  selectedCandidate.value = null
  view.value = 'search'
  lastSearchTitle.value = params.title
  runMetadataSearch(params)
}

function handleToggleProvider(provider: MetadataProviderKey) {
  toggleProvider(provider)
}

function handleClearProviderFilter() {
  clearProviderFilter()
}

function handleSelectFieldRules() {
  selectFieldRuleProviders()
}

function handleSelect(candidate: MetadataCandidate) {
  selectedCandidate.value = candidate
  view.value = 'diff'
}

function backToSearch() {
  view.value = 'search'
}

function handleApply(patch: MetadataDiffApply) {
  emit('apply', patch)
  emit('close')
}
</script>

<template>
  <Sheet :open="true" @update:open="handleOpenChange">
    <SheetContent side="right" hide-close class="w-full gap-0 overflow-hidden border-border p-0 shadow-2xl sm:w-3/4 sm:max-w-5xl">
      <!-- Gradient accent strip -->
      <div class="h-px w-full bg-linear-to-r from-transparent via-primary to-transparent shrink-0 opacity-60" />

      <!-- Ambient glow -->
      <div class="absolute top-0 right-0 w-64 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <SheetClose
        class="absolute top-3 right-3 z-10 size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('common.close')"
      >
        <X class="size-4" aria-hidden="true" />
      </SheetClose>

      <!-- Title bar -->
      <div class="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0 pr-12">
        <div class="size-7 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/20 shrink-0">
          <Sparkles class="size-3.5 text-primary" aria-hidden="true" />
        </div>
        <div class="min-w-0">
          <SheetTitle class="text-sm font-semibold">{{ drawerTitle }}</SheetTitle>
          <SheetDescription class="text-xs text-muted-foreground line-clamp-1">{{ drawerSubtitle }}</SheetDescription>
        </div>

        <!-- Step indicator -->
        <div class="ml-auto flex items-center gap-1 shrink-0">
          <div class="h-1.5 w-6 rounded-full transition-all duration-300" :class="view === 'search' ? 'bg-primary' : 'bg-border'" />
          <div class="h-1.5 w-6 rounded-full transition-all duration-300" :class="view === 'diff' ? 'bg-primary' : 'bg-border'" />
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-h-0 relative">
        <MetadataSearchPanel
          v-if="view === 'search'"
          :search-defaults="searchDefaults"
          :providers="providers"
          :filtered-results="filteredResults"
          :provider-counts="providerCounts"
          :selected-providers="selectedProviders"
          :is-streaming="isStreaming"
          :has-searched="hasSearched"
          :interrupted-providers="interruptedProviders"
          @search="handleSearch"
          @toggle-provider="handleToggleProvider"
          @clear-filter="handleClearProviderFilter"
          @select-field-rules="handleSelectFieldRules"
          @select="handleSelect"
        >
          <template #results-extra>
            <MangabakaVolumeBrowser :candidates="filteredResults" :query-title="lastSearchTitle" @select="handleSelect" />
          </template>
        </MetadataSearchPanel>

        <MetadataDiffPanel
          v-else-if="view === 'diff' && selectedCandidate"
          :current="currentSource"
          :candidates="filteredResults"
          :initial-candidate="selectedCandidate"
          :providers="providers"
          :current-cover-url="mainCoverUrl"
          :cover-medium="mainCoverMedium"
          :second-cover="secondCover"
          :provider-ids="book.providerIds"
          :locked-fields="props.lockedFields"
          :filtered-results="filteredResults"
          :back-label="t('book.detail.editMetadata.diffPanel.results')"
          @back="backToSearch"
          @apply="handleApply"
        />
      </div>
    </SheetContent>
  </Sheet>
</template>
