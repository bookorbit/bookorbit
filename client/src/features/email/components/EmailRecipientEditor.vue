<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Copy, Send, ShieldCheck, Tablet, TabletSmartphone, UserRound } from '@lucide/vue'
import type { EmailRecipient, EmailRecipientForm, EmailSendLogEntry, ReadAloudDeliveryPreference } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import SettingsSection from '@/features/settings/components/SettingsSection.vue'
import type { EditorMenuAction } from '@/features/settings/lib/editor-actions'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDateTime, formatRelativeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import EmailDeliveryStatus from './EmailDeliveryStatus.vue'
import EmailSegmented, { type SegmentOption } from './EmailSegmented.vue'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailPreferences } from '../composables/useEmailPreferences'
import { fetchLogPage } from '../composables/useEmailSendLog'
import { deliveryKind } from '../lib/email-delivery'
import type { EmailProvider } from '../composables/useEmailProviders'
import type { EmailTemplate } from '../composables/useEmailTemplates'
import { formatsFor, kindleAccepts } from '../lib/email-files'
import { deviceLook } from '../lib/email-devices'

const props = defineProps<{
  open: boolean
  /** Null to add one. */
  recipient: EmailRecipient | null
  isDefault: boolean
  /** The server books go out through; its address is the one Kindle must approve. */
  provider: EmailProvider | null
  templates: EmailTemplate[]
  defaultTemplate: EmailTemplate | null
  /** Whether this server understands read-along delivery; older ones reject the field. */
  deliverySupported: boolean
}>()

const emit = defineEmits<{ 'update:open': [open: boolean]; saved: [recipient: EmailRecipient] }>()

const { t } = useI18n()
const { createRecipient, updateRecipient, deleteRecipient, sendTestEmail } = useEmailRecipients()
const { savePreferences } = useEmailPreferences()

type DeviceType = 'kindle' | 'kobo' | 'other' | null

interface Draft {
  name: string
  email: string
  deviceType: DeviceType
  preferredFormat: string | null
  readAloudDelivery: ReadAloudDeliveryPreference
  defaultTemplateId: number | null
}

const draft = reactive<Draft>(blank())
const initial = ref('')
const saving = ref(false)
const testing = ref(false)
const error = ref<string | null>(null)
/** The last few books this recipient was sent, newest first. */
const lastSends = ref<EmailSendLogEntry[]>([])

const LAST_SENDS = 3

function blank(): Draft {
  return { name: '', email: '', deviceType: 'kindle', preferredFormat: 'epub', readAloudDelivery: 'audioless_epub', defaultTemplateId: null }
}

function fromRecipient(r: EmailRecipient): Draft {
  return {
    name: r.name,
    email: r.email,
    deviceType: (r.deviceType as DeviceType) ?? null,
    preferredFormat: r.preferredFormat,
    readAloudDelivery: r.readAloudDelivery ?? null,
    defaultTemplateId: r.defaultTemplateId,
  }
}

watch(
  () => [props.open, props.recipient] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, props.recipient ? fromRecipient(props.recipient) : blank())
    initial.value = JSON.stringify(draft)
    error.value = null
    void loadLastSends()
  },
  { immediate: true },
)

/** A Kindle cannot keep narration, so moving to one drops the original choice. */
watch(
  () => draft.deviceType,
  (device) => {
    if (device === 'kindle' && draft.readAloudDelivery === 'original') draft.readAloudDelivery = 'audioless_epub'
  },
)

const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const isKindle = computed(() => draft.deviceType === 'kindle')
const title = computed(() => props.recipient?.name || t('email.editor.recipient.newTitle'))

const deviceOptions = computed<SegmentOption[]>(() => [
  { value: 'kindle', label: t('email.device.kindle'), icon: Tablet },
  { value: 'kobo', label: t('email.device.kobo'), icon: Tablet },
  { value: 'other', label: t('email.device.other'), icon: TabletSmartphone },
  { value: null, label: t('email.device.none'), icon: UserRound },
])

const formatOptions = computed<SegmentOption[]>(() => {
  const allowed = [...formatsFor(draft.deviceType)]
  // A stored format Kindle no longer takes stays visible, so saving never drops it silently.
  if (draft.preferredFormat && !allowed.includes(draft.preferredFormat)) allowed.push(draft.preferredFormat)
  return [
    { value: null, label: t('email.editor.recipient.formatPrimary') },
    ...allowed.map((format) => ({ value: format, label: format.toUpperCase() })),
  ]
})

