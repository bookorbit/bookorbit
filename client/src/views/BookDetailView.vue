<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import BookDetailLayout from '@/features/book/components/detail/BookDetailLayout.vue'
import DetailsTab from '@/features/book/components/detail/tabs/DetailsTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { usePageTitle } from '@/composables/usePageTitle'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()
const pageTitle = computed(() => {
  const title = detail.value?.title?.trim()
  if (title) return `Book · ${title}`
  return Number.isFinite(bookId.value) ? `Book #${bookId.value}` : 'Book'
})
usePageTitle(pageTitle)

const { subscribeLibrary } = useScanProgress()
watch(
  () => detail.value?.libraryId,
  (id) => {
    if (id !== undefined) subscribeLibrary(id)
  },
)

const { onBookMissing, onBookRestored, onBookMoved } = useBookEvents()
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

watch(bookId, (id) => fetch(id), { immediate: true })
</script>

<template>
  <BookDetailLayout :book-id="bookId">
    <DetailsTab v-if="detail" :book="detail" />

    <template v-else-if="loading">
      <div class="flex flex-col md:flex-row gap-8">
        <div class="md:w-56 shrink-0">
          <div class="w-full rounded-sm bg-muted animate-pulse" style="aspect-ratio: 2/3" />
          <div class="mt-4 space-y-2">
            <div class="h-9 rounded-md bg-muted animate-pulse" />
            <div class="h-9 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
        <div class="flex-1 space-y-3">
          <div class="h-7 w-3/4 rounded bg-muted animate-pulse" />
          <div class="h-4 w-1/2 rounded bg-muted animate-pulse" />
          <div class="h-4 w-1/3 rounded bg-muted animate-pulse" />
          <div class="flex gap-1.5 mt-4">
            <div class="h-5 w-12 rounded bg-muted animate-pulse" />
            <div class="h-5 w-16 rounded bg-muted animate-pulse" />
            <div class="h-5 w-10 rounded bg-muted animate-pulse" />
          </div>
          <div class="h-32 w-full rounded bg-muted animate-pulse mt-4" />
        </div>
      </div>
    </template>
  </BookDetailLayout>
</template>
