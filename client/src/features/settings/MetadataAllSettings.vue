<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MetadataPreferencesSettings from './metadata-preferences/MetadataPreferencesSettings.vue'
import MetadataFieldRulesSettings from './metadata-preferences/MetadataFieldRulesSettings.vue'
import MetadataScoreWeightsSettings from './MetadataScoreWeightsSettings.vue'
import BookMetadataFetchSettings from './metadata-auto-fetch/BookMetadataFetchSettings.vue'
import AuthorEnrichmentSettings from './AuthorEnrichmentSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { METADATA_TAB_INFO, METADATA_TABS, normalizeMetadataTab, type MetadataTab as Tab } from './lib/metadata-tabs'

const route = useRoute()
const router = useRouter()

const activeTab = ref<Tab>(normalizeMetadataTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-admin-metadata', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeMetadataTab(value)
  },
)

const tabs = METADATA_TABS.map((id) => ({
  id,
  navLabel: METADATA_TAB_INFO[id].navLabel,
  titleLabel: METADATA_TAB_INFO[id].titleLabel,
  subtitle: METADATA_TAB_INFO[id].subtitle,
}))

const activeTabInfo = computed(() => METADATA_TAB_INFO[activeTab.value])

const tabWidths: Record<Tab, string> = {
  providers: 'max-w-3xl',
  'field-rules': 'max-w-6xl',
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
  <div>
    <SettingsPageHeader :title="activeTabInfo.titleLabel" :subtitle="activeTabInfo.subtitle" />

    <div class="flex gap-1 mb-6 border-b border-border overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-3 py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors"
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

    <div :class="tabWidths[activeTab]">
      <MetadataPreferencesSettings v-if="activeTab === 'providers'" />
      <MetadataFieldRulesSettings v-else-if="activeTab === 'field-rules'" />
      <MetadataScoreWeightsSettings v-else-if="activeTab === 'score'" />
      <BookMetadataFetchSettings v-else-if="activeTab === 'auto-fetch'" />
      <AuthorEnrichmentSettings v-else-if="activeTab === 'authors'" />
    </div>
  </div>
</template>
