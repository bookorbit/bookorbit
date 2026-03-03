<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { BookDetail } from '@projectx/types'
import { SidebarInset } from '@/components/ui/sidebar'
import AppHeader from '@/components/AppHeader.vue'
import BookDetailTabs from '@/features/book/components/detail/BookDetailTabs.vue'
import EditMetadataTab from '@/features/book/components/detail/tabs/EditMetadataTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'

const route = useRoute()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()

watch(bookId, (id) => fetch(id), { immediate: true })

const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')

function onMetadataSaved(updated: BookDetail) {
  detail.value = updated
}

function onCoverChanged(source: 'extracted' | 'custom' | null) {
  if (detail.value) detail.value = { ...detail.value, coverSource: source }
}
</script>

<template>
  <SidebarInset class="flex flex-col min-h-screen overflow-x-hidden">
      <AppHeader />
      <div class="flex items-center border-b shrink-0 h-11">
        <BookDetailTabs :book-id="bookId" />
      </div>

      <main class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6" :class="backgroundClass">
        <EditMetadataTab v-if="detail" :book="detail" @saved="onMetadataSaved" @cover-changed="onCoverChanged" />
        <div v-else-if="loading" class="max-w-2xl space-y-4">
          <div class="h-9 rounded-md bg-muted animate-pulse" />
          <div class="h-9 rounded-md bg-muted animate-pulse" />
          <div class="h-9 rounded-md bg-muted animate-pulse" />
        </div>
      </main>
  </SidebarInset>
</template>
