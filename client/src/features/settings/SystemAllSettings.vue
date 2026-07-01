<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import FileNamingSettings from './FileNamingSettings.vue'
import BookDockSettings from './BookDockSettings.vue'
import MaintenanceSettings from './MaintenanceSettings.vue'
import AuditLogPage from '@/features/audit/AuditLogPage.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { SYSTEM_TAB_INFO, SYSTEM_TABS, normalizeSystemTab, type SystemTab as Tab } from './lib/system-tabs'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  SYSTEM_TABS.filter((id) => {
    const perm = SYSTEM_TAB_INFO[id].permission
    if (id === 'audit-log') return isSuperuser.value
    return isSuperuser.value || (perm !== null && userPermissions.value.includes(perm))
  }).map((id) => ({ id, label: t(`settings.system.tabs.${id}`) })),
)

function resolveTab(raw: unknown): Tab {
  const normalized = normalizeSystemTab(raw)
  if (availableTabs.value.some((t) => t.id === normalized)) return normalized
  return availableTabs.value[0]?.id ?? 'file-naming'
}

const activeTab = ref<Tab>(resolveTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-system', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = resolveTab(value)
  },
)

watch(availableTabs, (tabs) => {
  if (!tabs.some((t) => t.id === activeTab.value)) {
    const fallback = tabs[0]?.id ?? 'file-naming'
    activeTab.value = fallback
    router.replace({ name: 'settings-system', query: { ...route.query, tab: fallback } })
  }
})

const tabWidths: Record<Tab, string> = {
  'file-naming': 'max-w-7xl',
  'book-dock': 'max-w-3xl',
  maintenance: 'max-w-3xl',
  'audit-log': 'max-w-7xl',
}

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-system', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.admin.system.title')" :subtitle="t('settings.admin.system.subtitle')" />

  <div
    :class="[
      tabWidths[activeTab],
      'flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x',
    ]"
  >
    <button
      v-for="tab in availableTabs"
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

  <div :class="tabWidths[activeTab]">
    <FileNamingSettings v-if="activeTab === 'file-naming'" embedded />
    <BookDockSettings v-else-if="activeTab === 'book-dock'" embedded />
    <MaintenanceSettings v-else-if="activeTab === 'maintenance'" embedded />
    <AuditLogPage v-else-if="activeTab === 'audit-log'" embedded />
  </div>
</template>
