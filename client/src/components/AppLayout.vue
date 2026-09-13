<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import BookMetadataFetchWidget from '@/features/book-metadata-fetch/components/BookMetadataFetchWidget.vue'
import { useThemeStore, BACKGROUND_OPTIONS } from '@/stores/theme'

const route = useRoute()
const themeStore = useThemeStore()

const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')

const BOOK_ROUTE_NAMES = new Set(['book-detail'])

/**
 * The request drawer is a child route of the list, so the list has to stay mounted while the URL
 * moves under it. Keying on the path would remount it, re-fetch the rows and run the page
 * transition every time a drawer opened.
 */
const REQUEST_ROUTE_NAMES = new Set(['book-requests', 'book-request-detail', 'book-request-releases'])

// Grid views are kept alive so scroll position and virtual list state survive
// round-trips to the book detail / metadata editor page.
const GRID_VIEW_NAMES = [
  'HomeView',
  'SmartScopeView',
  'CollectionView',
  'AuthorsView',
  'SeriesView',
  'SeriesDetailView',
  'AuthorDetailView',
  'LibrariesView',
  'SmartScopesView',
  'CollectionsView',
]

const viewKey = computed(() => {
  const name = String(route.name)
  if (BOOK_ROUTE_NAMES.has(name)) return name
  if (REQUEST_ROUTE_NAMES.has(name)) return 'requests'
  if (name.startsWith('settings-')) return 'settings'
  if (name.startsWith('tools-')) return 'tools'
  return route.path
})
</script>

<template>
  <SidebarProvider class="app-shell glow-wrapper min-h-svh" :class="backgroundClass">
    <AppSidebar />
    <SidebarInset class="app-shell-inset flex flex-col h-svh overflow-hidden relative bg-transparent pb-(--shell-gap)">
      <!-- 1. Global App Header: Fixed at the top, independent of views -->
      <AppHeader />

      <!-- 2. Independent View Area: Everything below the header scrolls here -->
      <div
        class="app-shell-scroll px-(--shell-content-gutter) pt-(--shell-gap) flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth bg-transparent"
      >
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <KeepAlive :include="GRID_VIEW_NAMES" :max="10">
              <component :is="Component" :key="viewKey" />
            </KeepAlive>
          </Transition>
        </router-view>
      </div>
    </SidebarInset>
    <BookMetadataFetchWidget />
  </SidebarProvider>
</template>

<style scoped>
/* No more masks or negative margins. Clean, stable layout. */
</style>
