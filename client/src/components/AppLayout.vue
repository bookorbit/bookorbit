<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import { useThemeStore, BACKGROUND_OPTIONS } from '@/stores/theme'

const route = useRoute()
const themeStore = useThemeStore()

const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
</script>

<template>
  <SidebarProvider class="glow-wrapper min-h-screen" :class="backgroundClass">
    <AppSidebar />
    <SidebarInset class="flex flex-col h-screen overflow-hidden relative bg-transparent">
      <!-- 1. Global App Header: Fixed at the top, independent of views -->
      <AppHeader />
      
      <!-- 2. Independent View Area: Everything below the header scrolls here -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth bg-transparent">
        <router-view :key="route.path" />
        <!-- Bottom gutter matching the top floating margin -->
        <div class="h-6 w-full" />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<style scoped>
/* No more masks or negative margins. Clean, stable layout. */
</style>
