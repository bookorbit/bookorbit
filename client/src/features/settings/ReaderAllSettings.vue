<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ReaderSettings from './ReaderSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'
import AudioSettings from './AudioSettings.vue'
import FontsSettings from './FontsSettings.vue'
import { READER_TABS, normalizeReaderTab, type ReaderTab as Tab } from './lib/reader-tabs'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const activeTab = ref<Tab>(normalizeReaderTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-reader-general', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeReaderTab(value)
  },
)

const tabs = computed(() =>
  READER_TABS.slice()
    .sort((a, b) => (a === 'general' ? 1 : b === 'general' ? -1 : 0))
    .map((id) => ({ id, label: t(`settings.reader.tabs.${id}`) })),
)

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-reader-general', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.reader.all.title')" :subtitle="t('settings.reader.all.subtitle')" />

  <div
    class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
      :class="
        activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      "
      @click="selectTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>

  <ReaderSettings v-if="activeTab === 'general'" embedded />
  <EbookSettings v-else-if="activeTab === 'ebook'" embedded />
  <PdfSettings v-else-if="activeTab === 'pdf'" embedded />
  <ComicsSettings v-else-if="activeTab === 'comics'" embedded />
  <AudioSettings v-else-if="activeTab === 'audio'" embedded />
  <FontsSettings v-else-if="activeTab === 'fonts'" />
</template>
