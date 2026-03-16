<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MetadataPreferencesSettings from './metadata-preferences/MetadataPreferencesSettings.vue'
import MetadataScoreWeightsSettings from './MetadataScoreWeightsSettings.vue'
import BookMetadataFetchSettings from './metadata-auto-fetch/BookMetadataFetchSettings.vue'
import AuthorEnrichmentSettings from './AuthorEnrichmentSettings.vue'
import MetadataFileSyncSettings from './MetadataFileSyncSettings.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

type Tab = 'providers' | 'score' | 'auto-fetch' | 'authors' | 'file-sync'

const route = useRoute()
const router = useRouter()

function normalizeTab(value: unknown): Tab {
  if (value === 'providers' || value === 'score' || value === 'auto-fetch' || value === 'authors' || value === 'file-sync') return value
  return 'providers'
}

const activeTab = ref<Tab>(normalizeTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-admin-metadata', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeTab(value)
  },
)

const tabs: { id: Tab; label: string; subtitle: string }[] = [
  {
    id: 'providers',
    label: 'Source & Priority',
    subtitle: 'Define how book information is collected from external services and prioritized across your libraries.',
  },
  { id: 'score', label: 'Confidence Score', subtitle: 'Assign weights to metadata fields to calculate how much to trust fetched results.' },
  {
    id: 'auto-fetch',
    label: 'Book Auto-Fetch',
    subtitle: 'Automatically fetch covers, descriptions, and other details when new books are added to your library.',
  },
  {
    id: 'authors',
    label: 'Author Auto-Fetch',
    subtitle: 'Automatically fetch biographies and profile photos when new authors appear in your library.',
  },
  { id: 'file-sync', label: 'File Write-Back', subtitle: 'Configure which metadata fields are saved directly into your book files on disk.' },
]

const activeTabInfo = computed(() => tabs.find((t) => t.id === activeTab.value)!)

const tabWidths: Record<Tab, string> = {
  providers: 'max-w-5xl',
  score: 'max-w-3xl',
  'auto-fetch': 'max-w-3xl',
  authors: 'max-w-3xl',
  'file-sync': 'max-w-3xl',
}

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-admin-metadata', query: { ...route.query, tab } })
}
</script>

<template>
  <div>
    <SettingsPageHeader :title="activeTabInfo.label" :subtitle="activeTabInfo.subtitle" />

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
        {{
          tab.id === 'providers'
            ? 'Providers'
            : tab.id === 'score'
              ? 'Score'
              : tab.id === 'auto-fetch'
                ? 'Books'
                : tab.id === 'authors'
                  ? 'Authors'
                  : 'File Sync'
        }}
      </button>
    </div>

    <div :class="tabWidths[activeTab]">
      <MetadataPreferencesSettings v-if="activeTab === 'providers'" />
      <MetadataScoreWeightsSettings v-else-if="activeTab === 'score'" />
      <BookMetadataFetchSettings v-else-if="activeTab === 'auto-fetch'" />
      <AuthorEnrichmentSettings v-else-if="activeTab === 'authors'" />
      <MetadataFileSyncSettings v-else-if="activeTab === 'file-sync'" />
    </div>
  </div>
</template>
