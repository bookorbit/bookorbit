<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import SettingsDrawer from '@/features/settings/SettingsDrawer.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

useThemeStore()
const { isOpen } = useChangePasswordDialog()
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <router-view />
    <ChangePasswordDialog v-if="isOpen" />
    <SettingsDrawer />
    <Toaster rich-colors />
  </TooltipProvider>
</template>
