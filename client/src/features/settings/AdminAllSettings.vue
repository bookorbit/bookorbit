<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import UsersPage from '@/features/admin/UsersPage.vue'
import OidcSettings from './OidcSettings.vue'
import AccountActivityPage from '@/features/admin/AccountActivityPage.vue'
import MagicLinksSettings from './MagicLinksSettings.vue'
import ServerFontsSettings from './ServerFontsSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { ADMIN_TAB_INFO, ADMIN_TABS, normalizeAdminTab, type AdminTab as Tab } from './lib/admin-tabs'

const { t } = useI18n()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  ADMIN_TABS.filter((id) => {
    const perm = ADMIN_TAB_INFO[id].permission
    return isSuperuser.value || (perm !== null && userPermissions.value.includes(perm))
  }).map((id) => ({ id, label: t(`settings.admin.tabs.${id}`) })),
)

const availableTabIds = computed(() => availableTabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-admin',
  normalize: normalizeAdminTab,
  availableTabs: availableTabIds,
  fallback: 'users',
})

const tabWidths: Record<Tab, string> = {
  users: 'max-w-6xl',
  'account-activity': 'max-w-6xl',
  'magic-links': 'max-w-5xl',
  oidc: 'max-w-3xl',
  'server-fonts': 'max-w-3xl',
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.admin.title')" :subtitle="t('settings.admin.subtitle')" />

  <SettingsTabs :class="tabWidths[activeTab]" :tabs="availableTabs" :active-tab="activeTab" @select="selectTab" />

  <div :class="tabWidths[activeTab]">
    <UsersPage v-if="activeTab === 'users'" />
    <AccountActivityPage v-else-if="activeTab === 'account-activity'" />
    <MagicLinksSettings v-else-if="activeTab === 'magic-links'" :with-header="false" with-embedded-create-action />
    <OidcSettings v-else-if="activeTab === 'oidc'" embedded />
    <ServerFontsSettings v-else-if="activeTab === 'server-fonts'" embedded />
  </div>
</template>
