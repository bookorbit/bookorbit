<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { BookDetail, BookMetadataLockField } from '@bookorbit/types'
import BookDetailLayout from '@/features/book/components/detail/BookDetailLayout.vue'
import DetailsTab from '@/features/book/components/detail/tabs/DetailsTab.vue'
import FilesTab from '@/features/book/components/detail/tabs/FilesTab.vue'
import EditMetadataTab from '@/features/book/components/detail/tabs/EditMetadataTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { usePageTitle } from '@/composables/usePageTitle'
import { normalizeBookDetailTab } from '@/features/book/lib/book-detail-tabs'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useCoverTint } from '@/features/book/composables/useCoverTint'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import EntityNotFound from '@/components/EntityNotFound.vue'

const loadReadingLogTab = () => import('@/features/book/components/detail/tabs/ReadingLogTab.vue')
const loadHighlightsTab = () => import('@/features/book/components/detail/tabs/HighlightsTab.vue')
const ReadingLogTab = defineAsyncComponent(loadReadingLogTab)
const HighlightsTab = defineAsyncComponent(loadHighlightsTab)

const KEPT_ALIVE_TABS = ['ReadingLogTab', 'HighlightsTab']

const { t } = useI18n()
const route = useRoute()
const { hasPermission } = usePermissions()
const { libraries } = useLibraries()

provide(
  COVER_ASPECT_RATIO_KEY,
  computed(() => {
    const libraryId = detail.value?.libraryId
    const library = libraryId != null ? libraries.value.find((l) => l.id === libraryId) : null
    return library?.coverAspectRatio ?? DEFAULT_COVER_ASPECT_RATIO
  }),
)

const bookId = computed(() => Number(route.params.bookId))
const tab = computed(() => normalizeBookDetailTab(route.query.tab))

const { detail, loading, notFound, fetch } = useBookDetail()
const pageTitle = computed(() => {
  const title = detail.value?.title?.trim()
  const base = title || (Number.isFinite(bookId.value) ? t('views.bookDetail.titleWithId', { id: bookId.value }) : t('views.bookDetail.title'))
  if (tab.value === 'edit') return t('views.bookDetail.pageTitle.editMetadata', { base })
  if (tab.value === 'files') return t('views.bookDetail.pageTitle.files', { base })
  if (tab.value === 'reading-log') return t('views.bookDetail.pageTitle.readingLog', { base })
  if (tab.value === 'highlights') return t('views.bookDetail.pageTitle.highlights', { base })
  return t('views.bookDetail.pageTitle.book', { base })
})
usePageTitle(pageTitle)

// Only the details tab shows the artwork the tint is derived from; behind forms
// and tables the same colour reads as noise.
const { coverUrl } = useCoverVersions()
const { bookDetailCoverTint } = useDisplaySettings()
const tintSource = computed(() => {
  const book = detail.value
  if (bookDetailCoverTint.value === 'off' || tab.value !== 'details' || !book || book.coverSource === null) return null
  return coverUrl(book.id, 'cover', book.updatedAt ?? book.addedAt)
})
const { tint } = useCoverTint(tintSource)
const coverTint = computed(() => {
  if (!tint.value) return null
  if (bookDetailCoverTint.value === 'single') return { ...tint.value, secondary: null }
  return tint.value
})

const { subscribeLibrary } = useScanProgress()
watch(
  () => detail.value?.libraryId,
  (id) => {
    if (id !== undefined) subscribeLibrary(id)
  },
)

const { onBookMissing, onBookRestored, onBookMoved, onBookTransferred, onBookProgressChanged } = useBookEvents()
onBookMissing((bookIds) => {
  if (detail.value && bookIds.includes(detail.value.id)) {
    detail.value = { ...detail.value, status: 'missing' }
  }
})
onBookRestored((bookIds) => {
  if (detail.value && bookIds.includes(detail.value.id)) fetch(detail.value.id)
})
onBookMoved((bookIds) => {
  if (detail.value && bookIds.includes(detail.value.id)) fetch(detail.value.id)
})
onBookTransferred((event) => {
  if (detail.value && event.bookIds.includes(detail.value.id)) fetch(detail.value.id)
})
onBookProgressChanged((event) => {
  if (event.bookId === bookId.value) fetch(event.bookId)
})

watch(bookId, (id) => fetch(id), { immediate: true })

// The two lazy tabs render nothing at all while their chunk arrives, so a cold click on either
// blanks the pane. Warm both once the page is idle and the first click has a component to mount.
onMounted(() => {
  const warm = () => {
    void loadReadingLogTab()
    void loadHighlightsTab()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 2000 })
  else setTimeout(warm, 500)
})

function onMetadataSaved(updated: BookDetail) {
  detail.value = updated
}

