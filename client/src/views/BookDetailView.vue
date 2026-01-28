<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import BookDetailHeader from '@/features/book/components/detail/BookDetailHeader.vue'
import BookDetailTabs from '@/features/book/components/detail/BookDetailTabs.vue'
import DetailsTab from '@/features/book/components/detail/tabs/DetailsTab.vue'
import FilesTab from '@/features/book/components/detail/tabs/FilesTab.vue'
import { useBookDetail } from '@/features/book/composables/useBookDetail'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useLibraries } from '@/features/library/composables/useLibraries'

const route = useRoute()
const router = useRouter()

const bookId = computed(() => Number(route.params.bookId))
const activeTab = computed(() => (route.query.tab as string) || 'details')

const { detail, loading, fetch } = useBookDetail()
const { libraries, fetchLibraries } = useLibraries()

const { onBookMissing, onBookFileRemoved } = useBookEvents()
onBookMissing((bookIds) => {
  if (detail.value && bookIds.includes(detail.value.id)) {
    detail.value = { ...detail.value, status: 'missing', files: [] }
  }
})
onBookFileRemoved((bookId) => {
  if (detail.value?.id === bookId) fetch(bookId)
})

watch(bookId, (id) => fetch(id), { immediate: true })
fetchLibraries()

const libraryName = computed(() => libraries.value.find((l) => l.id === detail.value?.libraryId)?.name ?? 'Library')

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    const libId = detail.value?.libraryId
    router.push(libId ? { name: 'library', params: { id: libId } } : { name: 'home' })
  }
}

function setTab(tab: string) {
  router.replace({ query: { tab } })
}

const visitedTabs = reactive(new Set<string>())
watch(activeTab, (tab) => visitedTabs.add(tab), { immediate: true })
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="flex flex-col min-h-screen">
      <AppHeader />
      <div class="flex items-center border-b shrink-0 h-11">
        <BookDetailHeader :library-name="libraryName" :loading="loading" @back="goBack" />
        <BookDetailTabs :active-tab="activeTab" @update:active-tab="setTab" />
      </div>

      <main class="flex-1 overflow-y-auto px-6 py-6">
        <template v-if="detail">
          <DetailsTab v-if="visitedTabs.has('details')" v-show="activeTab === 'details'" :book="detail" />
          <FilesTab v-if="visitedTabs.has('files')" v-show="activeTab === 'files'" :book="detail" />
        </template>

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
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