const legacyKindleFormat = computed(() =>
  isKindle.value && draft.preferredFormat && !kindleAccepts(draft.preferredFormat) ? draft.preferredFormat.toUpperCase() : null,
)

const approveAddress = computed(() => props.provider?.fromAddress || props.provider?.username || null)

const readAlongOptions = computed(() => [
  { value: null, label: t('email.editor.recipient.readAlongAutomatic'), hint: t('email.editor.recipient.readAlongAutomaticHint'), disabled: false },
  {
    value: 'audioless_epub' as const,
    label: t('email.editor.recipient.readAlongTextOnly'),
    hint: t('email.editor.recipient.readAlongTextOnlyHint'),
    disabled: false,
  },
  {
    value: 'original' as const,
    label: t('email.editor.recipient.readAlongOriginal'),
    hint: t('email.editor.recipient.readAlongOriginalHint'),
    disabled: isKindle.value,
  },
])

const headerDevice = computed(() => (props.recipient?.deviceType ? deviceLook(props.recipient.deviceType) : null))
const headerLastSent = computed(() =>
  props.recipient?.lastSend
    ? t('email.editor.recipient.lastSent', { time: formatRelativeFromNow(new Date(props.recipient.lastSend.createdAt)) })
    : '',
)

async function loadLastSends() {
  lastSends.value = []
  const id = props.recipient?.id
  if (id === undefined || !props.recipient?.lastSend) return
  try {
    const rows = await fetchLogPage(0, LAST_SENDS, { recipientId: id })
    if (props.recipient?.id === id) lastSends.value = rows
  } catch {
    // The editor works without it; the History tab has the full log.
  }
}

const menuActions = computed<EditorMenuAction[]>(() =>
  props.recipient && !props.isDefault ? [{ id: 'make-default', label: t('email.editor.recipient.makeDefault') }] : [],
)

const canTest = computed(() => Boolean(props.recipient) && props.recipient?.deviceType !== 'kindle')

function setDevice(next: string | null) {
  const value = next as DeviceType
  draft.deviceType = value
  if (value === 'kindle' && draft.preferredFormat && !kindleAccepts(draft.preferredFormat)) draft.preferredFormat = 'epub'
}
function setFormat(value: string | null) {
  draft.preferredFormat = value
}
function setReadAlong(value: ReadAloudDeliveryPreference) {
  draft.readAloudDelivery = value
}

async function copyAddress() {
  if (approveAddress.value && (await copyToClipboard(approveAddress.value))) toast.success(t('email.page.addressCopied'))
}

function close() {
  emit('update:open', false)
}

async function handleSave() {
  if (!draft.name.trim() || !draft.email.trim()) {
    error.value = t('email.editor.recipient.required')
    return
  }
  saving.value = true
  error.value = null
  const form: EmailRecipientForm = {
    name: draft.name.trim(),
    email: draft.email.trim(),
    deviceType: draft.deviceType,
    preferredFormat: draft.preferredFormat,
    defaultTemplateId: draft.defaultTemplateId,
    ...(props.deliverySupported ? { readAloudDelivery: draft.readAloudDelivery } : {}),
  }
  try {
    const saved = props.recipient ? await updateRecipient(props.recipient.id, form) : await createRecipient(form)
    toast.success(props.recipient ? t('email.recipients.updated') : t('email.recipients.created'))
    emit('saved', saved)
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.saveFailed')
  } finally {
    saving.value = false
  }
}

async function handleRemove() {
  if (!props.recipient) return
  saving.value = true
  try {
    await deleteRecipient(props.recipient.id)
    toast.success(t('email.recipients.deleted', { name: props.recipient.name }))
    close()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.deleteFailed'))
  } finally {
    saving.value = false
  }
}

async function handleAction(id: string) {
  if (id !== 'make-default' || !props.recipient) return
  try {
    await savePreferences({ defaultRecipientId: props.recipient.id })
    toast.success(t('email.route.defaultSaved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.setDefaultFailed'))
  }
}

