<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import HardcoverSettings from '@/features/hardcover/components/HardcoverSettings.vue'
import ReadwiseSettings from '@/features/readwise/components/ReadwiseSettings.vue'
import StorygraphSettings from '@/features/storygraph/components/StorygraphSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { INTEGRATION_TAB_INFO, INTEGRATION_TABS, normalizeIntegrationTab, type IntegrationTab as Tab } from './lib/integration-tabs'

const { t } = useI18n()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  INTEGRATION_TABS.filter((id) => isSuperuser.value || userPermissions.value.includes(INTEGRATION_TAB_INFO[id].permission)).map((id) => ({
    id,
    label: t(INTEGRATION_TAB_INFO[id].labelKey),
  })),
)
const availableTabIds = computed(() => availableTabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-integrations',
  normalize: normalizeIntegrationTab,
  availableTabs: availableTabIds,
  fallback: 'hardcover',
})
</script>

<template>
  <SettingsPageHeader :title="t('settings.integrations.title')" :subtitle="t('settings.integrations.subtitle')" />

  <SettingsTabs v-if="availableTabs.length > 0" :tabs="availableTabs" :active-tab="activeTab" @select="selectTab" />

  <HardcoverSettings v-if="activeTab === 'hardcover' && availableTabs.length > 0" embedded />
  <ReadwiseSettings v-else-if="activeTab === 'readwise' && availableTabs.length > 0" embedded />
  <StorygraphSettings v-else-if="activeTab === 'storygraph' && availableTabs.length > 0" embedded />
  <div v-else class="rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
    {{ t('settings.integrations.noPermission') }}
  </div>
</template>
