<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import UsersPage from '@/features/admin/UsersPage.vue'
import OidcSettings from './OidcSettings.vue'
import MagicLinksSettings from './MagicLinksSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { ADMIN_TAB_INFO, ADMIN_TABS, normalizeAdminTab, type AdminTab as Tab } from './lib/admin-tabs'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  ADMIN_TABS.filter((id) => {
    const perm = ADMIN_TAB_INFO[id].permission
    return isSuperuser.value || (perm !== null && userPermissions.value.includes(perm))
  }).map((id) => ({ id, label: t(`settings.admin.tabs.${id}`) })),
)

function resolveTab(raw: unknown): Tab {
  const normalized = normalizeAdminTab(raw)
  if (availableTabs.value.some((t) => t.id === normalized)) return normalized
  return availableTabs.value[0]?.id ?? 'users'
}

const activeTab = ref<Tab>(resolveTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-admin', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = resolveTab(value)
  },
)

watch(availableTabs, (tabs) => {
  if (!tabs.some((t) => t.id === activeTab.value)) {
    const fallback = tabs[0]?.id ?? 'users'
    activeTab.value = fallback
    router.replace({ name: 'settings-admin', query: { ...route.query, tab: fallback } })
  }
})

const tabWidths: Record<Tab, string> = {
  users: 'max-w-6xl',
  'magic-links': 'max-w-5xl',
  oidc: 'max-w-3xl',
}

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-admin', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.admin.title')" :subtitle="t('settings.admin.subtitle')" />

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
    <UsersPage v-if="activeTab === 'users'" embedded />
    <MagicLinksSettings v-else-if="activeTab === 'magic-links'" :with-header="false" with-embedded-create-action />
    <OidcSettings v-else-if="activeTab === 'oidc'" embedded />
  </div>
</template>
