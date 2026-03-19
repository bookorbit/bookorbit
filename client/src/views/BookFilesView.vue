<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import BookDetailLayout from '@/features/book/components/detail/BookDetailLayout.vue'
import FilesTab from '@/features/book/components/detail/tabs/FilesTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { usePageTitle } from '@/composables/usePageTitle'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()
const pageTitle = computed(() => {
  const title = detail.value?.title?.trim()
  const base = title || (Number.isFinite(bookId.value) ? `Book #${bookId.value}` : 'Book')
  return `Files · ${base}`
})
usePageTitle(pageTitle)

watch(bookId, (id) => fetch(id), { immediate: true })
</script>

<template>
  <BookDetailLayout :book-id="bookId">
    <FilesTab v-if="detail" :book="detail" />
    <div v-else-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-16 rounded-md bg-muted animate-pulse" />
    </div>
  </BookDetailLayout>
</template>
