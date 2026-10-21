<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Check, ChevronDown, Loader2, Send, Settings, TriangleAlert, X } from '@lucide/vue'
import { Permission, type BookFileRef, type BookSelectionPayload, type EmailRecipient, type EmailSendLogEntry } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import UserAvatar from '@/components/UserAvatar.vue'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { fileFormatKey } from '@/features/book/lib/book-formats'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatBytes } from '@/lib/formatting'
import { formatRelativeFromNow } from '@/i18n/formatters'
import EmailDeliveryStatus from './EmailDeliveryStatus.vue'
import EmailTile from './EmailTile.vue'
import { useDeliveryWords } from '../composables/useDeliveryWords'
import { useEmailGroups, type EmailGroup } from '../composables/useEmailGroups'
import { useEmailPreferences } from '../composables/useEmailPreferences'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailSend } from '../composables/useEmailSend'
import { fetchLogPage } from '../composables/useEmailSendLog'
import { useEmailTemplates } from '../composables/useEmailTemplates'
import { deliveryKind } from '../lib/email-delivery'
import { deviceLook } from '../lib/email-devices'
import { kindleAccepts, planFile, sendableFiles, sizeLimitExceeded } from '../lib/email-files'

const props = defineProps<{
  open: boolean
  selectionPayload: BookSelectionPayload
  selectedCount?: number
  bookFiles?: BookFileRef[]
  bookTitle?: string
  bookAuthors?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: []
}>()

const POLL_MS = 1500
const POLL_LIMIT_MS = 60_000

const { t } = useI18n()
const router = useRouter()
const { hasPermission } = usePermissions()
const { providers, fetchProviders } = useEmailProviders()
const { recipients, fetchRecipients } = useEmailRecipients()
const { groups, fetchGroups } = useEmailGroups()
const { templates, fetchTemplates } = useEmailTemplates()
const { preferences, fetchPreferences } = useEmailPreferences()
const { sendBook } = useEmailSend()
const { lead } = useDeliveryWords()

const selectedIds = ref<number[]>([])
const providerId = ref<number | null>(null)
const templateId = ref<number | null>(null)
const chosenFormat = ref<string | null>(null)
const optionsOpen = ref(false)
const sending = ref(false)
const loaded = ref(false)
/** Set once a single book went out: the sheet then follows each email until it settles. */
const sentAt = ref<number | null>(null)
const deliveries = ref<EmailSendLogEntry[]>([])
let pollTimer: ReturnType<typeof setTimeout> | null = null

