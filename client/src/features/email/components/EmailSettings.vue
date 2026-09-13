<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Permission } from '@bookorbit/types'
import ProvidersTab from './ProvidersTab.vue'
import SettingsTabs from '@/features/settings/components/SettingsTabs.vue'
import { useRouteTab } from '@/composables/useRouteTab'
import RecipientsTab from './RecipientsTab.vue'
import GroupsTab from './GroupsTab.vue'
import TemplatesTab from './TemplatesTab.vue'
import PreferencesTab from './PreferencesTab.vue'
import HistoryTab from './HistoryTab.vue'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailTemplates } from '../composables/useEmailTemplates'
import { useEmailGroups } from '../composables/useEmailGroups'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { normalizeEmailTab, type EmailTab as Tab } from '@/features/email/lib/email-tabs'

const { t } = useI18n()
const { fetchProviders } = useEmailProviders()
const { fetchRecipients } = useEmailRecipients()
const { fetchTemplates } = useEmailTemplates()
const { fetchGroups } = useEmailGroups()
const { hasPermission } = usePermissions()

const canManageEmail = computed(() => hasPermission(Permission.ManageEmail))
const canSendEmail = computed(() => hasPermission(Permission.EmailSend))

const tabs = computed<{ id: Tab; label: string }[]>(() => {
  const result: { id: Tab; label: string }[] = []
  if (canManageEmail.value || canSendEmail.value) result.push({ id: 'providers', label: t('email.tabs.providers') })
  if (canSendEmail.value) {
    result.push(
      { id: 'recipients', label: t('email.tabs.recipients') },
      { id: 'groups', label: t('email.tabs.groups') },
      { id: 'templates', label: t('email.tabs.templates') },
      { id: 'preferences', label: t('email.tabs.preferences') },
      { id: 'history', label: t('email.tabs.history') },
    )
  }
  return result
})

const availableTabIds = computed(() => tabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<Tab>({
  routeName: 'settings-email',
  normalize: normalizeEmailTab,
  availableTabs: availableTabIds,
  fallback: 'recipients',
})

const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const fetches: Promise<unknown>[] = []
    if (canManageEmail.value || canSendEmail.value) fetches.push(fetchProviders())
    if (canSendEmail.value) fetches.push(fetchRecipients(), fetchTemplates(), fetchGroups())
    await Promise.all(fetches)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.loadFailed')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    {{ t('common.loading') }}
  </div>
  <div v-else-if="error" class="settings-error-state">{{ error }}</div>
  <template v-else>
    <SettingsTabs :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

    <ProvidersTab v-if="activeTab === 'providers'" />
    <RecipientsTab v-else-if="activeTab === 'recipients'" />
    <GroupsTab v-else-if="activeTab === 'groups'" />
    <TemplatesTab v-else-if="activeTab === 'templates'" />
    <PreferencesTab v-else-if="activeTab === 'preferences'" />
    <HistoryTab v-else-if="activeTab === 'history'" />
  </template>
</template>
