<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import KoboSettings from './KoboSettings.vue'
import KoreaderSettings from './KoreaderSettings.vue'
import HardcoverSettings from '@/features/hardcover/components/HardcoverSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { INTEGRATIONS_TAB_INFO, INTEGRATIONS_TABS, normalizeIntegrationsTab, type IntegrationsTab as Tab } from './lib/integrations-tabs'

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

const allowedTabs = computed<Tab[]>(() => INTEGRATIONS_TABS.filter((tab) => hasPermission(INTEGRATIONS_TAB_INFO[tab].permission)))
const activeTab = ref<Tab>(normalizeIntegrationsTab(route.query.tab, allowedTabs.value))

watch(
  [() => route.query.tab, allowedTabs],
  ([value, tabs]) => {
    if (tabs.length === 0) {
      router.replace({ name: 'settings-appearance' })
      return
    }
    const normalized = normalizeIntegrationsTab(value, tabs)
    activeTab.value = normalized
    if (value !== normalized) {
      router.replace({ name: 'settings-integrations', query: { ...route.query, tab: normalized } })
    }
  },
  { immediate: true },
)

const tabs = computed(() => allowedTabs.value.map((id) => ({ id, label: INTEGRATIONS_TAB_INFO[id].navLabel })))

function selectTab(tab: Tab) {
  if (!allowedTabs.value.includes(tab)) return
  activeTab.value = tab
  router.replace({ name: 'settings-integrations', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader title="Integrations" subtitle="Configure connections to external devices and services." />

  <div
    v-if="tabs.length > 0"
    class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
  >
    <button
      v-for="tab in tabs"
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

  <KoboSettings v-if="tabs.length > 0 && activeTab === 'kobo'" embedded />
  <KoreaderSettings v-else-if="tabs.length > 0 && activeTab === 'koreader'" embedded />
  <HardcoverSettings v-else-if="tabs.length > 0 && activeTab === 'hardcover'" embedded />
</template>
