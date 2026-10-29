<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderConfigurations } from '@bookorbit/types'
import SettingsTabs from '@/features/settings/components/SettingsTabs.vue'
import { useRouteTab } from '@/composables/useRouteTab'
import ExternalProvidersTab from './components/ExternalProvidersTab.vue'
import ProviderConfigPanel from './components/ProviderConfigPanel.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useProviderThrottleRuntime } from './composables/useProviderThrottleRuntime'

const { t } = useI18n()

const { config, statuses, saving, testingByKey, testResultsByKey, passingTestSignatureByKey, fetchConfig, saveConfig, testProvider } =
  useProviderConfig()
const { runtimeByKey, startPolling, stopPolling } = useProviderThrottleRuntime()

/**
 * Sources BookOrbit ships with, and the ones an admin runs beside it. They are configured in
 * different ways, one with switches and keys, the other by address, so they read best apart.
 */
const TABS = ['built-in', 'external'] as const
type Tab = (typeof TABS)[number]

function normalizeTab(value: unknown): Tab {
  return typeof value === 'string' && TABS.includes(value as Tab) ? (value as Tab) : 'built-in'
}

const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-metadata-providers',
  normalize: normalizeTab,
  availableTabs: TABS,
  fallback: 'built-in',
})

const tabs = computed(() => {
  const external = statuses.value.filter((status) => status.source === 'external' && !status.movedOut)
  const needsAttention = statuses.value.some((status) => status.movedOut?.inUse)
  return [
    {
      id: 'built-in' as const,
      label: t('settings.metadata.providers.tabs.builtIn'),
      count: statuses.value.length ? statuses.value.filter((status) => status.source !== 'external').length : undefined,
    },
    {
      id: 'external' as const,
      label: t('settings.metadata.providers.tabs.external'),
      count: statuses.value.length ? external.length : undefined,
      attention: needsAttention ? t('settings.metadata.providers.tabs.attention') : undefined,
    },
  ]
})

onMounted(() => {
  startPolling()
  void fetchConfig().catch(() => undefined)
})

onUnmounted(() => {
  stopPolling()
})

function handleExternalProvidersChanged() {
  void fetchConfig().catch(() => undefined)
}
</script>

<template>
  <SettingsTabs :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

  <!-- Hidden rather than unmounted, so unsaved switches and keys survive a look at the other tab. -->
  <ProviderConfigPanel
    v-show="activeTab === 'built-in'"
    :config="config"
    :statuses="statuses"
    :runtime-by-key="runtimeByKey"
    :saving="saving"
    :testing-by-key="testingByKey"
    :test-results-by-key="testResultsByKey"
    :passing-test-signature-by-key="passingTestSignatureByKey"
    @save="saveConfig($event as Partial<ProviderConfigurations>)"
    @test="testProvider"
  />
  <ExternalProvidersTab v-if="activeTab === 'external'" :statuses="statuses" @changed="handleExternalProvidersChanged" />
</template>
