<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Permission } from '@bookorbit/types'
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

const route = useRoute()
const router = useRouter()

function resolveTab(value: unknown): Tab {
  const normalized = normalizeEmailTab(value)
  if (tabs.value.some((t) => t.id === normalized)) return normalized
  return tabs.value[0]?.id ?? 'recipients'
}

const activeTab = ref<Tab>(resolveTab(route.query.tab))

if (!route.query.tab) {
  router.replace({ name: 'settings-email', query: { ...route.query, tab: activeTab.value } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = resolveTab(value)
  },
)

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-email', query: { ...route.query, tab } })
}

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
  <SettingsPageHeader class="hidden md:flex" :title="t('email.title')" :subtitle="t('email.subtitle')" />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('email.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('email.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">{{ t('common.loading') }}</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- Tab bar -->
    <div
      class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
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
