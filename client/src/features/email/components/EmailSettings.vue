<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Server, TriangleAlert, X } from '@lucide/vue'
import { Permission, type EmailRecipient } from '@bookorbit/types'

import SettingsTabs from '@/features/settings/components/SettingsTabs.vue'
import { useRouteTab } from '@/composables/useRouteTab'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useReadAloudDelivery } from '@/features/delivery/composables/useReadAloudDelivery'
import { formatRelativeFromNow } from '@/i18n/formatters'
import EmailAttentionBand, { type AttentionItem } from './EmailAttentionBand.vue'
import EmailGroupEditor from './EmailGroupEditor.vue'
import EmailHistoryTab from './EmailHistoryTab.vue'
import EmailRecipientEditor from './EmailRecipientEditor.vue'
import EmailRecipientsTab from './EmailRecipientsTab.vue'
import EmailServerEditor from './EmailServerEditor.vue'
import EmailServersTab from './EmailServersTab.vue'
import EmailTemplateEditor, { type PreviewBook } from './EmailTemplateEditor.vue'
import EmailTemplatesTab from './EmailTemplatesTab.vue'
import { useDeliveryWords } from '../composables/useDeliveryWords'
import { useEmailGroups, type EmailGroup } from '../composables/useEmailGroups'
import { useEmailPreferences, type EmailDefaultsPatch } from '../composables/useEmailPreferences'
import { useEmailProviders, type EmailProvider } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailSendLog } from '../composables/useEmailSendLog'
import { useEmailTemplates, type EmailTemplate } from '../composables/useEmailTemplates'
import { deliveryReason } from '../lib/email-delivery'
import { normalizeEmailTab, type EmailTab } from '../lib/email-tabs'

const { t } = useI18n()
const { user } = useAuth()
const { hasPermission, isSuperuser } = usePermissions()
const { supported: deliverySupported } = useReadAloudDelivery()
const { providers, fetchProviders, testProvider } = useEmailProviders()
const { recipients, fetchRecipients } = useEmailRecipients()
const { templates, fetchTemplates } = useEmailTemplates()
const { groups, fetchGroups } = useEmailGroups()
const { preferences, fetchPreferences, savePreferences } = useEmailPreferences()
const { recent, attention, summary, fetchRecent, fetchAttention, fetchSummary, resendEntry } = useEmailSendLog()
const { lead } = useDeliveryWords()

const canSend = computed(() => hasPermission(Permission.EmailSend))
const canManage = computed(() => hasPermission(Permission.ManageEmail))

const tabs = computed<{ id: EmailTab; label: string; count?: number }[]>(() => {
  if (!canSend.value) return canManage.value ? [{ id: 'servers', label: t('email.tabs.servers') }] : []
  return [
    { id: 'recipients', label: t('email.tabs.recipients'), count: recipients.value.length },
    { id: 'servers', label: t('email.tabs.servers'), count: providers.value.length },
    { id: 'templates', label: t('email.tabs.templates'), count: templates.value.length },
    { id: 'history', label: t('email.tabs.history') },
  ]
})
const tabIds = computed(() => tabs.value.map((tab) => tab.id))
const { activeTab, selectTab } = useRouteTab<EmailTab>({
  routeName: 'settings-email',
  normalize: normalizeEmailTab,
  availableTabs: tabIds,
  fallback: 'recipients',
})

const loading = ref(true)
const error = ref<string | null>(null)
const savingDefault = ref(false)
const busyAttention = ref<string | null>(null)
const testingId = ref<number | null>(null)

onMounted(async () => {
  try {
    const fetches: Promise<unknown>[] = [fetchProviders()]
    if (canSend.value) fetches.push(fetchRecipients(), fetchTemplates(), fetchGroups(), fetchPreferences(), refreshLog())
    await Promise.all(fetches)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.loadFailed')
  } finally {
    loading.value = false
  }
})

function refreshLog() {
  return Promise.all([fetchRecent(), fetchAttention(), fetchSummary()])
}
function refreshAfterSend() {
  void Promise.all([refreshLog(), fetchRecipients()])
}

/* ── the defaults, as the server resolves them; every star writes the same preference ── */
const defaultProviderId = computed(() => preferences.value?.defaultProviderId ?? null)
const defaultRecipientId = computed(() => preferences.value?.defaultRecipientId ?? null)
const systemTemplate = computed(() => templates.value.find((tpl) => tpl.isSystem) ?? null)
const defaultTemplate = computed(() => templates.value.find((tpl) => tpl.id === preferences.value?.defaultTemplateId) ?? systemTemplate.value)
const defaultProvider = computed(() => providers.value.find((p) => p.id === defaultProviderId.value) ?? null)
const defaultRecipient = computed(() => recipients.value.find((r) => r.id === defaultRecipientId.value) ?? null)
const senderAddress = computed(() => defaultProvider.value?.fromAddress || defaultProvider.value?.username || null)

