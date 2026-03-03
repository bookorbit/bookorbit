<script setup lang="ts">
import { useRoute } from 'vue-router'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'

const route = useRoute()
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="flex flex-col h-screen glow-wrapper overflow-x-hidden">
      <AppHeader />
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="route.path" />
      </router-view>
    </SidebarInset>
  </SidebarProvider>
</template>
