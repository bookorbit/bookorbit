<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AccountSettings from './AccountSettings.vue'
import NotificationPreferences from '@/features/notifications/components/NotificationPreferences.vue'
import ContentRestrictionsSettings from './ContentRestrictionsSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { ACCOUNT_TABS, normalizeAccountTab, type AccountTab as Tab } from './lib/account-tabs'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isDemoRestrictedAccount } = usePermissions()

const availableTabs = computed(() =>
  ACCOUNT_TABS.filter((id) => {
    if (id === 'notifications') return !isDemoRestrictedAccount.value
    return true
  }).map((id) => ({ id, label: t(`settings.account.tabs.${id}`) })),
)

function resolveTab(raw: unknown): Tab {
  const normalized = normalizeAccountTab(raw)
  if (availableTabs.value.some((t) => t.id === normalized)) return normalized
  return 'profile'
}

const activeTab = ref<Tab>(resolveTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-account', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = resolveTab(value)
  },
)

watch(isDemoRestrictedAccount, () => {
  if (activeTab.value === 'notifications' && isDemoRestrictedAccount.value) {
    activeTab.value = 'profile'
    router.replace({ name: 'settings-account', query: { ...route.query, tab: 'profile' } })
  }
})

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-account', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader :title="t('settings.account.title')" :subtitle="t('settings.account.subtitleAll')" />

  <div
    class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
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

  <AccountSettings v-if="activeTab === 'profile'" embedded />
  <NotificationPreferences v-else-if="activeTab === 'notifications'" embedded />
  <ContentRestrictionsSettings v-else-if="activeTab === 'restrictions'" />
</template>
