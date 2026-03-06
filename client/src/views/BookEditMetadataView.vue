<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { BookDetail } from '@projectx/types'
import BookDetailTabs from '@/features/book/components/detail/BookDetailTabs.vue'
import EditMetadataTab from '@/features/book/components/detail/tabs/EditMetadataTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()

watch(bookId, (id) => fetch(id), { immediate: true })

function onMetadataSaved(updated: BookDetail) {
  detail.value = updated
}

function onCoverChanged(source: 'extracted' | 'custom' | null) {
  if (detail.value) detail.value = { ...detail.value, coverSource: source }
}
</script>

<template>
  <div class="flex items-stretch border-b shrink-0 h-11 px-3">
    <BookDetailTabs :book-id="bookId" />
  </div>

  <main class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
    <EditMetadataTab v-if="detail" :book="detail" @saved="onMetadataSaved" @cover-changed="onCoverChanged" />
    <div v-else-if="loading" class="max-w-2xl space-y-4">
      <div class="h-9 rounded-md bg-muted animate-pulse" />
      <div class="h-9 rounded-md bg-muted animate-pulse" />
      <div class="h-9 rounded-md bg-muted animate-pulse" />
    </div>
  </main>
</template>
