<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import SettingsDrawer from '@/features/settings/SettingsDrawer.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarProvider } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'

useThemeStore()
const { isOpen } = useChangePasswordDialog()
const route = useRoute()
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <SidebarProvider>
      <AppSidebar />
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="route.path" />
      </router-view>
    </SidebarProvider>
    <ChangePasswordDialog v-if="isOpen" />
    <SettingsDrawer />
    <Toaster rich-colors />
  </TooltipProvider>
</template>
