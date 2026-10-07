<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal, X } from '@lucide/vue'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getBookMediaProfile } from '@bookorbit/types'
import type { BookDetail, BookMetadataLockField, CoverMedium, MetadataProviderKey, MetadataSource } from '@bookorbit/types'
import { useMetadataSearch } from '../../../composables/useMetadataSearch'
import { useMetadataSearchPreferences } from '../../../composables/useMetadataSearchPreferences'
import { useCoverVersions } from '../../../composables/useCoverVersions'
import type { MetadataDiffApply } from '../../../composables/useMetadataDiff'
import type { SecondCoverInput } from '../../../composables/useSecondCoverRow'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import { coverFieldMedium, coverTileState, otherMedium } from '../../../lib/cover-slots'
import MetadataMatchWorkspace from '../../metadata-match/MetadataMatchWorkspace.vue'
import MetadataMatchShortcuts from '../../metadata-match/MetadataMatchShortcuts.vue'
import type { MetadataQuery } from '../../metadata-match/MetadataMatchQuery.vue'

const props = defineProps<{ book: BookDetail; lockedFields: BookMetadataLockField[] }>()
const emit = defineEmits<{
  close: []
  apply: [MetadataDiffApply]
}>()

const { t } = useI18n()
const optionsId = useId()
const { autoSearchOnOpen } = useMetadataSearchPreferences()
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
  isbn: props.book.isbn13?.trim() || props.book.isbn10?.trim() || undefined,
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
  retryingProviders,
  isStreaming,
  hasSearched,
  providers,
  selectedProviders,
  resultProviderOrder,
  loadProviders,
  search,
  retryProvider,
  toggleProvider,
  selectFieldRuleProviders,
  clearProviderFilter,
  coverProviderOrder,
  audioCoverProviderOrder,
} = useMetadataSearch()
const secondSearch = useMetadataSearch()
const { results: secondResults, isStreaming: secondSearching } = secondSearch

const secondCoverPriority = computed(() => (secondCoverMedium.value === 'audio' ? audioCoverProviderOrder.value : coverProviderOrder.value))
const mainCoverPriority = computed(() => (mainCoverMedium.value === 'audio' ? audioCoverProviderOrder.value : coverProviderOrder.value))
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

const subtitle = computed(() =>
  [
    props.book.title,
    props.book.authors.map((author) => author.name).join(', '),
    t(isAudiobookSearch.value ? 'book.detail.editMetadata.match.mediumAudiobook' : 'book.detail.editMetadata.match.mediumEbook'),
  ]
    .filter(Boolean)
    .join(' \u00b7 '),
)

let active = true
onBeforeUnmount(() => {
  active = false
})

onMounted(async () => {
  const shouldSearchOnOpen = autoSearchOnOpen.value
  await loadProviders(props.book.id)
  const defaults = searchDefaults.value
  if (active && shouldSearchOnOpen && (defaults.title || defaults.isbn))
    runMetadataSearch({ title: defaults.title ?? '', author: defaults.author ?? '', isbn: defaults.isbn ?? '' })
})

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function runMetadataSearch(params: MetadataQuery) {
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

function handleToggleProvider(provider: MetadataProviderKey) {
  toggleProvider(provider)
}

function handleSelectAll() {
  clearProviderFilter()
}

function handleSelectFieldRules() {
  selectFieldRuleProviders()
}

function handleRetry(provider: MetadataProviderKey) {
  void retryProvider(provider)
}

function handleApply(patch: MetadataDiffApply) {
  emit('apply', patch)
  emit('close')
}

function handleCancel() {
  emit('close')
}
</script>

<template>
  <Sheet :open="true" @update:open="handleOpenChange">
    <SheetContent
      side="right"
      hide-close
      class="w-full gap-0 overflow-hidden border-border p-0 shadow-2xl sm:w-[min(100vw-3rem,88rem)] sm:max-w-none"
    >
      <div class="h-px w-full shrink-0 bg-linear-to-r from-transparent via-primary to-transparent opacity-60" />
      <header class="flex min-h-[3.625rem] shrink-0 items-center gap-3 border-b border-border py-2 ps-4 pe-3 sm:ps-[1.125rem]">
        <span
          class="w-7 shrink-0 overflow-hidden rounded-[4px] bg-muted ring-1 ring-border"
          :style="{ aspectRatio: mainCoverMedium === 'audio' ? '1/1' : '2/3' }"
        >
          <img v-if="mainCoverUrl" :src="mainCoverUrl" alt="" class="size-full object-cover" />
        </span>
        <div class="min-w-0 flex-1">
          <SheetTitle class="text-sm font-semibold">{{ t('book.detail.editMetadata.searchDrawer.searchTitle') }}</SheetTitle>
          <SheetDescription class="text-xs leading-snug [overflow-wrap:anywhere] text-muted-foreground">{{ subtitle }}</SheetDescription>
        </div>
        <MetadataMatchShortcuts />
        <SheetClose
          class="grid size-8 place-items-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('common.close')"
        >
          <X class="size-4" aria-hidden="true" />
        </SheetClose>
      </header>

      <MetadataMatchWorkspace
        class="min-h-0 flex-1"
        :current="currentSource"
        :provider-ids="book.providerIds"
        :locked-fields="lockedFields"
        :current-cover-url="mainCoverUrl"
        :cover-medium="mainCoverMedium"
        :cover-priority="mainCoverPriority"
        :second-cover="secondCover"
        :search-defaults="searchDefaults"
        :providers="providers"
        :results="filteredResults"
        :provider-counts="providerCounts"
        :selected-providers="selectedProviders"
        :interrupted-providers="interruptedProviders"
        :retrying-providers="retryingProviders"
        :provider-order="resultProviderOrder"
        :is-streaming="isStreaming"
        :has-searched="hasSearched"
        @search="runMetadataSearch"
        @toggle-provider="handleToggleProvider"
        @select-all="handleSelectAll"
        @select-field-rules="handleSelectFieldRules"
        @retry-provider="handleRetry"
        @apply="handleApply"
        @cancel="handleCancel"
      >
        <template #search-options>
          <Popover>
            <PopoverTrigger as-child>
              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('book.detail.editMetadata.searchDrawer.searchOptions')"
              >
                <SlidersHorizontal class="size-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              class="w-72 max-w-[calc(100vw-2rem)] p-3"
              :aria-label="t('book.detail.editMetadata.searchDrawer.searchOptions')"
            >
              <label class="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input
                  v-model="autoSearchOnOpen"
                  type="checkbox"
                  class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-describedby="`${optionsId}-hint`"
                />
                {{ t('book.detail.editMetadata.searchDrawer.autoSearchOnOpen') }}
              </label>
              <p :id="`${optionsId}-hint`" class="mt-2 text-xs text-muted-foreground">
                {{ t('book.detail.editMetadata.searchDrawer.autoSearchOnOpenHint') }}
              </p>
            </PopoverContent>
          </Popover>
        </template>
      </MetadataMatchWorkspace>
    </SheetContent>
  </Sheet>
</template>
