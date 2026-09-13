<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DownloadClientsPanel from './DownloadClientsPanel.vue'
import RequestAutomationPanel from './RequestAutomationPanel.vue'
import RequestIndexersPanel from './RequestIndexersPanel.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from '@/composables/useRouteTab'

const { t } = useI18n()
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/**
 * The three things this page configures, in the order a release passes through them: where it is
 * found, what fetches it, and what happens once it lands. Stacked, they were one long scroll whose
 * middle looked like a continuation of its top.
 */
const TABS = ['sources', 'clients', 'automation'] as const
type Tab = (typeof TABS)[number]

function normalizeTab(value: unknown): Tab {
  return typeof value === 'string' && TABS.includes(value as Tab) ? (value as Tab) : 'sources'
}

const tabs = computed(() => [
  { id: 'sources' as const, label: t('settings.system.requests.tabs.sources') },
  { id: 'clients' as const, label: t('settings.system.requests.tabs.clients') },
  { id: 'automation' as const, label: t('settings.system.requests.tabs.automation') },
])
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-admin-requests',
  normalize: normalizeTab,
  availableTabs: TABS,
  fallback: 'sources',
})

/**
 * One instance-level fact, reported by whichever panel loads it. Said up front rather than as a
 * 400 after the operator has typed a credential into a form.
 */
const encryptionConfigured = ref(true)

function handleEncryptionState(configured: boolean) {
  encryptionConfigured.value = configured
}
</script>

<template>
  <SettingsPageHeader
    v-if="!embedded"
    class="hidden md:flex"
    :title="t('settings.system.requests.title')"
    :subtitle="t('settings.system.requests.subtitle')"
  />

  <div class="space-y-6" :class="{ 'mt-5 md:mt-0': !embedded }">
    <!--
      The intro is a statement about sources, so it belongs to that tab rather than above all three,
      and the Sources tab states it in its own words while there is nothing configured yet.
    -->
    <p v-if="!encryptionConfigured" role="alert" class="settings-hint text-destructive">
      {{ t('settings.system.requests.encryptionKeyMissing') }}
    </p>

    <SettingsTabs :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

    <RequestIndexersPanel v-if="activeTab === 'sources'" @encryption-state="handleEncryptionState" />
    <DownloadClientsPanel v-else-if="activeTab === 'clients'" @encryption-state="handleEncryptionState" />
    <!-- Narrower than the rest of the page: this tab is mostly prose, and a switch explaining
         itself over the full width of a list view is a line too long to read comfortably. Wrapped
         rather than passed as a class, because the panel has a v-if root and would not inherit it. -->
    <div v-else class="max-w-3xl">
      <RequestAutomationPanel />
    </div>
  </div>
</template>
