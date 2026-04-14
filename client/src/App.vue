<script setup lang="ts">
import { computed, provide } from 'vue'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useThemeStore } from '@/stores/theme'
import { getProjectxThemeName, initChartThemes } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const { isOpen } = useChangePasswordDialog()
const themeStore = useThemeStore()

initChartThemes()

provide(INIT_OPTIONS_KEY, { renderer: 'svg' })
provide(
  THEME_KEY,
  computed(() => getProjectxThemeName(themeStore.theme, themeStore.accent)),
)
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <router-view v-slot="{ Component, route }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.matched[0]?.path ?? route.path" />
      </Transition>
    </router-view>
    <ChangePasswordDialog v-if="isOpen" />
    <Toaster rich-colors position="bottom-right" :visible-toasts="5" :gap="8" />
  </TooltipProvider>
</template>
