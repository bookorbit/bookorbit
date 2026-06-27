<script setup lang="ts">
import { computed, defineAsyncComponent, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
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
import EntityNotFound from '@/components/EntityNotFound.vue'

const ReadingLogTab = defineAsyncComponent(() => import('@/features/book/components/detail/tabs/ReadingLogTab.vue'))
const HighlightsTab = defineAsyncComponent(() => import('@/features/book/components/detail/tabs/HighlightsTab.vue'))

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
  const base = title || (Number.isFinite(bookId.value) ? `Book #${bookId.value}` : 'Book')
  if (tab.value === 'edit') return `Edit Metadata · ${base}`
  if (tab.value === 'files') return `Files · ${base}`
  if (tab.value === 'reading-log') return `Reading Log · ${base}`
  if (tab.value === 'highlights') return `Highlights · ${base}`
  return `Book · ${base}`
})
usePageTitle(pageTitle)

const { subscribeLibrary } = useScanProgress()
watch(
  () => detail.value?.libraryId,
  (id) => {
    if (id !== undefined) subscribeLibrary(id)
  },
)

const { onBookMissing, onBookRestored, onBookMoved, onBookTransferred } = useBookEvents()
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

watch(bookId, (id) => fetch(id), { immediate: true })

function onMetadataSaved(updated: BookDetail) {
  detail.value = updated
}

function onLocksChanged(lockedFields: BookMetadataLockField[]) {
  if (detail.value) detail.value.lockedFields = lockedFields
}

function onCoverChanged(source: 'extracted' | 'custom' | null) {
  if (detail.value) detail.value = { ...detail.value, coverSource: source }
}
</script>

<template>
  <BookDetailLayout :book-id="bookId">
    <Transition name="content" mode="out-in">
      <div v-if="detail" key="detail">
        <DetailsTab v-if="tab === 'details'" :book="detail" @saved="onMetadataSaved" />
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
        <div v-else-if="tab === 'reading-log'" class="space-y-4">
          <div class="h-32 rounded-lg bg-muted animate-shimmer" />
          <div class="flex gap-2">
            <div v-for="i in 4" :key="i" class="h-8 w-24 rounded-md bg-muted animate-shimmer" />
          </div>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div class="h-64 rounded-lg bg-muted animate-shimmer lg:col-span-3" />
            <div class="h-64 rounded-lg bg-muted animate-shimmer lg:col-span-2" />
          </div>
          <div class="space-y-2">
            <div v-for="i in 5" :key="i" class="h-12 rounded-md bg-muted animate-shimmer" />
          </div>
        </div>
        <div v-else-if="tab === 'highlights'" class="space-y-4">
          <div class="flex gap-2">
            <div class="h-9 flex-1 rounded-md bg-muted animate-shimmer" />
            <div v-for="i in 3" :key="i" class="h-9 w-9 rounded-full bg-muted animate-shimmer" />
          </div>
          <div class="space-y-3">
            <div v-for="i in 3" :key="i" class="h-24 rounded-lg bg-muted animate-shimmer" />
          </div>
        </div>
      </div>

      <div v-else-if="notFound" key="not-found">
        <EntityNotFound entity="Book" />
      </div>
    </Transition>
  </BookDetailLayout>
</template>