// A moved book keeps its id but changes library, so refetch to show the new one.
// Named apart from the onBookMoved socket subscription above.
function handleMovedToLibrary() {
  void fetch(bookId.value)
}

function onLocksChanged(lockedFields: BookMetadataLockField[]) {
  if (detail.value) detail.value.lockedFields = lockedFields
}

function onCoverChanged(source: 'extracted' | 'custom' | null) {
  if (detail.value) detail.value = { ...detail.value, coverSource: source }
}
</script>

<template>
  <BookDetailLayout :book-id="bookId" :cover-tint="coverTint">
    <Transition name="content" mode="out-in">
      <div v-if="detail" key="detail" class="@container/book-detail h-full">
        <!--
          Only the two lazy tabs are cached. Both fetch on mount, so without this every return
          replays blank -> skeleton -> content in under 120ms, which reads as a flash rather than
          as loading. They revalidate silently on activation instead.
        -->
        <KeepAlive :include="KEPT_ALIVE_TABS">
          <DetailsTab v-if="tab === 'details'" :book="detail" @saved="onMetadataSaved" @moved="handleMovedToLibrary" />
          <EditMetadataTab
            v-else-if="tab === 'edit' && hasPermission('library_edit_metadata')"
            :book="detail"
            @saved="onMetadataSaved"
            @locks-changed="onLocksChanged"
            @cover-changed="onCoverChanged"
          />
          <FilesTab v-else-if="tab === 'files'" :book="detail" @refetch="fetch(detail.id)" />
          <ReadingLogTab v-else-if="tab === 'reading-log'" :book="detail" @saved="onMetadataSaved" />
          <HighlightsTab v-else-if="tab === 'highlights'" :book="detail" />
        </KeepAlive>
      </div>

      <div v-else-if="loading" key="loading">
        <div v-if="tab === 'details'" class="flex flex-col md:flex-row gap-8">
          <div class="md:w-56 shrink-0">
            <div class="w-full rounded-sm bg-muted animate-shimmer" style="aspect-ratio: 2/3" />
            <div class="mt-4 space-y-2">
              <div class="h-9 rounded-md bg-muted animate-shimmer" />
              <div class="h-9 rounded-md bg-muted animate-shimmer" />
            </div>
          </div>
          <div class="flex-1 space-y-3">
            <div class="h-7 w-3/4 rounded bg-muted animate-shimmer" />
            <div class="h-4 w-1/2 rounded bg-muted animate-shimmer" />
            <div class="h-4 w-1/3 rounded bg-muted animate-shimmer" />
            <div class="flex gap-1.5 mt-4">
              <div class="h-5 w-12 rounded bg-muted animate-shimmer" />
              <div class="h-5 w-16 rounded bg-muted animate-shimmer" />
              <div class="h-5 w-10 rounded bg-muted animate-shimmer" />
            </div>
            <div class="h-32 w-full rounded bg-muted animate-shimmer mt-4" />
          </div>
        </div>
        <div v-else-if="tab === 'edit'" class="max-w-2xl space-y-4">
          <div class="h-9 rounded-md bg-muted animate-shimmer" />
          <div class="h-9 rounded-md bg-muted animate-shimmer" />
          <div class="h-9 rounded-md bg-muted animate-shimmer" />
        </div>
        <div v-else-if="tab === 'files'" class="space-y-3">
          <div v-for="i in 3" :key="i" class="h-16 rounded-md bg-muted animate-shimmer" />
        </div>
        <!--
          These two match the box the tab itself puts up while its own first load runs, so the
          handover from "book loading" to "tab loading" changes the fill and never the layout.
        -->
        <div
          v-else-if="tab === 'reading-log'"
          class="flex h-full min-h-0 flex-col gap-4 xl:grid xl:grid-cols-[17rem_minmax(0,1fr)_19.25rem] xl:grid-rows-[minmax(0,1fr)_13.5rem] xl:gap-x-5 xl:gap-y-4"
        >
          <div class="h-64 rounded-xl bg-muted animate-shimmer xl:col-start-1 xl:row-start-1 xl:row-span-2 xl:h-auto" />
          <div class="min-h-80 rounded-xl bg-muted animate-shimmer xl:col-start-2 xl:col-span-2 xl:row-start-1 xl:row-span-2 xl:min-h-0" />
        </div>
        <div v-else-if="tab === 'highlights'" class="flex h-full min-h-0 flex-col">
          <div class="min-h-80 flex-1 rounded-xl bg-muted animate-shimmer xl:min-h-0" />
        </div>
      </div>

      <div v-else-if="notFound" key="not-found">
        <EntityNotFound :entity="t('views.entity.book')" />
      </div>
    </Transition>
  </BookDetailLayout>
</template>
