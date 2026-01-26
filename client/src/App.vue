<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import SettingsDrawer from '@/features/settings/SettingsDrawer.vue'
import { Toaster } from '@/components/ui/sonner'

useThemeStore()
const { isOpen } = useChangePasswordDialog()
const route = useRoute()
</script>

<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="['HomeView', 'LensView']">
      <component :is="Component" :key="route.path" />
    </keep-alive>
  </router-view>
  <ChangePasswordDialog v-if="isOpen" />
  <SettingsDrawer />
  <Toaster rich-colors />
</template>
