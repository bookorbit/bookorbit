<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { BookDetail } from '@projectx/types'
import BookDetailLayout from '@/features/book/components/detail/BookDetailLayout.vue'
import EditMetadataTab from '@/features/book/components/detail/tabs/EditMetadataTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { usePageTitle } from '@/composables/usePageTitle'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()
const pageTitle = computed(() => {
  const title = detail.value?.title?.trim()
  const base = title || (Number.isFinite(bookId.value) ? `Book #${bookId.value}` : 'Book')
  return `Edit · ${base}`
})
usePageTitle(pageTitle)

watch(bookId, (id) => fetch(id), { immediate: true })

function onMetadataSaved(updated: BookDetail) {
  detail.value = updated
}

function onCoverChanged(source: 'extracted' | 'custom' | null) {
  if (detail.value) detail.value = { ...detail.value, coverSource: source }
}
</script>

<template>
  <BookDetailLayout :book-id="bookId">
    <EditMetadataTab v-if="detail" :book="detail" @saved="onMetadataSaved" @cover-changed="onCoverChanged" />
    <div v-else-if="loading" class="max-w-2xl space-y-4">
      <div class="h-9 rounded-md bg-muted animate-pulse" />
      <div class="h-9 rounded-md bg-muted animate-pulse" />
      <div class="h-9 rounded-md bg-muted animate-pulse" />
    </div>
  </BookDetailLayout>
</template>
