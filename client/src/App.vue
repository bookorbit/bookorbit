<script setup lang="ts">
import { computed, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import WhatsNewDialog from '@/features/whats-new/WhatsNewDialog.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useAuth } from '@/features/auth/composables/useAuth'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const { isOpen } = useChangePasswordDialog()
const themeStore = useThemeStore()

const route = useRoute()
const { user } = useAuth()
const { popupOpen, evaluate, syncPopup } = useWhatsNew()

watch(
  () => user.value,
  async (current) => {
    if (!current) return
    await evaluate()
    syncPopup(route.name as string | undefined)
  },
  { immediate: true },
)

watch(
  () => route.name,
  (name) => syncPopup(name as string | undefined),
)

initChartThemes()

provide(INIT_OPTIONS_KEY, { renderer: 'svg' })
provide(
  THEME_KEY,
  computed(() => getBookorbitThemeName(themeStore.resolvedTheme, themeStore.accent)),
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
    <WhatsNewDialog v-if="popupOpen" />
    <Toaster rich-colors position="bottom-right" :visible-toasts="5" :gap="8" />
  </TooltipProvider>
</template>