const bookIds = computed(() => (Array.isArray(props.selectionPayload.bookIds) ? props.selectionPayload.bookIds : []))
const count = computed(() => props.selectedCount ?? bookIds.value.length)
/** One known book: its files can be planned per recipient and its sends followed afterwards. */
const singleBookId = computed<number | null>(() => (count.value === 1 && bookIds.value.length === 1 ? (bookIds.value[0] ?? null) : null))
const files = computed(() => sendableFiles(props.bookFiles ?? []))
const formats = computed(() => {
  const seen = new Set<string>()
  return files.value.filter((file) => {
    const key = file.format?.toLowerCase() ?? ''
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
})

const provider = computed(() => providers.value.find((p) => p.id === providerId.value) ?? null)
const defaultTemplate = computed(
  () => templates.value.find((tpl) => tpl.id === preferences.value?.defaultTemplateId) ?? templates.value.find((tpl) => tpl.isSystem) ?? null,
)
const template = computed(() => templates.value.find((tpl) => tpl.id === templateId.value) ?? defaultTemplate.value)
const otherTemplates = computed(() => templates.value.filter((tpl) => tpl.id !== defaultTemplate.value?.id))
const notReady = computed(() => loaded.value && (providers.value.length === 0 || recipients.value.length === 0))
const selected = computed(() => recipients.value.filter((r) => selectedIds.value.includes(r.id)))

watch(
  () => props.open,
  async (open) => {
    stopPolling()
    if (!open) return
    sentAt.value = null
    deliveries.value = []
    optionsOpen.value = false
    chosenFormat.value = null
    templateId.value = null
    loaded.value = false
    await Promise.all([fetchRecipients(), fetchGroups(), fetchProviders(), fetchTemplates(), fetchPreferences()].map((p) => p.catch(() => undefined)))
    loaded.value = true
    selectedIds.value = initialRecipientIds()
    providerId.value = preferences.value?.defaultProviderId ?? providers.value[0]?.id ?? null
  },
  { immediate: true },
)

onBeforeUnmount(stopPolling)

/** The starred recipient, or the only one when nobody starred it: creating a recipient never makes it the default. */
function initialRecipientIds(): number[] {
  const defaultId = preferences.value?.defaultRecipientId
  if (defaultId && recipients.value.some((r) => r.id === defaultId)) return [defaultId]
  const [only, ...rest] = recipients.value
  return only && rest.length === 0 ? [only.id] : []
}

/** What each picked recipient gets, and the line a row shows when that differs from the rest. */
function exceptionFor(recipient: EmailRecipient): { text: string; warn: boolean } | null {
  if (singleBookId.value === null || files.value.length === 0) return null
  if (chosenFormat.value && recipient.deviceType === 'kindle' && !kindleAccepts(chosenFormat.value)) {
    return { text: t('email.sheet.kindleRejects', { format: chosenFormat.value.toUpperCase() }), warn: true }
  }
  const plan = planFile(files.value, recipient, chosenFormat.value)
  if (!plan) return null
  const size = plan.file.sizeBytes ? formatBytes(plan.file.sizeBytes) : ''
  const limit = sizeLimitExceeded(plan.file.sizeBytes, recipient.deviceType, provider.value?.host)
  if (limit === 'kindle') return { text: t('email.sheet.overKindle', { size }), warn: true }
  if (limit === 'gmail') return { text: t('email.sheet.overGmail', { size }), warn: true }
  if (plan.missingFormat)
    return { text: t('email.sheet.noFormat', { format: plan.missingFormat.toUpperCase(), got: (plan.file.format ?? '').toUpperCase() }), warn: false }
  if (plan.readAlong) return { text: t('email.sheet.readAlong', { size }), warn: false }
  return null
}

const blockingKindle = computed(() => {
  if (!chosenFormat.value || kindleAccepts(chosenFormat.value)) return null
  return selected.value.find((r) => r.deviceType === 'kindle') ?? null
})

const totalBytes = computed(() => {
  if (singleBookId.value === null) return 0
  return selected.value.reduce((sum, r) => sum + (planFile(files.value, r, chosenFormat.value)?.file.sizeBytes ?? 0), 0)
})
const soleFile = computed(() => {
  const only = selected.value.length === 1 ? selected.value[0] : undefined
  return only && singleBookId.value !== null ? planFile(files.value, only, chosenFormat.value) : null
})

/** What the collapsed options line lists: a list of settings, so each part is its own translated label. */
const optionsParts = computed(() => [
  t('email.sheet.templateName', { name: template.value?.name ?? '' }),
  chosenFormat.value ? t('email.sheet.formatForAll', { format: chosenFormat.value.toUpperCase() }) : t('email.sheet.eachFormat'),
])

function memberIds(group: EmailGroup): number[] {
  return group.members.map((member) => member.id)
}
function groupSelected(group: EmailGroup): boolean {
  const ids = memberIds(group)
  return ids.length > 0 && ids.every((id) => selectedIds.value.includes(id))
}
function toggleRecipient(id: number) {
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter((x) => x !== id) : [...selectedIds.value, id]
}
/** A group is a shortcut for its members, so the server only ever receives recipient ids. */
function toggleGroup(group: EmailGroup) {
  const ids = memberIds(group)
  if (groupSelected(group)) selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  else selectedIds.value = [...new Set([...selectedIds.value, ...ids])]
}
function toggleOptions() {
  optionsOpen.value = !optionsOpen.value
}
function chooseFormat(format: string | null) {
  chosenFormat.value = format
}
function close() {
  emit('update:open', false)
}
function handleOpenChange(open: boolean) {
  if (!open) close()
}
function openSettings() {
  close()
  void router.push({ name: 'settings-email' })
}
function openHistory() {
  close()
  void router.push({ name: 'settings-email', query: { tab: 'history' } })
}

function fileIdFor(format: string | null): number | undefined {
  if (!format || singleBookId.value === null) return undefined
  return (
    files.value.find((file) => file.format?.toLowerCase() === format && fileFormatKey(file) === format)?.id ??
    files.value.find((file) => file.format?.toLowerCase() === format)?.id
  )
}

async function send() {
  if (selected.value.length === 0 || blockingKindle.value) return
  sending.value = true
  const startedAt = Date.now()
  try {
    const result = await sendBook({
      ...props.selectionPayload,
      recipientIds: selectedIds.value,
      providerId: providerId.value ?? undefined,
      templateId: templateId.value ?? undefined,
      fileId: fileIdFor(chosenFormat.value),
    })
    emit('sent')
    if (singleBookId.value === null) {
      toast.success(t('email.send.queued', { count: result.queued }))
      close()
      return
    }
    sentAt.value = startedAt
    void poll(startedAt)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.send.failed'))
  } finally {
    sending.value = false
  }
}

/** Follows the sends this sheet queued until each one settles or a minute passes. */
async function poll(startedAt: number) {
  if (singleBookId.value === null || sentAt.value !== startedAt) return
  try {
    const rows = await fetchLogPage(0, Math.max(10, selected.value.length * 2), { bookId: singleBookId.value })
    const emails = new Set(selected.value.map((r) => r.email.toLowerCase()))
    deliveries.value = rows.filter((row) => Date.parse(row.createdAt) >= startedAt - 5000 && emails.has(row.toEmail.toLowerCase()))
  } catch {
    // A failed poll is retried on the next tick; the sheet already said the books were queued.
  }
  const settled = deliveries.value.length >= selected.value.length && deliveries.value.every((d) => d.status !== 'pending')
  if (!settled && Date.now() - startedAt < POLL_LIMIT_MS && props.open) pollTimer = setTimeout(() => void poll(startedAt), POLL_MS)
}
function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function deliveryFor(recipient: EmailRecipient): EmailSendLogEntry | null {
  return deliveries.value.find((d) => d.toEmail.toLowerCase() === recipient.email.toLowerCase()) ?? null
}
function deliveryLine(recipient: EmailRecipient): string {
  const entry = deliveryFor(recipient)
  const server = provider.value?.name ?? t('email.reason.server')
  if (!entry || deliveryKind(entry) === 'sending') return t('email.sheet.handingOver', { server })
  if (entry.status === 'sent') return t('email.sheet.acceptedBy', { server, time: formatRelativeFromNow(new Date(entry.sentAt ?? entry.createdAt)) })
  return lead(entry, provider.value?.name, provider.value?.host)
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      hide-close
      class="max-h-[88svh] gap-0 p-0 sm:inset-x-auto sm:right-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-t-lg"
    >
      <header class="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <SheetTitle class="flex min-w-0 items-center gap-2.5 text-base">
          <Send :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="truncate">{{ sentAt !== null ? t('email.sheet.sendingTitle', { title: bookTitle ?? '' }) : t('email.sheet.title') }}</span>
        </SheetTitle>
        <SheetDescription class="sr-only">{{ bookTitle ?? t('email.sheet.books', { count }) }}</SheetDescription>
        <Button variant="ghost" size="icon-sm" class="ms-auto shrink-0" :aria-label="t('common.close')" @click="close">
          <X :size="16" aria-hidden="true" />
        </Button>
      </header>

      <!-- After Send: each email followed until the mail server takes it or turns it down. -->
      <template v-if="sentAt !== null">
        <div class="min-h-0 overflow-y-auto px-4 pb-3.5">
          <ul role="status" aria-live="polite" class="divide-y divide-border">
            <li
              v-for="recipient in selected"
              :key="recipient.id"
              class="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-[11px] gap-y-0.5 px-1 py-2"
            >
              <EmailTile
                :icon="deviceLook(recipient.deviceType).icon"
                :color="deviceLook(recipient.deviceType).color"
                :size="28"
                class="row-span-2"
              />
              <span class="truncate text-sm font-medium text-foreground">{{ recipient.name }}</span>
              <span class="row-span-2 justify-self-end">
                <EmailDeliveryStatus
                  :entry="deliveryFor(recipient) ?? { status: 'pending', attemptCount: 0, failureCode: null, errorMessage: null }"
                />
              </span>
              <span class="col-start-2 min-w-0 truncate text-xs text-muted-foreground">{{ deliveryLine(recipient) }}</span>
            </li>
          </ul>
          <p class="mt-2 text-xs leading-normal text-muted-foreground">{{ t('email.sheet.closeHint') }}</p>
        </div>
        <footer class="flex items-center gap-3 border-t border-border px-4 pt-3 pb-4">
          <Button variant="link" class="h-auto px-0" @click="openHistory">{{ t('email.sheet.openHistory') }}</Button>
          <Button variant="outline" class="ms-auto h-8 rounded-[8px] px-3 has-[>svg]:px-3" @click="close">{{ t('email.sheet.done') }}</Button>
        </footer>
      </template>

      <template v-else>
        <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-3.5">
          <!-- The book -->
          <div class="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-[10px] border border-border bg-background/45 p-2.5">
            <BookCoverImage
              v-if="singleBookId !== null"
              :book-id="singleBookId"
              class="row-span-2 h-[60px] w-10 rounded-[3px] bg-muted object-cover shadow-xs ring-1 ring-foreground/10"
            />
            <span
              v-else
              class="row-span-2 flex h-[60px] w-10 items-center justify-center rounded-[3px] bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
              >{{ count }}</span
            >
            <p class="truncate text-sm font-semibold text-foreground">
              {{ singleBookId !== null ? (bookTitle ?? '') : t('email.sheet.books', { count }) }}
            </p>
            <p class="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span v-if="bookAuthors" class="truncate">{{ bookAuthors }}</span>
              <span v-if="bookAuthors && formats.length" aria-hidden="true">·</span>
              <BookFormatChip
                v-for="file in formats"
                :key="file.id"
                :format-key="file.format ?? ''"
                class="rounded-xs px-1.5 py-px text-[10px] tracking-wider"
              />
            </p>
          </div>

          <!-- Nothing to send with or to yet -->
          <template v-if="notReady">
            <div
              class="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-[var(--pill-warning)]/32 bg-[var(--pill-warning)]/6 p-4"
            >
              <TriangleAlert :size="16" class="mt-0.5 text-[var(--pill-warning)]" aria-hidden="true" />
              <p class="text-sm font-semibold text-foreground">{{ t('email.sheet.notReadyTitle') }}</p>
              <p class="col-start-2 text-[12.5px] leading-normal text-muted-foreground">{{ t('email.sheet.notReadyBody') }}</p>
            </div>
            <ol class="divide-y divide-border">
              <li class="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-2">
                <span
                  class="row-span-2 inline-flex size-7 items-center justify-center rounded-[7px] text-xs font-bold"
                  :class="providers.length ? 'bg-success/13 text-success' : 'bg-primary/13 text-primary'"
                >
                  <Check v-if="providers.length" :size="14" aria-hidden="true" /><template v-else>1</template>
                </span>
                <span class="text-sm font-medium text-foreground">{{ t('email.sheet.addServer') }}</span>
                <span class="text-xs text-muted-foreground">{{
                  hasPermission(Permission.ManageEmail) ? t('email.sheet.addServerHint') : t('email.sheet.askForServer')
                }}</span>
              </li>
              <li class="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-2">
                <span
                  class="row-span-2 inline-flex size-7 items-center justify-center rounded-[7px] text-xs font-bold"
                  :class="recipients.length ? 'bg-success/13 text-success' : 'bg-primary/13 text-primary'"
                >
                  <Check v-if="recipients.length" :size="14" aria-hidden="true" /><template v-else>2</template>
                </span>
                <span class="text-sm font-medium text-foreground">{{ t('email.sheet.addRecipient') }}</span>
                <span class="text-xs text-muted-foreground">{{ t('email.sheet.addRecipientHint') }}</span>
              </li>
            </ol>
          </template>

          <template v-else-if="loaded">
            <div class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold tracking-wider uppercase text-muted-foreground">{{ t('email.sheet.sendTo') }}</h3>
              <ul class="flex flex-col gap-0.5" role="group" :aria-label="t('email.sheet.sendTo')">
                <li v-for="recipient in recipients" :key="recipient.id">
                  <button
                    type="button"
                    role="checkbox"
                    :aria-checked="selectedIds.includes(recipient.id)"
                    class="grid w-full grid-cols-[18px_28px_minmax(0,1fr)_auto] items-center gap-x-[11px] rounded-lg px-2 py-[7px] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :class="selectedIds.includes(recipient.id) ? 'bg-primary/9' : 'hover:bg-foreground/4'"
                    @click="toggleRecipient(recipient.id)"
                  >
                    <span
                      class="inline-flex size-4 items-center justify-center rounded-[4px] border-[1.5px]"
                      :class="selectedIds.includes(recipient.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input'"
                      aria-hidden="true"
                    >
                      <Check v-if="selectedIds.includes(recipient.id)" :size="12" :stroke-width="3" />
                    </span>
                    <EmailTile :icon="deviceLook(recipient.deviceType).icon" :color="deviceLook(recipient.deviceType).color" :size="28" />
                    <span class="flex min-w-0 items-center gap-[7px] text-sm leading-[1.45] font-medium text-foreground">
                      <span class="truncate">{{ recipient.name }}</span>
                      <span
                        v-if="recipient.id === preferences?.defaultRecipientId"
                        class="shrink-0 rounded-xs bg-primary/15 px-1.5 text-[10px] leading-[18px] font-semibold text-primary"
                        >{{ t('email.badge.default') }}</span
                      >
                    </span>
                    <span class="row-span-2 max-w-44 justify-self-end text-end text-[11.5px] leading-snug">
                      <span
                        v-if="exceptionFor(recipient)"
                        class="inline-flex items-center gap-1"
                        :class="exceptionFor(recipient)?.warn ? 'text-[var(--pill-warning)]' : 'text-muted-foreground'"
                      >
                        <TriangleAlert v-if="exceptionFor(recipient)?.warn" :size="12" class="shrink-0" aria-hidden="true" />
                        {{ exceptionFor(recipient)?.text }}
                      </span>
                    </span>
                    <span class="col-start-3 min-w-0 truncate text-xs leading-[1.45] text-muted-foreground" dir="ltr">{{ recipient.email }}</span>
                  </button>
                </li>
              </ul>
            </div>

            <div v-if="groups.length" class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold tracking-wider uppercase text-muted-foreground">{{ t('email.sheet.groups') }}</h3>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="group in groups"
                  :key="group.id"
                  type="button"
                  :aria-pressed="groupSelected(group)"
                  class="inline-flex h-[30px] items-center gap-[7px] rounded-full border ps-1.5 pe-2.5 text-[13px] font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="groupSelected(group) ? 'border-primary/55 bg-primary/10' : 'border-border hover:bg-foreground/4'"
                  @click="toggleGroup(group)"
                >
                  <span class="flex -space-x-[3px]" aria-hidden="true">
                    <UserAvatar
                      v-for="member in group.members.slice(0, 3)"
                      :key="member.id"
                      :name="member.name"
                      size-class="size-5 rounded-full ring-2 ring-card"
                      text-class="text-[8.5px]"
                    />
                  </span>
                  {{ group.name }}
                  <span class="text-[11.5px] tabular-nums text-muted-foreground">{{ group.members.length }}</span>
                </button>
              </div>
            </div>

            <button
              v-if="!optionsOpen"
              type="button"
              class="flex w-full items-center gap-2 rounded-[9px] border border-border px-2.5 py-[9px] text-start text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-expanded="optionsOpen"
              @click="toggleOptions"
            >
              <Settings :size="14" class="shrink-0" aria-hidden="true" />
              <span class="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                <b class="shrink-0 font-medium text-foreground">{{ provider?.name }}</b>
                <template v-for="part in optionsParts" :key="part">
                  <span aria-hidden="true">·</span>
                  <span class="truncate">{{ part }}</span>
                </template>
              </span>
              <ChevronDown :size="14" class="ms-auto shrink-0" aria-hidden="true" />
            </button>
            <div v-else class="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-[10px] border border-border p-3">
              <template v-if="singleBookId !== null && formats.length > 1">
                <span class="pt-1.5 text-[13px] text-muted-foreground">{{ t('email.sheet.file') }}</span>
                <div class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('email.sheet.file')">
                  <button
                    type="button"
                    role="radio"
                    :aria-checked="chosenFormat === null"
                    class="inline-flex h-[30px] items-center rounded-lg border px-[9px] text-[12.5px] transition-colors"
                    :class="
                      chosenFormat === null
                        ? 'border-primary/60 bg-primary/9 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-foreground/4'
                    "
                    @click="chooseFormat(null)"
                  >
                    {{ t('email.sheet.eachFormat') }}
                  </button>
                  <button
                    v-for="file in formats"
                    :key="file.id"
                    type="button"
                    role="radio"
                    :aria-checked="chosenFormat === file.format?.toLowerCase()"
                    class="inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-[9px] text-[12.5px] tabular-nums transition-colors"
                    :class="
                      chosenFormat === file.format?.toLowerCase()
                        ? 'border-primary/60 bg-primary/9 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-foreground/4'
                    "
                    @click="chooseFormat(file.format?.toLowerCase() ?? null)"
                  >
                    <BookFormatChip :format-key="file.format ?? ''" class="rounded-xs px-[5px] text-[10px] tracking-wider" />
                    {{ file.sizeBytes ? formatBytes(file.sizeBytes) : '' }}
                  </button>
                </div>
              </template>
              <label for="send-sheet-server" class="pt-1.5 text-[13px] text-muted-foreground">{{ t('email.sheet.mailServer') }}</label>
              <select id="send-sheet-server" v-model="providerId" class="settings-control h-8 text-[13px]">
                <option v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}{{ p.id === preferences?.defaultProviderId ? ` · ${t('email.sheet.yourDefault')}` : '' }}
                </option>
              </select>
              <label for="send-sheet-template" class="pt-1.5 text-[13px] text-muted-foreground">{{ t('email.sheet.template') }}</label>
              <select id="send-sheet-template" v-model="templateId" class="settings-control h-8 text-[13px]">
                <option :value="null">{{ defaultTemplate?.name ?? '' }} · {{ t('email.sheet.yourDefault') }}</option>
                <option v-for="tpl in otherTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
              </select>
            </div>
          </template>
        </div>

        <footer class="flex flex-col gap-2.5 border-t border-border px-4 pt-3 pb-4">
          <p v-if="blockingKindle" role="alert" class="flex items-start gap-2 text-xs text-[var(--pill-warning)]">
            <TriangleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
            {{ t('email.sheet.blockedKindle', { name: blockingKindle.name, format: (chosenFormat ?? '').toUpperCase() }) }}
          </p>
          <div v-if="notReady" class="flex items-center justify-end gap-2">
            <Button variant="outline" class="h-8 rounded-[8px] px-3 has-[>svg]:px-3" @click="close">{{ t('common.close') }}</Button>
            <Button class="h-8 rounded-[8px] px-3 has-[>svg]:px-3" @click="openSettings">{{ t('email.sheet.openSettings') }}</Button>
          </div>
          <div v-else class="flex items-center gap-2">
            <p class="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <b class="font-semibold whitespace-nowrap text-foreground">{{
                selected.length ? t('email.sheet.emails', { count: selected.length }) : t('email.sheet.noOnePicked')
              }}</b>
              <template v-if="soleFile">
                <span aria-hidden="true">·</span>
                <BookFormatChip :format-key="soleFile.file.format ?? ''" class="rounded-xs px-1.5 py-px text-[10px] tracking-wider" />
                <span class="tabular-nums">{{ soleFile.file.sizeBytes ? formatBytes(soleFile.file.sizeBytes) : '' }}</span>
              </template>
              <span v-else-if="selected.length > 1 && totalBytes > 0" class="truncate"
                >· {{ t('email.sheet.total', { size: formatBytes(totalBytes) }) }}</span
              >
            </p>
            <Button variant="outline" class="ms-auto h-8 rounded-[8px] px-3 has-[>svg]:px-3" @click="close">{{ t('common.cancel') }}</Button>
            <Button
              class="h-8 rounded-[8px] px-3 has-[>svg]:px-3"
              :disabled="sending || !loaded || selected.length === 0 || blockingKindle !== null"
              @click="send"
            >
              <Loader2 v-if="sending" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <Send v-else :size="14" aria-hidden="true" />
              {{ t('email.sheet.send', { count: Math.max(selected.length, 1) }) }}
            </Button>
          </div>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
