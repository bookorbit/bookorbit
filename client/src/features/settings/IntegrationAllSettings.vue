<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import HardcoverSettings from '@/features/hardcover/components/HardcoverSettings.vue'
import ReadwiseSettings from '@/features/readwise/components/ReadwiseSettings.vue'
import StorygraphSettings from '@/features/storygraph/components/StorygraphSettings.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { INTEGRATION_TAB_INFO, INTEGRATION_TABS, normalizeIntegrationTab, type IntegrationTab as Tab } from './lib/integration-tabs'

const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

const availableTabs = computed(() =>
  INTEGRATION_TABS.filter((id) => isSuperuser.value || userPermissions.value.includes(INTEGRATION_TAB_INFO[id].permission)).map((id) => ({
    id,
    label: INTEGRATION_TAB_INFO[id].navLabel,
  })),
)

function resolveTab(raw: unknown): Tab {
  const normalized = normalizeIntegrationTab(raw)
  if (availableTabs.value.some((tab) => tab.id === normalized)) return normalized
  return availableTabs.value[0]?.id ?? 'hardcover'
}

const activeTab = ref<Tab>(resolveTab(route.query.tab))

if (!route.query.tab && availableTabs.value.length > 0) {
  router.replace({ name: 'settings-integrations', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = resolveTab(value)
  },
)

watch(availableTabs, (tabs) => {
  if (!tabs.some((tab) => tab.id === activeTab.value)) {
    const fallback = tabs[0]?.id ?? 'hardcover'
    activeTab.value = fallback
    if (tabs.length > 0) {
      router.replace({ name: 'settings-integrations', query: { ...route.query, tab: fallback } })
    }
  }
})

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-integrations', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader title="Integrations" subtitle="Connect external services to sync your reading data and highlights." />

  <div
    v-if="availableTabs.length > 0"
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

  <HardcoverSettings v-if="activeTab === 'hardcover' && availableTabs.length > 0" embedded />
  <ReadwiseSettings v-else-if="activeTab === 'readwise' && availableTabs.length > 0" embedded />
  <StorygraphSettings v-else-if="activeTab === 'storygraph' && availableTabs.length > 0" embedded />
  <div v-else class="rounded-lg border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
    You do not have permission to use any integrations.
  </div>
</template>
