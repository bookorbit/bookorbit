<script setup lang="ts">
import { computed, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { APP_FEATURES } from '@bookorbit/types'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import WhatsNewDialog from '@/features/whats-new/WhatsNewDialog.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useAuth } from '@/features/auth/composables/useAuth'
import TtsMiniPlayer from '@/features/tts/components/TtsMiniPlayer.vue'
import MediaOverlayMiniPlayer from '@/features/reader/media-overlay/components/MediaOverlayMiniPlayer.vue'
import PodcastMiniPlayer from '@/features/podcast/components/PodcastMiniPlayer.vue'
import PodcastLiveRegion from '@/features/podcast/components/PodcastLiveRegion.vue'
import PodcastDownloadWidget from '@/features/podcast/components/PodcastDownloadWidget.vue'
import PodcastShortcutsDialog from '@/features/podcast/components/PodcastShortcutsDialog.vue'
import { usePodcastPlayer } from '@/features/podcast/composables/usePodcastPlayer'
import { usePodcastKeyboardShortcuts } from '@/features/podcast/composables/usePodcastKeyboardShortcuts'
import { usePodcastDownloadBatches } from '@/features/podcast/composables/usePodcastDownloadBatches'
import { usePodcastEvents } from '@/features/podcast/composables/usePodcastEvents'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resolveRouteViewKey } from '@/router/view-key'
import LegalNotices from '@/components/legal/LegalNotices.vue'

// Bottom-edge media and download surfaces publish their measured heights, so the toaster clears
// whichever one currently sits highest.
const TOASTER_OFFSET = {
  right: '16px',
  bottom:
    'max(16px, var(--podcast-mini-player-clearance, 0px), var(--tts-mini-player-clearance, 0px), var(--podcast-download-widget-clearance, 0px))',
}
const TOASTER_MOBILE_OFFSET = {
  left: '16px',
  right: '16px',
  bottom:
    'max(16px, var(--podcast-mini-player-clearance, 0px), var(--tts-mini-player-clearance, 0px), var(--podcast-download-widget-clearance, 0px))',
}

const { isOpen } = useChangePasswordDialog()
const themeStore = useThemeStore()

const route = useRoute()
const { user } = useAuth()
const { popupOpen, evaluate, syncPopup } = useWhatsNew()
const podcastPlayer = APP_FEATURES.podcasts ? usePodcastPlayer() : null
const podcastDownloads = APP_FEATURES.podcasts ? usePodcastDownloadBatches() : null
const podcastEvents = APP_FEATURES.podcasts ? usePodcastEvents() : null

if (APP_FEATURES.podcasts) usePodcastKeyboardShortcuts()

watch(
  () => user.value,
  async (current, previous) => {
    if (previous && current?.id !== previous.id) {
      await podcastPlayer?.resetForUserChange()
      podcastDownloads?.resetForUserChange()
      podcastEvents?.resetForUserChange()
    }
    if (!current) {
      if (!previous) {
        await podcastPlayer?.resetForUserChange()
        podcastDownloads?.resetForUserChange()
        podcastEvents?.resetForUserChange()
      }
      return
    }
    await podcastPlayer?.loadPreferences()
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
    <PodcastMiniPlayer v-if="APP_FEATURES.podcasts" />
    <PodcastDownloadWidget v-if="APP_FEATURES.podcasts && user" />
    <PodcastShortcutsDialog v-if="APP_FEATURES.podcasts" />
    <PodcastLiveRegion v-if="APP_FEATURES.podcasts" />
    <Toaster rich-colors position="bottom-right" :visible-toasts="5" :gap="8" :offset="TOASTER_OFFSET" :mobile-offset="TOASTER_MOBILE_OFFSET" />
  </TooltipProvider>
</template>
