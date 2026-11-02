<script setup lang="ts">
import { computed, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useChartTokens } from '@/composables/useChartTokens'
import { buildChartTheme } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import WhatsNewDialog from '@/features/whats-new/WhatsNewDialog.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useSessionBootstrap } from '@/features/auth/composables/useSessionBootstrap'
import ServerReconnectScreen from '@/features/auth/components/ServerReconnectScreen.vue'
import TtsMiniPlayer from '@/features/tts/components/TtsMiniPlayer.vue'
import MediaOverlayMiniPlayer from '@/features/reader/media-overlay/components/MediaOverlayMiniPlayer.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resolveRouteViewKey } from '@/router/view-key'
import LegalNotices from '@/components/legal/LegalNotices.vue'

// The bottom-edge TTS player publishes its measured height, so the toaster clears it.
const TOASTER_OFFSET = {
  right: '16px',
  bottom: 'max(16px, var(--tts-mini-player-clearance, 0px))',
}
const TOASTER_MOBILE_OFFSET = {
  left: '16px',
  right: '16px',
  bottom: 'max(16px, var(--tts-mini-player-clearance, 0px))',
}

const { isOpen } = useChangePasswordDialog()
const chartTokens = useChartTokens()

const route = useRoute()
const { user } = useAuth()
const { unreachable: serverUnreachable } = useSessionBootstrap()
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

provide(INIT_OPTIONS_KEY, { renderer: 'svg' })
provide(
  THEME_KEY,
  computed(() => buildChartTheme(chartTokens.value)),
)
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <ServerReconnectScreen v-if="serverUnreachable" />
    <router-view v-slot="{ Component, route: activeRoute }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="resolveRouteViewKey(activeRoute)" />
      </Transition>
    </router-view>
    <ChangePasswordDialog v-if="isOpen" />
    <WhatsNewDialog v-if="popupOpen" />
    <LegalNotices />
    <TtsMiniPlayer />
    <MediaOverlayMiniPlayer />
    <Toaster rich-colors position="bottom-right" :visible-toasts="5" :gap="8" :offset="TOASTER_OFFSET" :mobile-offset="TOASTER_MOBILE_OFFSET" />
  </TooltipProvider>
</template>