async function saveDefault(patch: EmailDefaultsPatch) {
  savingDefault.value = true
  try {
    await savePreferences(patch)
    toast.success(t('email.route.defaultSaved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.setDefaultFailed'))
  } finally {
    savingDefault.value = false
  }
}
function makeRecipientDefault(recipient: EmailRecipient) {
  void saveDefault({ defaultRecipientId: recipient.id })
}
function makeServerDefault(provider: EmailProvider) {
  void saveDefault({ defaultProviderId: provider.id })
}
function makeTemplateDefault(template: EmailTemplate) {
  void saveDefault({ defaultTemplateId: template.id })
}

async function testServer(provider: EmailProvider) {
  testingId.value = provider.id
  try {
    const result = await testProvider(provider.id)
    if (result.success) toast.success(t('email.page.testOk', { name: provider.name }))
    else toast.error(t('email.page.testFailed', { name: provider.name }), { description: result.error })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.providers.testFailed'))
  } finally {
    testingId.value = null
  }
}

/* ── the attention band: failing servers the user can fix, and failed sends nothing replaced ── */
const providerById = computed(() => new Map(providers.value.map((p) => [p.id, p])))
const recipientById = computed(() => new Map(recipients.value.map((r) => [r.id, r])))

const attentionItems = computed<AttentionItem[]>(() => {
  if (!canSend.value) return []
  const items: AttentionItem[] = []
  for (const p of providers.value) {
    if (p.lastTestOk !== false || !canManage.value || p.userId !== user.value?.id) continue
    items.push({
      id: `server-${p.id}`,
      tone: 'err',
      icon: Server,
      keypath: 'email.attention.serverDown',
      slots: { name: { text: p.name, strong: true } },
      detailCode: p.lastTestError ?? undefined,
      detail: p.lastTestedAt ? t('email.attention.testedAgo', { time: formatRelativeFromNow(new Date(p.lastTestedAt)) }) : '',
      actionLabel: t('email.attention.editServer'),
    })
  }
  for (const entry of attention.value) {
    const provider = entry.providerId ? providerById.value.get(entry.providerId) : undefined
    const unconfirmed = deliveryReason(entry) === 'unconfirmed' || deliveryReason(entry) === 'interrupted'
    const tooLarge = deliveryReason(entry) === 'tooLarge' && recipientById.value.has(entry.recipientId ?? -1)
    items.push({
      id: `send-${entry.id}`,
      tone: unconfirmed ? 'warn' : 'err',
      icon: unconfirmed ? TriangleAlert : X,
      keypath: unconfirmed ? 'email.attention.maybeDelivered' : 'email.attention.notDelivered',
      slots: { book: { text: entry.bookTitle ?? t('email.recent.deletedBook'), strong: true }, recipient: { text: entry.toName || entry.toEmail } },
      detail: `${lead(entry, provider?.name, provider?.host)} · ${formatRelativeFromNow(new Date(entry.createdAt))}`,
      actionLabel: tooLarge ? t('email.attention.editRecipient') : t('email.attention.resend'),
    })
  }
  return items
})
/** History lists the same problems under its own filter, so the band steps aside there. */
const showAttention = computed(() => attentionItems.value.length > 0 && activeTab.value !== 'history')

async function actOnAttention(item: AttentionItem) {
  if (item.id.startsWith('server-')) {
    const provider = providerById.value.get(Number(item.id.slice(7)))
    if (provider) openServer(provider)
    return
  }
  const entry = attention.value.find((e) => `send-${e.id}` === item.id)
  if (!entry) return
  if (deliveryReason(entry) === 'tooLarge') {
    const recipient = recipientById.value.get(entry.recipientId ?? -1)
    if (recipient) return openRecipient(recipient)
  }
  busyAttention.value = item.id
  try {
    await resendEntry(entry.id)
    toast.success(t('email.history.queuedForResend'))
    refreshAfterSend()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.history.resendFailed'))
  } finally {
    busyAttention.value = null
  }
}

/* ── editors ── */
type Editor = 'recipient' | 'server' | 'template' | 'group' | null
const editor = ref<Editor>(null)
const editingRecipient = ref<EmailRecipient | null>(null)
const editingServer = ref<EmailProvider | null>(null)
const editingTemplate = ref<EmailTemplate | null>(null)
const editingGroup = ref<EmailGroup | null>(null)

