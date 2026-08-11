<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AccountSettings from './AccountSettings.vue'
import NotificationPreferences from '@/features/notifications/components/NotificationPreferences.vue'
import ContentRestrictionsSettings from './ContentRestrictionsSettings.vue'
import PrivacySharingSettings from './PrivacySharingSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import { ACCOUNT_TABS, normalizeAccountTab, type AccountTab as Tab } from './lib/account-tabs'

const { t } = useI18n()
const { isDemoRestrictedAccount } = usePermissions()

const availableTabs = computed(() =>
  ACCOUNT_TABS.filter((id) => {
    if (id === 'notifications') return !isDemoRestrictedAccount.value
    return true
  }).map((id) => ({ id, label: t(`settings.account.tabs.${id}`) })),
)

const availableTabIds = computed(() => availableTabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-account',
  normalize: normalizeAccountTab,
  availableTabs: availableTabIds,
  fallback: 'profile',
})
</script>

<template>
  <SettingsPageHeader :title="t('settings.account.title')" :subtitle="t('settings.account.subtitleAll')" />

  <SettingsTabs :tabs="availableTabs" :active-tab="activeTab" @select="selectTab" />

  <AccountSettings v-if="activeTab === 'profile'" embedded />
  <PrivacySharingSettings v-else-if="activeTab === 'privacy'" />
  <NotificationPreferences v-else-if="activeTab === 'notifications'" embedded />
  <ContentRestrictionsSettings v-else-if="activeTab === 'restrictions'" />
</template>
