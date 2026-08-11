<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import ReaderSettings from './ReaderSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'
import AudioSettings from './AudioSettings.vue'
import FontsSettings from './FontsSettings.vue'
import { READER_TABS, normalizeReaderTab, type ReaderTab as Tab } from './lib/reader-tabs'

const { t } = useI18n()
const tabs = computed(() =>
  READER_TABS.slice()
    .sort((a, b) => (a === 'general' ? 1 : b === 'general' ? -1 : 0))
    .map((id) => ({ id, label: t(`settings.reader.tabs.${id}`) })),
)

const availableTabs = computed(() => tabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-reader-general',
  normalize: normalizeReaderTab,
  availableTabs,
  fallback: 'ebook',
})
</script>

<template>
  <SettingsPageHeader :title="t('settings.reader.all.title')" :subtitle="t('settings.reader.all.subtitle')" />

  <SettingsTabs :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

  <ReaderSettings v-if="activeTab === 'general'" embedded />
  <EbookSettings v-else-if="activeTab === 'ebook'" embedded />
  <PdfSettings v-else-if="activeTab === 'pdf'" embedded />
  <ComicsSettings v-else-if="activeTab === 'comics'" embedded />
  <AudioSettings v-else-if="activeTab === 'audio'" embedded />
  <FontsSettings v-else-if="activeTab === 'fonts'" />
</template>
