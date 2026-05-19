<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import KoboSettings from './KoboSettings.vue'
import KoreaderSettings from './KoreaderSettings.vue'
import HardcoverSettings from '@/features/hardcover/components/HardcoverSettings.vue'
import { INTEGRATIONS_TAB_INFO, INTEGRATIONS_TABS, normalizeIntegrationsTab, type IntegrationsTab as Tab } from './lib/integrations-tabs'

const route = useRoute()
const router = useRouter()

const activeTab = ref<Tab>(normalizeIntegrationsTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-integrations', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeIntegrationsTab(value)
  },
)

const tabs = INTEGRATIONS_TABS.map((id) => ({ id, label: INTEGRATIONS_TAB_INFO[id].navLabel }))

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-integrations', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader title="Integrations" subtitle="Configure connections to external devices and services." />

  <div
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

  <KoboSettings v-if="activeTab === 'kobo'" embedded />
  <KoreaderSettings v-else-if="activeTab === 'koreader'" embedded />
  <HardcoverSettings v-else-if="activeTab === 'hardcover'" embedded />
</template>
