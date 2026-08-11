<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MetadataPreferencesSettings from './metadata-preferences/MetadataPreferencesSettings.vue'
import MetadataFieldRulesSettings from './metadata-preferences/MetadataFieldRulesSettings.vue'
import CustomMetadataSettings from './metadata-preferences/CustomMetadataSettings.vue'
import MetadataGenreBlocklistSettings from './metadata-preferences/MetadataGenreBlocklistSettings.vue'
import MetadataScoreWeightsSettings from './MetadataScoreWeightsSettings.vue'
import BookMetadataFetchSettings from './metadata-auto-fetch/BookMetadataFetchSettings.vue'
import AuthorEnrichmentSettings from './AuthorEnrichmentSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import { METADATA_TABS, normalizeMetadataTab, type MetadataTab as Tab } from './lib/metadata-tabs'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { t } = useI18n()
const { hasPermission } = usePermissions()

function canAccessTab(tab: Tab): boolean {
  if (tab === 'custom-fields') return hasPermission('manage_libraries')
  return hasPermission('manage_metadata_config')
}

const tabs = computed(() =>
  METADATA_TABS.filter(canAccessTab).map((id) => ({
    id,
    navLabel: t(`settings.metadata.tabs.${id}`),
    titleLabel: t(`settings.metadata.tabTitles.${id}`),
    subtitle: t(`settings.metadata.tabSubtitles.${id}`),
  })),
)

const navigationTabs = computed(() => tabs.value.map((tab) => ({ id: tab.id, label: tab.navLabel })))
const availableTabIds = computed(() => tabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-admin-metadata',
  normalize: normalizeMetadataTab,
  availableTabs: availableTabIds,
  fallback: 'providers',
})

const activeTabInfo = computed(() => ({
  titleLabel: t(`settings.metadata.tabTitles.${activeTab.value}`),
  subtitle: t(`settings.metadata.tabSubtitles.${activeTab.value}`),
}))
const hasAccessibleTabs = computed(() => tabs.value.length > 0)

const tabWidths: Record<Tab, string> = {
  providers: 'max-w-3xl',
  'field-rules': 'max-w-6xl',
  'custom-fields': 'max-w-4xl',
  'genre-blocklist': 'max-w-3xl',
  score: 'max-w-3xl',
  'auto-fetch': 'max-w-3xl',
  authors: 'max-w-3xl',
}
</script>

<template>
  <div>
    <SettingsPageHeader
      :title="t('settings.metadata.title')"
      :subtitle="hasAccessibleTabs ? t('settings.metadata.subtitle') : t('settings.metadata.noPermission')"
    />

    <SettingsTabs v-if="hasAccessibleTabs" :class="tabWidths[activeTab]" :tabs="navigationTabs" :active-tab="activeTab" @select="selectTab" />

    <div v-if="hasAccessibleTabs" :class="tabWidths[activeTab]">
      <div class="mb-5">
        <h3 class="text-lg font-semibold tracking-tight text-foreground">
          {{ activeTabInfo.titleLabel }}
        </h3>
        <p class="settings-subtitle">{{ activeTabInfo.subtitle }}</p>
      </div>
      <MetadataPreferencesSettings v-if="activeTab === 'providers'" />
      <MetadataFieldRulesSettings v-else-if="activeTab === 'field-rules'" />
      <CustomMetadataSettings v-else-if="activeTab === 'custom-fields'" />
      <MetadataGenreBlocklistSettings v-else-if="activeTab === 'genre-blocklist'" />
      <MetadataScoreWeightsSettings v-else-if="activeTab === 'score'" />
      <BookMetadataFetchSettings v-else-if="activeTab === 'auto-fetch'" />
      <AuthorEnrichmentSettings v-else-if="activeTab === 'authors'" />
    </div>
    <div v-else class="max-w-3xl rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
      {{ t('settings.metadata.noPermission') }}
    </div>
  </div>
</template>
