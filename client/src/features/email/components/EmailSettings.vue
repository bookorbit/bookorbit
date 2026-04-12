<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Permission } from '@projectx/types'
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
import { EMAIL_TAB_LABELS, normalizeEmailTab, type EmailTab as Tab } from '@/features/email/lib/email-tabs'

const { fetchProviders } = useEmailProviders()
const { fetchRecipients } = useEmailRecipients()
const { fetchTemplates } = useEmailTemplates()
const { fetchGroups } = useEmailGroups()
const { hasPermission } = usePermissions()

const canManageEmail = computed(() => hasPermission(Permission.ManageEmail))
const canSendEmail = computed(() => hasPermission(Permission.EmailSend))

const tabs = computed<{ id: Tab; label: string }[]>(() => {
  const result: { id: Tab; label: string }[] = []
  if (canManageEmail.value || canSendEmail.value) result.push({ id: 'providers', label: EMAIL_TAB_LABELS['providers'] })
  if (canSendEmail.value) {
    result.push(
      { id: 'recipients', label: EMAIL_TAB_LABELS['recipients'] },
      { id: 'groups', label: EMAIL_TAB_LABELS['groups'] },
      { id: 'templates', label: EMAIL_TAB_LABELS['templates'] },
      { id: 'preferences', label: EMAIL_TAB_LABELS['preferences'] },
      { id: 'history', label: EMAIL_TAB_LABELS['history'] },
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
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="Email" subtitle="Send books to your e-reader via email." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Email</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Send books to your e-reader via email.
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">Loading...</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- Tab bar -->
    <div
      class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-[5.25rem] z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
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
