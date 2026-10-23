<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Inbox } from '@lucide/vue'
import type { EmailRecipient, EmailSendLogEntry, EmailSendLogSummary } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import EmailDeliveryRow from './EmailDeliveryRow.vue'
import EmailTile from './EmailTile.vue'
import { fetchLogPage, useEmailSendLog, type EmailLogStatus } from '../composables/useEmailSendLog'
import type { EmailProvider } from '../composables/useEmailProviders'

const props = defineProps<{
  summary: EmailSendLogSummary | null
  recipients: EmailRecipient[]
  providers: EmailProvider[]
}>()

const emit = defineEmits<{ changed: [] }>()

const PAGE_SIZE = 20

type Filter = 'all' | 'attention' | 'active'
const FILTER_STATUS: Record<Filter, EmailLogStatus | undefined> = { all: undefined, attention: 'failed', active: 'pending' }

const { t } = useI18n()
const router = useRouter()
const { resendEntry, deleteEntry } = useEmailSendLog()

const filter = ref<Filter>('all')
const entries = ref<EmailSendLogEntry[]>([])
const page = ref(0)
const loading = ref(false)
const loaded = ref(false)
const exhausted = ref(false)
const busyId = ref<number | null>(null)

const filters = computed(() => [
  { value: 'all' as const, label: t('email.log.all'), count: props.summary?.total ?? 0 },
  { value: 'attention' as const, label: t('email.log.attention'), count: props.summary?.failed ?? 0 },
  { value: 'active' as const, label: t('email.log.active'), count: props.summary?.pending ?? 0 },
])
const filterTotal = computed(() => filters.value.find((f) => f.value === filter.value)?.count ?? 0)
const nothingSent = computed(() => loaded.value && filter.value === 'all' && entries.value.length === 0)
const recipientById = computed(() => new Map(props.recipients.map((r) => [r.id, r])))
const providerById = computed(() => new Map(props.providers.map((p) => [p.id, p])))

async function load(reset: boolean) {
  if (loading.value) return
  loading.value = true
  try {
    const next = reset ? 0 : page.value + 1
    const rows = await fetchLogPage(next, PAGE_SIZE, { status: FILTER_STATUS[filter.value] })
    entries.value = reset ? rows : [...entries.value, ...rows]
    page.value = next
    exhausted.value = rows.length < PAGE_SIZE
  } catch {
    toast.error(t('email.loadFailed'))
  } finally {
    loading.value = false
    loaded.value = true
  }
}

onMounted(() => void load(true))
watch(filter, () => void load(true))

function selectFilter(value: Filter) {
  filter.value = value
}
function loadMore() {
  void load(false)
}

/** Older rows carry no recipient id, so they are matched to a saved recipient by address. */
function recipientOf(entry: EmailSendLogEntry) {
  if (entry.recipientId) return recipientById.value.get(entry.recipientId) ?? null
  const email = entry.toEmail.toLowerCase()
  return props.recipients.find((r) => r.email.toLowerCase() === email) ?? null
}
function providerOf(entry: EmailSendLogEntry) {
  return entry.providerId ? (providerById.value.get(entry.providerId) ?? null) : null
}

async function handleResend(entry: EmailSendLogEntry) {
  busyId.value = entry.id
  try {
    await resendEntry(entry.id)
    toast.success(t('email.history.queuedForResend'))
    emit('changed')
    await load(true)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.history.resendFailed'))
  } finally {
    busyId.value = null
  }
}
async function handleRemove(entry: EmailSendLogEntry) {
  busyId.value = entry.id
  try {
    await deleteEntry(entry.id)
    entries.value = entries.value.filter((e) => e.id !== entry.id)
    toast.success(t('email.history.entryDeleted'))
    emit('changed')
  } catch {
    toast.error(t('email.deleteFailed'))
  } finally {
    busyId.value = null
  }
}
function handleOpenBook(bookId: number) {
  void router.push({ name: 'book-detail', params: { bookId } })
}
</script>

<template>
  <div v-if="nothingSent" class="settings-empty-state flex flex-col items-center gap-1.5 py-7">
    <EmailTile :icon="Inbox" color="var(--muted-foreground)" :size="40" />
    <p class="text-sm font-semibold text-foreground">{{ t('email.log.emptyTitle') }}</p>
    <p class="max-w-[440px] text-[12.5px] leading-[1.55] text-muted-foreground">{{ t('email.log.emptyBody') }}</p>
  </div>

  <div v-else>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <div
        role="group"
        :aria-label="t('email.log.status')"
        class="inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] border border-border bg-background/45 p-[3px] scrollbar-none"
      >
        <button
          v-for="option in filters"
          :key="option.value"
          type="button"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[13.5px] font-medium whitespace-nowrap text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="filter === option.value ? 'bg-sidebar-accent shadow-xs' : 'hover:bg-foreground/5'"
          :aria-pressed="filter === option.value"
          @click="selectFilter(option.value)"
        >
          {{ option.label }}
          <span
            class="rounded-[5px] px-[5px] text-[11.5px] leading-[17px] tabular-nums"
            :class="filter === option.value ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground'"
          >
            {{ formatNumber(option.count) }}
          </span>
        </button>
      </div>
      <p class="ms-auto hidden text-[12.5px] text-muted-foreground sm:block">{{ t('email.log.sentMeans') }}</p>
    </div>

    <div
      class="settings-card @container [--email-ledger-cols:28px_minmax(0,1.4fr)_minmax(0,1fr)_124px_132px_84px_64px] min-[1500px]:[--email-ledger-cols:28px_minmax(0,1.5fr)_minmax(0,1.1fr)_132px_150px_92px_72px]"
    >
      <div
        class="hidden h-9 grid-cols-(--email-ledger-cols) items-center gap-x-3.5 bg-foreground/[0.03] px-4 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-muted-foreground @3xl:grid"
        aria-hidden="true"
      >
        <span />
        <span>{{ t('email.log.book') }}</span>
        <span>{{ t('email.log.sentTo') }}</span>
        <span>{{ t('email.log.file') }}</span>
        <span>{{ t('email.log.status') }}</span>
        <span>{{ t('email.log.when') }}</span>
        <span />
      </div>
      <p v-if="loaded && entries.length === 0" class="px-5 py-10 text-center text-sm text-muted-foreground">{{ t('email.log.emptyFilter') }}</p>
      <ul v-else class="divide-y divide-border" :aria-busy="loading">
        <li v-for="entry in entries" :key="entry.id">
          <EmailDeliveryRow
            :entry="entry"
            :device-type="recipientOf(entry)?.deviceType ?? null"
            :recipient-known="recipientOf(entry) !== null"
            :server-name="providerOf(entry)?.name ?? null"
            :server-host="providerOf(entry)?.host ?? null"
            :busy="busyId === entry.id"
            @resend="handleResend"
            @remove="handleRemove"
            @open-book="handleOpenBook"
          />
        </li>
      </ul>
      <div
        v-if="entries.length > 0 && (filter === 'all' || !exhausted)"
        class="flex items-center justify-center gap-2.5 px-3 py-3 text-[12.5px] text-muted-foreground"
      >
        {{ t('email.log.showing', { shown: formatNumber(entries.length), total: formatNumber(Math.max(filterTotal, entries.length)) }) }}
        <Button v-if="!exhausted" variant="outline" size="sm" class="h-7 rounded-[7px] px-[9px] text-[13px]" :disabled="loading" @click="loadMore">{{
          t('email.log.loadMore')
        }}</Button>
      </div>
    </div>
  </div>
</template>
