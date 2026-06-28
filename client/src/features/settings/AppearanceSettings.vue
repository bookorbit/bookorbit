<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ACCENT_PASTEL, ACCENT_VIVID, BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import AppearanceBehaviorSettings from './AppearanceBehaviorSettings.vue'
import AppearanceBookCoverSettings from './AppearanceBookCoverSettings.vue'
import AppearanceIconsSettings from './AppearanceIconsSettings.vue'
import AppearanceLayoutSettings from './AppearanceLayoutSettings.vue'
import AppearanceThemeSettings from './AppearanceThemeSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { APPEARANCE_TAB_LABELS, APPEARANCE_TABS, normalizeAppearanceTab, type AppearanceTab as Tab } from './lib/appearance-tabs'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()

const activeTab = ref<Tab>(normalizeAppearanceTab(route.query.tab))
const tabs: { id: Tab; label: string }[] = APPEARANCE_TABS.map((id) => ({ id, label: APPEARANCE_TAB_LABELS[id] }))

const accentLabel = computed(() => [...ACCENT_VIVID, ...ACCENT_PASTEL].find((opt) => opt.id === themeStore.accent)?.label ?? themeStore.accent)
const backgroundLabel = computed(() => BACKGROUND_OPTIONS.find((opt) => opt.id === themeStore.background)?.label ?? themeStore.background)

function syncTabFromRoute(value: unknown) {
  const normalized = normalizeAppearanceTab(value)
  activeTab.value = normalized
  if (value !== normalized) {
    router.replace({ name: 'settings-appearance', query: { ...route.query, tab: normalized } })
  }
}

syncTabFromRoute(route.query.tab)

watch(
  () => route.query.tab,
  (value) => {
    syncTabFromRoute(value)
  },
)

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-appearance', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader title="Display" subtitle="Control themes, covers, layout, and how your library is presented." />
  <div
    class="md:hidden sticky top-0 z-20 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
  >
    <p class="text-[11px] font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
      Theme: {{ themeStore.theme === 'dark' ? 'Dark' : 'Light' }} • Accent: {{ accentLabel }} • Background: {{ backgroundLabel }}
    </p>
  </div>

  <div
    class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :data-testid="`appearance-tab-${tab.id}`"
      class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
      :class="
        activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      "
      @click="selectTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>

  <AppearanceThemeSettings v-if="activeTab === 'theme'" />
  <AppearanceBookCoverSettings v-else-if="activeTab === 'book-covers'" />
  <AppearanceIconsSettings v-else-if="activeTab === 'icons'" />
  <AppearanceLayoutSettings v-else-if="activeTab === 'layout'" />
  <AppearanceBehaviorSettings v-else-if="activeTab === 'behavior'" />
</template>
