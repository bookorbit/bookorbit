<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import MetadataPreferencesSettings from './metadata-preferences/MetadataPreferencesSettings.vue'
import MetadataFieldRulesSettings from './metadata-preferences/MetadataFieldRulesSettings.vue'
import CustomMetadataSettings from './metadata-preferences/CustomMetadataSettings.vue'
import MetadataGenreBlocklistSettings from './metadata-preferences/MetadataGenreBlocklistSettings.vue'
import MetadataScoreWeightsSettings from './MetadataScoreWeightsSettings.vue'
import BookMetadataFetchSettings from './metadata-auto-fetch/BookMetadataFetchSettings.vue'
import AuthorEnrichmentSettings from './AuthorEnrichmentSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { METADATA_TABS, normalizeMetadataTab, type MetadataTab as Tab } from './lib/metadata-tabs'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

const activeTab = ref<Tab>(normalizeMetadataTab(route.query.tab))

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

const fallbackTab = computed<Tab | null>(() => tabs.value[0]?.id ?? null)

function syncActiveTab(value: unknown) {
  const requested = normalizeMetadataTab(value)
  const nextTab = canAccessTab(requested) ? requested : fallbackTab.value
  if (!nextTab) return
  activeTab.value = nextTab
  if (activeTab.value !== value) {
    router.replace({ name: 'settings-admin-metadata', query: { ...route.query, tab: activeTab.value } })
  }
}

syncActiveTab(route.query.tab)

watch(
  () => route.query.tab,
  (value) => {
    syncActiveTab(value)
  },
)

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

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-admin-metadata', query: { ...route.query, tab } })
}
</script>

<template>
  <div class="metadata-mobile-hints">
    <div class="md:hidden mb-3">
      <h2 class="settings-title">{{ hasAccessibleTabs ? activeTabInfo.titleLabel : t('settings.metadata.title') }}</h2>
      <p class="settings-subtitle overflow-hidden" style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2">
        {{ hasAccessibleTabs ? activeTabInfo.subtitle : t('settings.metadata.noPermission') }}
      </p>
    </div>
    <div v-if="hasAccessibleTabs" class="hidden md:block">
      <SettingsPageHeader :title="activeTabInfo.titleLabel" :subtitle="activeTabInfo.subtitle" />
    </div>
    <div v-else class="hidden md:block">
      <SettingsPageHeader :title="t('settings.metadata.title')" :subtitle="t('settings.metadata.noPermission')" />
    </div>

    <div
      v-if="hasAccessibleTabs"
      :class="[
        tabWidths[activeTab],
        'flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x',
      ]"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
        :class="
          activeTab === tab.id
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        "
        @click="selectTab(tab.id)"
      >
        {{ tab.navLabel }}
      </button>
    </div>

    <div v-if="hasAccessibleTabs" :class="tabWidths[activeTab]">
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
