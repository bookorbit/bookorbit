<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ReaderSettings from './ReaderSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'

type Tab = 'general' | 'ebook' | 'pdf' | 'comics'

const route = useRoute()
const router = useRouter()

function normalizeTab(value: unknown): Tab {
  if (value === 'general' || value === 'ebook' || value === 'pdf' || value === 'comics') return value
  return 'ebook'
}

const activeTab = ref<Tab>(normalizeTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-reader-general', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeTab(value)
  },
)

const tabs: { id: Tab; label: string }[] = [
  { id: 'ebook', label: 'eBook' },
  { id: 'pdf', label: 'PDF' },
  { id: 'comics', label: 'Comics' },
  { id: 'general', label: 'General' },
]

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-reader-general', query: { ...route.query, tab } })
}
</script>

<template>
  <SettingsPageHeader title="Reader" subtitle="Configure defaults for all reading modes in one place." />

  <div class="flex gap-1 mb-6 border-b border-border overflow-x-auto">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="px-3 py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors"
      :class="
        activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      "
      @click="selectTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>

  <ReaderSettings v-if="activeTab === 'general'" embedded />
  <EbookSettings v-else-if="activeTab === 'ebook'" embedded />
  <PdfSettings v-else-if="activeTab === 'pdf'" embedded />
  <ComicsSettings v-else-if="activeTab === 'comics'" embedded />
</template>
