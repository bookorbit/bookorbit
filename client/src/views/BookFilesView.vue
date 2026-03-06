<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import BookDetailHeader from '@/features/book/components/detail/BookDetailHeader.vue'
import FilesTab from '@/features/book/components/detail/tabs/FilesTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()

watch(bookId, (id) => fetch(id), { immediate: true })
</script>

<template>
  <BookDetailHeader :book-id="bookId" />

  <main class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
    <FilesTab v-if="detail" :book="detail" />
    <div v-else-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-16 rounded-md bg-muted animate-pulse" />
    </div>
  </main>
</template>
