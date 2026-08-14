<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPageHeader from './SettingsPageHeader.vue'
import SettingsTabs from './components/SettingsTabs.vue'
import { useRouteTab } from './composables/useRouteTab'
import FileNamingSettings from './FileNamingSettings.vue'
import BookDockSettings from './BookDockSettings.vue'
import MaintenanceSettings from './MaintenanceSettings.vue'
import AuditLogPage from '@/features/audit/AuditLogPage.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { SYSTEM_TAB_INFO, SYSTEM_TABS, normalizeSystemTab, type SystemTab as Tab } from './lib/system-tabs'

const { t } = useI18n()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  SYSTEM_TABS.filter((id) => {
    const perm = SYSTEM_TAB_INFO[id].permission
    if (id === 'audit-log') return isSuperuser.value
    return isSuperuser.value || (perm !== null && userPermissions.value.includes(perm))
  }).map((id) => ({ id, label: t(`settings.system.tabs.${id}`) })),
)

const availableTabIds = computed(() => availableTabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-system',
  normalize: normalizeSystemTab,
  availableTabs: availableTabIds,
  fallback: 'file-naming',
})

const tabWidths: Record<Tab, string> = {
  'file-naming': 'max-w-5xl',
  'book-dock': 'max-w-3xl',
  maintenance: 'max-w-3xl',
  'audit-log': 'max-w-[96rem]',
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.admin.system.title')" :subtitle="t('settings.admin.system.subtitle')" />

  <SettingsTabs :class="tabWidths[activeTab]" :tabs="availableTabs" :active-tab="activeTab" @select="selectTab" />

  <div v-if="availableTabIds.includes(activeTab)" :class="tabWidths[activeTab]">
    <FileNamingSettings v-if="activeTab === 'file-naming'" embedded />
    <BookDockSettings v-else-if="activeTab === 'book-dock'" embedded />
    <MaintenanceSettings v-else-if="activeTab === 'maintenance'" embedded />
    <AuditLogPage v-else-if="activeTab === 'audit-log'" embedded />
  </div>
</template>
