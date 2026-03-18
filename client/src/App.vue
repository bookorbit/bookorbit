<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { useThemeStore } from '@/stores/theme'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { initChartThemes } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
const { isOpen } = useChangePasswordDialog()

const themeVersion = ref(0)

provide(INIT_OPTIONS_KEY, { renderer: 'svg' })
provide(
  THEME_KEY,
  computed(() => `projectx-v${themeVersion.value}`),
)

onMounted(() => {
  initChartThemes(0)
})

watch([() => themeStore.theme, () => themeStore.accent], () => {
  const v = themeVersion.value + 1
  initChartThemes(v)
  themeVersion.value = v
})
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <router-view />
    <ChangePasswordDialog v-if="isOpen" />
    <Toaster rich-colors />
  </TooltipProvider>
</template>
