<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProvidersTab from './ProvidersTab.vue'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import RecipientsTab from './RecipientsTab.vue'
import GroupsTab from './GroupsTab.vue'
import TemplatesTab from './TemplatesTab.vue'
import PreferencesTab from './PreferencesTab.vue'
import HistoryTab from './HistoryTab.vue'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailTemplates } from '../composables/useEmailTemplates'
import { useEmailGroups } from '../composables/useEmailGroups'
import { EMAIL_TAB_LABELS, EMAIL_TABS, normalizeEmailTab, type EmailTab as Tab } from '@/features/email/lib/email-tabs'

const { fetchProviders } = useEmailProviders()
const { fetchRecipients } = useEmailRecipients()
const { fetchTemplates } = useEmailTemplates()
const { fetchGroups } = useEmailGroups()

const route = useRoute()
const router = useRouter()
const activeTab = ref<Tab>(normalizeEmailTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-email', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeEmailTab(value)
  },
)

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-email', query: { ...route.query, tab } })
}

const loading = ref(true)
const error = ref<string | null>(null)

const tabs: { id: Tab; label: string }[] = EMAIL_TABS.map((id) => ({ id, label: EMAIL_TAB_LABELS[id] }))

onMounted(async () => {
  try {
    await Promise.all([fetchProviders(), fetchRecipients(), fetchTemplates(), fetchGroups()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <SettingsPageHeader title="Email" subtitle="Send books to your e-reader via email." />

  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- Tab bar -->
    <div class="flex gap-1 mb-6 border-b border-border overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-3 py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors"
        :class="
          activeTab === tab.id
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        "
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <ProvidersTab v-if="activeTab === 'providers'" />
    <RecipientsTab v-else-if="activeTab === 'recipients'" />
    <GroupsTab v-else-if="activeTab === 'groups'" />
    <TemplatesTab v-else-if="activeTab === 'templates'" />
    <PreferencesTab v-else-if="activeTab === 'preferences'" />
    <HistoryTab v-else-if="activeTab === 'history'" />
  </template>
</template>