async function handleTest() {
  if (!props.recipient || dirty.value) return
  testing.value = true
  try {
    const name = props.recipient.name
    const result = await sendTestEmail(props.recipient.id, t('email.editor.recipient.testSubject'), t('email.editor.recipient.testBody', { name }))
    if (result.success) toast.success(t('email.editor.recipient.testSent', { name }))
    else toast.error(t('email.editor.recipient.testFailed', { error: result.error ?? '' }))
  } catch (e) {
    toast.error(t('email.editor.recipient.testFailed', { error: e instanceof Error ? e.message : '' }))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="t('email.editor.recipient.description')"
    :dirty="dirty"
    :busy="saving"
    :removable="recipient !== null"
    :remove-label="t('email.editor.recipient.remove')"
    :remove-confirm="t('email.editor.recipient.removeConfirm', { name: recipient?.name ?? '' })"
    :remove-consequence="isDefault ? t('email.editor.recipient.removeDefaultConsequence') : t('email.editor.recipient.removeConsequence')"
    :menu-actions="menuActions"
    @save="handleSave"
    @cancel="close"
    @remove="handleRemove"
    @action="handleAction"
  >
    <template #badge>
      <span v-if="isDefault" class="rounded-xs bg-primary/15 px-1.5 text-[10px] leading-[18px] font-semibold text-primary">{{
        t('email.badge.default')
      }}</span>
    </template>
    <template #status>
      <p v-if="headerDevice || headerLastSent" class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <span v-if="headerDevice" class="inline-flex items-center gap-1">
          <component :is="headerDevice.icon" :size="13" aria-hidden="true" />{{ t(`email.device.${headerDevice.labelKey}`) }}
        </span>
        <span v-if="headerDevice && headerLastSent" aria-hidden="true">·</span>
        <span v-if="headerLastSent">{{ headerLastSent }}</span>
      </p>
    </template>
    <template #actions>
      <Button
        v-if="canTest"
        variant="outline"
        size="sm"
        :disabled="testing || dirty"
        :title="dirty ? t('email.editor.server.testDirty') : undefined"
        @click="handleTest"
      >
        <Send :size="14" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t('email.editor.recipient.sendTest') }}</span>
      </Button>
    </template>

    <SettingsSection :title="t('email.editor.recipient.sectionRecipient')">
      <div class="grid gap-4 sm:grid-cols-2">
        <SettingsField :label="t('email.editor.recipient.name')" input-id="email-recipient-name" required>
          <input
            id="email-recipient-name"
            v-model="draft.name"
            type="text"
            class="settings-control"
            autocomplete="off"
            :placeholder="t('email.recipients.namePlaceholder')"
          />
        </SettingsField>
        <SettingsField :label="t('email.editor.recipient.email')" input-id="email-recipient-address" required>
          <input
            id="email-recipient-address"
            v-model="draft.email"
            type="email"
            dir="ltr"
            class="settings-control font-mono text-[13px]"
            autocomplete="off"
            placeholder="name@kindle.com"
          />
        </SettingsField>
      </div>
      <div class="flex flex-col gap-1.5">
        <span id="email-recipient-device-label" class="settings-label">{{ t('email.editor.recipient.device') }}</span>
        <EmailSegmented
          :model-value="draft.deviceType"
          :options="deviceOptions"
          :label="t('email.editor.recipient.device')"
          @update:model-value="setDevice"
        />
        <i18n-t keypath="email.editor.recipient.deviceHint" tag="p" class="text-xs text-muted-foreground" scope="global">
          <template #subject
            ><b class="font-semibold text-foreground">{{ t('email.editor.kindleSubject') }}</b></template
          >
        </i18n-t>
      </div>
      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    </SettingsSection>

    <div v-if="isKindle" class="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <ShieldCheck :size="16" class="mt-0.5 text-primary" aria-hidden="true" />
      <p class="text-sm font-semibold text-foreground">{{ t('email.editor.recipient.approveTitle') }}</p>
      <i18n-t
        v-if="approveAddress"
        keypath="email.editor.recipient.approveBody"
        tag="p"
        class="col-start-2 text-[12.5px] leading-relaxed text-muted-foreground"
        scope="global"
      >
        <template #path
          ><b class="font-semibold text-foreground">{{ t('email.editor.recipient.approvePath') }}</b></template
        >
        <template #address>
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/6 py-px ps-[7px] pe-1 align-middle font-mono text-xs text-foreground"
            dir="ltr"
          >
            {{ approveAddress }}
            <button
              type="button"
              class="inline-flex rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              :aria-label="t('email.page.copyAddress')"
              @click="copyAddress"
            >
              <Copy :size="13" aria-hidden="true" />
            </button>
          </span>
        </template>
      </i18n-t>
      <p v-else class="col-start-2 text-[12.5px] text-muted-foreground">{{ t('email.editor.recipient.approveNoServer') }}</p>
    </div>

    <SettingsSection :title="t('email.editor.recipient.sectionReceives')">
      <div class="flex flex-col gap-1.5">
        <span class="settings-label">{{ t('email.editor.recipient.format') }}</span>
        <EmailSegmented
          :model-value="draft.preferredFormat"
          :options="formatOptions"
          :label="t('email.editor.recipient.format')"
          @update:model-value="setFormat"
        />
        <p v-if="legacyKindleFormat" role="alert" class="text-xs text-[var(--pill-warning)]">
          {{ t('email.editor.recipient.kindleLegacyFormat', { format: legacyKindleFormat }) }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ isKindle ? t('email.editor.recipient.kindleFormatHint') : t('email.editor.recipient.formatHint') }}
        </p>
      </div>

      <fieldset v-if="deliverySupported" class="flex flex-col gap-1.5">
        <legend class="settings-label mb-1.5">{{ t('email.editor.recipient.readAlong') }}</legend>
        <div class="grid gap-1.5">
          <label
            v-for="option in readAlongOptions"
            :key="option.value ?? 'automatic'"
            class="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-px rounded-[9px] border px-[11px] py-[9px] transition-colors"
            :class="[
              draft.readAloudDelivery === option.value ? 'border-primary/55 bg-primary/7' : 'border-border',
              option.disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-foreground/[0.025]',
            ]"
          >
            <input
              type="radio"
              name="email-recipient-read-along"
              class="mt-0.5 size-4 accent-[var(--primary)]"
              :checked="draft.readAloudDelivery === option.value"
              :disabled="option.disabled"
              @change="setReadAlong(option.value)"
            />
            <span class="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
              {{ option.label }}
              <span v-if="option.disabled" class="rounded-xs bg-muted px-1.5 text-[10px] leading-[18px] font-semibold text-muted-foreground">{{
                t('email.editor.recipient.notForKindle')
              }}</span>
            </span>
            <span class="col-start-2 text-xs leading-normal text-muted-foreground">{{ option.hint }}</span>
          </label>
        </div>
      </fieldset>

      <SettingsField
        :label="t('email.editor.recipient.template')"
        input-id="email-recipient-template"
        :brief="isKindle ? t('email.editor.recipient.templateKindleHint') : undefined"
      >
        <template #default="{ describedBy }">
          <select id="email-recipient-template" v-model="draft.defaultTemplateId" class="settings-control" :aria-describedby="describedBy">
            <option :value="null">{{ t('email.editor.recipient.templateDefault', { name: defaultTemplate?.name ?? '' }) }}</option>
            <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
          </select>
        </template>
      </SettingsField>
    </SettingsSection>

    <SettingsSection v-if="lastSends.length > 0" :title="t('email.editor.recipient.sectionLastSent')">
      <ul class="settings-card">
        <li v-for="entry in lastSends" :key="entry.id" class="flex min-h-[52px] items-center gap-3.5 px-3 py-2">
          <BookCoverImage
            v-if="entry.bookId !== null"
            :book-id="entry.bookId"
            class="h-[42px] w-7 shrink-0 rounded-[3px] bg-muted object-cover shadow-xs ring-1 ring-foreground/10"
          />
          <span v-else class="h-[42px] w-7 shrink-0 rounded-[3px] bg-muted" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] leading-[1.45] font-medium text-foreground">{{
              entry.bookTitle ?? t('email.recent.deletedBook')
            }}</span>
            <span class="mt-[3px] flex items-center gap-1.5 text-xs leading-[1.45] tabular-nums text-muted-foreground">
              <BookFormatChip
                v-if="entry.fileFormat"
                :format-key="entry.fileFormat"
                class="rounded-[5px] px-1.5 py-0 text-[11px] leading-[17px] tracking-[0.02em]"
              />
              {{ entry.fileSizeBytes ? formatBytes(entry.fileSizeBytes) : '' }}
            </span>
          </span>
          <EmailDeliveryStatus v-if="deliveryKind(entry) !== 'sent'" :entry="entry" />
          <span class="w-[84px] shrink-0 text-end text-xs text-muted-foreground" :title="formatDateTime(new Date(entry.createdAt))">
            {{ formatRelativeFromNow(new Date(entry.createdAt)) }}
          </span>
        </li>
      </ul>
    </SettingsSection>
  </SettingsEditorSheet>
</template>