function openRecipient(recipient: EmailRecipient | null) {
  editingRecipient.value = recipient
  editor.value = 'recipient'
}
function openServer(provider: EmailProvider | null) {
  editingServer.value = provider
  editor.value = 'server'
}
function openTemplate(template: EmailTemplate | null) {
  editingTemplate.value = template
  editor.value = 'template'
}
function openGroup(group: EmailGroup | null) {
  editingGroup.value = group
  editor.value = 'group'
}
function addRecipient() {
  openRecipient(null)
}
function addServer() {
  openServer(null)
}
function addTemplate() {
  openTemplate(null)
}
function addGroup() {
  openGroup(null)
}
function goToServers() {
  selectTab('servers')
}
function closeEditor(open: boolean) {
  if (!open) editor.value = null
}
function refreshAfterRecipientChange() {
  void Promise.all([fetchRecipients(), fetchPreferences(), fetchGroups()])
}
function refreshAfterProviderChange() {
  void Promise.all([fetchProviders(), fetchPreferences()])
}
function refreshTemplates() {
  void Promise.all([fetchTemplates(), fetchPreferences()])
}
function refreshGroups() {
  void fetchGroups()
}

/** A Kindle never shows the message, so the preview is addressed to the first recipient who reads it. */
const previewRecipient = computed(() =>
  defaultRecipient.value && defaultRecipient.value.deviceType !== 'kindle'
    ? defaultRecipient.value
    : (recipients.value.find((r) => r.deviceType !== 'kindle') ?? null),
)

/** Books the template editor can preview with: the ones most recently sent. */
const previewBooks = computed<PreviewBook[]>(() => {
  const seen = new Set<number>()
  const out: PreviewBook[] = []
  for (const entry of recent.value) {
    if (entry.bookId === null || !entry.bookTitle || seen.has(entry.bookId)) continue
    seen.add(entry.bookId)
    out.push({ id: entry.bookId, title: entry.bookTitle })
  }
  return out
})
</script>

<template>
  <p v-if="loading" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>
  <p v-else-if="error" role="alert" class="settings-error-state">{{ error }}</p>

  <template v-else>
    <EmailAttentionBand v-if="showAttention" class="mb-5" :items="attentionItems" :busy-id="busyAttention" @act="actOnAttention" />

    <SettingsTabs :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

    <EmailRecipientsTab
      v-if="activeTab === 'recipients'"
      :recipients="recipients"
      :groups="groups"
      :default-recipient-id="defaultRecipientId"
      :sender-address="senderAddress"
      :has-server="providers.length > 0"
      :can-manage-servers="canManage"
      :busy="savingDefault"
      @add="addRecipient"
      @edit="openRecipient"
      @make-default="makeRecipientDefault"
      @add-group="addGroup"
      @edit-group="openGroup"
      @go-to-servers="goToServers"
    />
    <EmailServersTab
      v-else-if="activeTab === 'servers'"
      :providers="providers"
      :default-provider-id="defaultProviderId"
      :can-manage="canManage"
      :can-pick-default="canSend"
      :user-id="user?.id ?? null"
      :busy="savingDefault"
      :testing-id="testingId"
      @add="addServer"
      @edit="openServer"
      @make-default="makeServerDefault"
      @test="testServer"
    />
    <EmailTemplatesTab
      v-else-if="activeTab === 'templates'"
      :templates="templates"
      :default-template-id="defaultTemplate?.id ?? null"
      :busy="savingDefault"
      @add="addTemplate"
      @edit="openTemplate"
      @make-default="makeTemplateDefault"
    />
    <EmailHistoryTab
      v-else-if="activeTab === 'history'"
      :summary="summary"
      :recipients="recipients"
      :providers="providers"
      @changed="refreshAfterSend"
    />
  </template>

  <EmailRecipientEditor
    :open="editor === 'recipient'"
    :recipient="editingRecipient"
    :is-default="editingRecipient !== null && editingRecipient.id === defaultRecipientId"
    :provider="defaultProvider"
    :templates="templates"
    :default-template="defaultTemplate"
    :delivery-supported="deliverySupported"
    @update:open="closeEditor"
    @saved="refreshAfterRecipientChange"
  />
  <EmailServerEditor
    :open="editor === 'server'"
    :provider="editingServer"
    :is-default="editingServer !== null && editingServer.id === defaultProviderId"
    :is-superuser="isSuperuser"
    @update:open="closeEditor"
    @saved="refreshAfterProviderChange"
  />
  <EmailTemplateEditor
    :open="editor === 'template'"
    :template="editingTemplate"
    :is-default="editingTemplate !== null && editingTemplate.id === defaultTemplate?.id"
    :is-superuser="isSuperuser"
    :preview-books="previewBooks"
    :preview-recipient="previewRecipient"
    :starter="systemTemplate"
    @update:open="closeEditor"
    @saved="refreshTemplates"
  />
  <EmailGroupEditor :open="editor === 'group'" :group="editingGroup" :recipients="recipients" @update:open="closeEditor" @saved="refreshGroups" />
</template>
