<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import BookDetailHeader from '@/features/book/components/detail/BookDetailHeader.vue'
import BookDetailTabs from '@/features/book/components/detail/BookDetailTabs.vue'
import FilesTab from '@/features/book/components/detail/tabs/FilesTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'

const route = useRoute()
const router = useRouter()

const bookId = computed(() => Number(route.params.bookId))

const { detail, loading, fetch } = useBookDetail()
const { libraries, fetchLibraries } = useLibraries()

watch(bookId, (id) => fetch(id), { immediate: true })
fetchLibraries()

const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')

const libraryName = computed(() => libraries.value.find((l) => l.id === detail.value?.libraryId)?.name ?? 'Library')

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    const libId = detail.value?.libraryId
    router.push(libId ? { name: 'library', params: { id: libId } } : { name: 'home' })
  }
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="flex flex-col min-h-screen overflow-x-hidden">
      <AppHeader />
      <div class="flex items-center border-b shrink-0 h-11">
        <BookDetailHeader :library-name="libraryName" :loading="loading" @back="goBack" />
        <BookDetailTabs :book-id="bookId" />
      </div>

      <main class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6" :class="backgroundClass">
        <FilesTab v-if="detail" :book="detail" />
        <div v-else-if="loading" class="space-y-3">
          <div v-for="i in 3" :key="i" class="h-16 rounded-md bg-muted animate-pulse" />
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
