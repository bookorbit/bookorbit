<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ACCENT_PASTEL, ACCENT_VIVID, BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import AppearanceBehaviorSettings from './AppearanceBehaviorSettings.vue'
import AppearanceBookCoverSettings from './AppearanceBookCoverSettings.vue'
import AppearanceIconsSettings from './AppearanceIconsSettings.vue'
import AppearanceLanguageSettings from './AppearanceLanguageSettings.vue'
import AppearanceLayoutSettings from './AppearanceLayoutSettings.vue'
import AppearanceThemeSettings from './AppearanceThemeSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import { APPEARANCE_TABS, normalizeAppearanceTab, type AppearanceTab as Tab } from './lib/appearance-tabs'

const { t } = useI18n()
const themeStore = useThemeStore()

const tabs = computed(() =>
  APPEARANCE_TABS.map((id) => ({
    id,
    label: t(`settings.appearance.tabs.${id}`),
  })),
)
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-appearance',
  normalize: normalizeAppearanceTab,
  availableTabs: APPEARANCE_TABS,
  fallback: 'theme',
})

const accentLabel = computed(() => {
  const option = [...ACCENT_VIVID, ...ACCENT_PASTEL].find((opt) => opt.id === themeStore.accent)
  return option ? t(option.labelKey) : themeStore.accent
})
const backgroundLabel = computed(() => BACKGROUND_OPTIONS.find((opt) => opt.id === themeStore.background)?.label ?? themeStore.background)
const themeLabel = computed(() => t(`settings.appearance.themeMode.${themeStore.theme}`))
</script>

<template>
  <SettingsPageHeader :title="t('settings.appearance.pageTitle')" :subtitle="t('settings.appearance.pageSubtitle')" />
  <div
    class="md:hidden sticky top-0 z-20 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <p class="text-[11px] font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
      {{
        t('settings.appearance.mobileSummary', {
          theme: themeLabel,
          accent: accentLabel,
          background: backgroundLabel,
        })
      }}
    </p>
  </div>

  <SettingsTabs :tabs="tabs" :active-tab="activeTab" test-id-prefix="appearance-tab" @select="selectTab" />

  <AppearanceThemeSettings v-if="activeTab === 'theme'" />
  <AppearanceBookCoverSettings v-else-if="activeTab === 'book-covers'" />
  <AppearanceIconsSettings v-else-if="activeTab === 'icons'" />
  <AppearanceLayoutSettings v-else-if="activeTab === 'layout'" />
  <AppearanceBehaviorSettings v-else-if="activeTab === 'behavior'" />
  <AppearanceLanguageSettings v-else-if="activeTab === 'language'" />
</template>
