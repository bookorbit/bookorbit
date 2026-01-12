<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'

useThemeStore()
const { isOpen } = useChangePasswordDialog()
</script>

<template>
  <RouterView />
  <ChangePasswordDialog v-if="isOpen" />
</template>
