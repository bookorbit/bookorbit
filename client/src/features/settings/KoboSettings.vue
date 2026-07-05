<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Trash2, Copy, Check, Pencil, X, Tablet, RefreshCw, History, Download, Upload, Bookmark, Info } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { useKoboDevices } from '@/features/kobo/composables/useKoboDevices'
import { useKoboSettings } from '@/features/kobo/composables/useKoboSettings'
import { useKoboSyncHistory } from '@/features/kobo/composables/useKoboSyncHistory'
import type { KoboDevice, KoboSyncHistoryEntry } from '@bookorbit/types'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { devices, fetchDevices, createDevice, renameDevice, revokeDevice } = useKoboDevices()
const { settings, fetchSettings, updateSettings } = useKoboSettings()
const { history: syncHistory, loading: historyLoading, fetchHistory } = useKoboSyncHistory()

const loading = ref(true)
const error = ref<string | null>(null)

// Create device
const showCreateForm = ref(false)
const newDeviceName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

// New device token display
const newDeviceToken = ref<string | null>(null)
const newDeviceSyncUrl = ref<string | null>(null)

// Rename
const renamingId = ref<number | null>(null)
const renameValue = ref('')
const renaming = ref(false)

// Settings
const readingThreshold = ref(1)
const finishedThreshold = ref(99)
const convertToKepub = ref(true)
const forceEnableHyphenation = ref(false)
const kepubConversionLimitMb = ref(100)
const twoWayProgressSync = ref(false)
const syncBookOrbitAnnotationsToKobo = ref(false)
const savingSettings = ref(false)
const settingsError = ref<string | null>(null)
const refreshingHistory = ref(false)
const historyFilter = ref<'all' | 'failures'>('all')
const currentLimit = ref(20)
const loadingMore = ref(false)

const route = useRoute()
const router = useRouter()
type Tab = 'settings' | 'activity'
type HistoryDisplayItem = {
  key: string
  primary: KoboSyncHistoryEntry
  entries: KoboSyncHistoryEntry[]
}

const progressGroupWindowMs = 5 * 60 * 1000
const activeTab = ref<Tab>((route.query.tab as Tab) === 'activity' ? 'activity' : 'settings')

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-kobo', query: { ...route.query, tab } })
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = (value as Tab) === 'activity' ? 'activity' : 'settings'
  },
)

const hasSyncHistory = computed(() => syncHistory.value.length > 0)
const latestHistoryEntry = computed(() => syncHistory.value[0] ?? null)
const latestSuccessfulActivity = computed(() => syncHistory.value.find((entry) => entry.status === 'success') ?? null)
const latestFailedActivity = computed(() => syncHistory.value.find((entry) => entry.status === 'failed') ?? null)
const recentFailureCount = computed(() => syncHistory.value.filter((entry) => entry.status === 'failed').length)
const filteredSyncHistory = computed(() =>
  historyFilter.value === 'failures' ? syncHistory.value.filter((entry) => entry.status === 'failed') : syncHistory.value,
)
const displayedSyncHistory = computed(() => buildHistoryDisplayItems(filteredSyncHistory.value))
const syncHealthLabel = computed(() => {
  if (!latestHistoryEntry.value) return 'Waiting for activity'
  return latestHistoryEntry.value.status === 'failed' ? 'Needs attention' : 'Sync healthy'
})
const latestSuccessLabel = computed(() => (latestSuccessfulActivity.value ? formatLastSeen(latestSuccessfulActivity.value.createdAt) : 'Never'))
const latestFailureLabel = computed(() => (latestFailedActivity.value ? formatLastSeen(latestFailedActivity.value.createdAt) : 'None'))
const recentFailureLabel = computed(() => pluralize(recentFailureCount.value, 'failure'))
const historyHeaderDetail = computed(() => {
  if (!latestHistoryEntry.value) return 'No Kobo sync activity has been recorded.'
  const parts = [syncHealthLabel.value, `Last success ${latestSuccessLabel.value}`]
  if (latestFailedActivity.value) parts.push(`Last failure ${latestFailureLabel.value}`)
  if (recentFailureCount.value > 0) parts.push(recentFailureLabel.value)
  return parts.join(' · ')
})
const filteredHistoryEmptyLabel = computed(() =>
  historyFilter.value === 'failures' ? 'No failed Kobo activity in recent history.' : 'No Kobo activity yet.',
)

function applySettingsToLocal() {
  readingThreshold.value = settings.value.readingThreshold
  finishedThreshold.value = settings.value.finishedThreshold
  convertToKepub.value = settings.value.convertToKepub
  forceEnableHyphenation.value = settings.value.forceEnableHyphenation
  kepubConversionLimitMb.value = settings.value.kepubConversionLimitMb
  twoWayProgressSync.value = settings.value.twoWayProgressSync
  syncBookOrbitAnnotationsToKobo.value = settings.value.syncBookOrbitAnnotationsToKobo
}

function formatLastSeen(date: string | null): string {
  if (!date) return 'Never'
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
}

function buildHistoryDisplayItems(entries: KoboSyncHistoryEntry[]): HistoryDisplayItem[] {
  const consumed = new Set<number>()
  const items: HistoryDisplayItem[] = []

  for (const entry of entries) {
    if (consumed.has(entry.id)) continue
    if (!canGroupProgressEntry(entry)) {
      items.push({ key: `entry-${entry.id}`, primary: entry, entries: [entry] })
      continue
    }

    const group = entries.filter((candidate) => (candidate.id === entry.id || !consumed.has(candidate.id)) && canMergeProgressEntry(entry, candidate))
    if (group.length <= 1) {
      items.push({ key: `entry-${entry.id}`, primary: entry, entries: [entry] })
      continue
    }

    for (const candidate of group) consumed.add(candidate.id)
    items.push({ key: `progress-${entry.deviceId ?? 'removed'}-${historyBookKey(entry)}-${entry.id}`, primary: entry, entries: group })
  }

  return items
}

function canGroupProgressEntry(entry: KoboSyncHistoryEntry): boolean {
  return entry.status === 'success' && entry.event === 'progress_update'
}

function canMergeProgressEntry(anchor: KoboSyncHistoryEntry, candidate: KoboSyncHistoryEntry): boolean {
  if (!canGroupProgressEntry(candidate)) return false
  if (anchor.deviceId !== candidate.deviceId) return false
  if (historyBookKey(anchor) !== historyBookKey(candidate)) return false
  if (historyCountBoolean(anchor, 'twoWayProgressSync') !== historyCountBoolean(candidate, 'twoWayProgressSync')) return false

  const anchorTime = new Date(anchor.createdAt).getTime()
  const candidateTime = new Date(candidate.createdAt).getTime()
  return Number.isFinite(anchorTime) && Number.isFinite(candidateTime) && Math.abs(anchorTime - candidateTime) <= progressGroupWindowMs
}

function formatHistoryEvent(event: KoboSyncHistoryEntry['event']): string {
  const labels: Record<KoboSyncHistoryEntry['event'], string> = {
    library_sync: 'Library checked for updates',
    book_download: 'Book downloaded',
    progress_update: 'Reading position updated',
    annotations_pull: 'Highlights sent to Kobo',
    annotations_push: 'Highlights received from Kobo',
  }
  return labels[event]
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function historyCountNumber(entry: KoboSyncHistoryEntry, key: string): number {
  const value = entry.counts[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function historyCountBoolean(entry: KoboSyncHistoryEntry, key: string): boolean {
  return entry.counts[key] === true
}

function historyCountString(entry: KoboSyncHistoryEntry, key: string): string | null {
  const value = entry.counts[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function historyBookTitle(entry: KoboSyncHistoryEntry): string | null {
  return historyCountString(entry, 'bookTitle')
}

function historyBookKey(entry: KoboSyncHistoryEntry): string {
  const bookId = entry.counts.bookId
  if (typeof bookId === 'number' && Number.isFinite(bookId)) return String(bookId)
  const title = historyBookTitle(entry)
  return title ?? 'unknown'
}

function isHistoryNoOp(entry: KoboSyncHistoryEntry): boolean {
  if (entry.status !== 'success') return false
  switch (entry.event) {
    case 'library_sync':
      return historyCountNumber(entry, 'entitlements') === 0
    case 'book_download':
      return historyCountNumber(entry, 'downloads') === 0
    case 'progress_update':
      return false
    case 'annotations_pull':
      return historyCountNumber(entry, 'served') === 0
    case 'annotations_push':
      return historyCountNumber(entry, 'created') + historyCountNumber(entry, 'updated') === 0
  }
}

function historyOutcomeText(entry: KoboSyncHistoryEntry): string {
  if (entry.status === 'failed') return 'Failed'

  if (isHistoryNoOp(entry)) {
    switch (entry.event) {
      case 'library_sync':
        return 'No updates'
      case 'annotations_pull':
      case 'annotations_push':
        return 'No changes'
    }
  }

  switch (entry.event) {
    case 'library_sync':
      return historyCountBoolean(entry, 'hasMore') ? 'Pending' : 'Completed'
    case 'book_download':
      return 'Downloaded'
    case 'progress_update':
      return 'Updated'
    case 'annotations_pull':
      return 'Sent'
    case 'annotations_push':
      return 'Imported'
  }
}

function historyFailureSummary(entry: KoboSyncHistoryEntry): string {
  switch (entry.event) {
    case 'library_sync':
      return 'Library check did not complete'
    case 'book_download':
      return 'Download did not complete'
    case 'progress_update':
      return 'Reading position did not update'
    case 'annotations_pull':
      return 'Highlights were not sent'
    case 'annotations_push':
      return 'Highlights were not imported'
  }
}

function historyDetailChips(entry: KoboSyncHistoryEntry): string[] {
  switch (entry.event) {
    case 'library_sync': {
      return [historyCountBoolean(entry, 'hasMore') ? 'More pending' : 'No updates pending']
    }
    case 'book_download':
      return [pluralize(historyCountNumber(entry, 'downloads') || 1, 'book')]
    case 'progress_update':
      return [progressSyncModeText(entry)]
    case 'annotations_pull': {
      const labels: string[] = []
      const tombstones = historyCountNumber(entry, 'tombstones')
      if (tombstones > 0) labels.push(`${tombstones} deleted annotations`)
      labels.push(historyCountBoolean(entry, 'notModified') ? 'Device already current' : 'Fresh highlight data')
      return labels
    }
    case 'annotations_push': {
      const labels: string[] = []
      const created = historyCountNumber(entry, 'created')
      const updated = historyCountNumber(entry, 'updated')
      const deleted = historyCountNumber(entry, 'deleted')
      const unchanged = historyCountNumber(entry, 'unchanged')
      if (created > 0) labels.push(`${created} created`)
      if (updated > 0) labels.push(`${updated} updated`)
      if (deleted > 0) labels.push(`${deleted} deleted`)
      if (unchanged > 0) labels.push(`${unchanged} unchanged`)
      return labels.length > 0 ? labels : ['No changes']
    }
  }
}

function historyDetailText(entry: KoboSyncHistoryEntry): string {
  return historyDetailChips(entry).join(' · ')
}

function isGroupedHistoryItem(item: HistoryDisplayItem): boolean {
  return item.entries.length > 1
}

function historyItemTitle(item: HistoryDisplayItem): string {
  const entry = item.primary
  const title = historyBookTitle(entry)
  if (isGroupedHistoryItem(item)) {
    return title ? `Reading position synced: ${title}` : 'Reading position synced'
  }

  const label = formatHistoryEvent(entry.event)
  if (!title || entry.event === 'library_sync') return label
  return `${label}: ${title}`
}

function historyItemOutcomeText(item: HistoryDisplayItem): string {
  return isGroupedHistoryItem(item) ? `${pluralize(item.entries.length, 'update')}` : historyOutcomeText(item.primary)
}

function historyDirectionText(entry: KoboSyncHistoryEntry): string {
  switch (entry.event) {
    case 'library_sync':
    case 'book_download':
    case 'annotations_pull':
      return 'BookOrbit -> Kobo'
    case 'progress_update':
    case 'annotations_push':
      return 'Kobo -> BookOrbit'
  }
}

function progressSyncModeText(entry: KoboSyncHistoryEntry): string {
  return historyCountBoolean(entry, 'twoWayProgressSync') ? 'Two-way sync enabled' : 'Device progress saved'
}

function historyItemSummary(item: HistoryDisplayItem): string {
  const entry = item.primary
  if (entry.status === 'failed') return historyFailureSummary(entry)

  const title = historyBookTitle(entry)
  switch (entry.event) {
    case 'library_sync': {
      const updates = historyCountNumber(entry, 'entitlements')
      if (updates === 0) return 'No library updates are pending for this device'
      return `${pluralize(updates, 'library update')} prepared for the device`
    }
    case 'book_download':
      return title
        ? `${title} was downloaded by ${historyDeviceName(entry)}`
        : `${pluralize(historyCountNumber(entry, 'downloads') || 1, 'book')} downloaded`
    case 'progress_update':
      if (isGroupedHistoryItem(item)) {
        return title
          ? `${pluralize(item.entries.length, 'progress update')} synced for ${title}`
          : `${pluralize(item.entries.length, 'progress update')} synced`
      }
      return title ? `Kobo reported a new reading position for ${title}` : 'Kobo reported a new reading position'
    case 'annotations_pull': {
      const served = historyCountNumber(entry, 'served')
      if (served === 0) return title ? `No highlight changes needed for ${title}` : 'No highlight changes needed'
      return title ? `${pluralize(served, 'highlight')} sent to Kobo for ${title}` : `${pluralize(served, 'highlight')} sent to Kobo`
    }
    case 'annotations_push': {
      const changed = historyCountNumber(entry, 'created') + historyCountNumber(entry, 'updated') + historyCountNumber(entry, 'deleted')
      if (changed === 0) return title ? `No Kobo highlight changes for ${title}` : 'No Kobo highlight changes'
      return title ? `${pluralize(changed, 'highlight')} imported from Kobo for ${title}` : `${pluralize(changed, 'highlight')} imported from Kobo`
    }
  }
}

function historyItemSecondaryText(item: HistoryDisplayItem): string {
  const entry = item.primary
  const parts = [historyDirectionText(entry)]
  if (entry.event === 'progress_update') {
    parts.push(progressSyncModeText(entry))
  } else {
    const detail = historyDetailText(entry)
    if (detail) parts.push(detail)
  }
  return parts.join(' · ')
}

function historyItemTimeTitle(item: HistoryDisplayItem): string {
  if (!isGroupedHistoryItem(item)) return formatDateTime(item.primary.createdAt)
  const oldest = item.entries[item.entries.length - 1]
  return `${formatDateTime(oldest?.createdAt)} to ${formatDateTime(item.primary.createdAt)}`
}

function historyItemGroupedLabel(item: HistoryDisplayItem): string {
  return isGroupedHistoryItem(item) ? `${pluralize(item.entries.length, 'event')} grouped` : ''
}

function historyDeviceName(entry: KoboSyncHistoryEntry): string {
  return entry.deviceName ?? 'Removed device'
}

function historyOutcomeClass(entry: KoboSyncHistoryEntry): string {
  if (entry.status === 'failed') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  if (isHistoryNoOp(entry)) {
    return 'border-border bg-muted/60 text-muted-foreground'
  }
  return 'border-primary/30 bg-primary/10 text-primary'
}

function historyStatusDotClass(entry: KoboSyncHistoryEntry): string {
  return entry.status === 'success' ? 'bg-primary' : 'bg-destructive'
}

function getHistoryEventIcon(event: KoboSyncHistoryEntry['event']) {
  switch (event) {
    case 'library_sync':
      return RefreshCw
    case 'book_download':
      return Download
    case 'progress_update':
      return Bookmark
    case 'annotations_pull':
      return Upload
    case 'annotations_push':
      return Download
  }
}

function showAllHistory() {
  historyFilter.value = 'all'
}

function showFailedHistory() {
  historyFilter.value = 'failures'
}

function handleSelectSettingsTab() {
  selectTab('settings')
}

function handleSelectActivityTab() {
  selectTab('activity')
}

async function loadMoreHistory() {
  if (loadingMore.value || historyLoading.value) return
  loadingMore.value = true
  currentLimit.value = Math.min(currentLimit.value + 20, 100)
  try {
    await fetchHistory(currentLimit.value)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to load more history')
  } finally {
    loadingMore.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([fetchDevices(), fetchSettings(), fetchHistory(currentLimit.value)])
    applySettingsToLocal()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
})

watch(twoWayProgressSync, (enabled) => {
  if (enabled) convertToKepub.value = true
})

watch(syncBookOrbitAnnotationsToKobo, (enabled) => {
  if (enabled) convertToKepub.value = true
})

async function submitCreate() {
  if (!newDeviceName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    const device = await createDevice(newDeviceName.value.trim())
    newDeviceToken.value = device.token
    newDeviceSyncUrl.value = `${window.location.origin}/api/v1/kobo/${device.token}`
    showCreateForm.value = false
    newDeviceName.value = ''
    toast.success(`Device "${device.name}" registered`)
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create device'
    toast.error(createError.value ?? 'Failed to create device')
  } finally {
    creating.value = false
  }
}

function cancelCreate() {
  showCreateForm.value = false
  createError.value = null
  newDeviceName.value = ''
}

function dismissToken() {
  newDeviceToken.value = null
  newDeviceSyncUrl.value = null
}

async function copyToken() {
  if (!newDeviceSyncUrl.value) return
  const copied = await copyToClipboard(newDeviceSyncUrl.value)
  if (copied) {
    toast.success('Sync URL copied to clipboard')
  } else {
    toast.error('Failed to copy sync URL')
  }
}

function startRename(device: KoboDevice) {
  renamingId.value = device.id
  renameValue.value = device.name
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function submitRename(device: KoboDevice) {
  if (!renameValue.value.trim()) return
  renaming.value = true
  try {
    await renameDevice(device.id, renameValue.value.trim())
    toast.success('Device renamed')
    renamingId.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to rename device')
  } finally {
    renaming.value = false
  }
}

async function revoke(device: KoboDevice) {
  if (!confirm(`Revoke access for "${device.name}"? The device will not be able to sync until re-paired.`)) return
  try {
    await revokeDevice(device.id)
    toast.success(`Access revoked for "${device.name}"`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to revoke access')
  }
}

async function refreshHistory() {
  refreshingHistory.value = true
  try {
    await fetchHistory(currentLimit.value)
    toast.success('Kobo sync history refreshed')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to refresh history')
  } finally {
    refreshingHistory.value = false
  }
}

async function saveSettings() {
  if (readingThreshold.value >= finishedThreshold.value) {
    settingsError.value = 'Reading threshold must be less than finished threshold'
    toast.error(settingsError.value ?? 'Failed to save settings')
    return
  }
  savingSettings.value = true
  settingsError.value = null
  try {
    await updateSettings({
      readingThreshold: readingThreshold.value,
      finishedThreshold: finishedThreshold.value,
      convertToKepub: convertToKepub.value,
      forceEnableHyphenation: forceEnableHyphenation.value,
      kepubConversionLimitMb: kepubConversionLimitMb.value,
      twoWayProgressSync: twoWayProgressSync.value,
      syncBookOrbitAnnotationsToKobo: syncBookOrbitAnnotationsToKobo.value,
    })
    applySettingsToLocal()
    toast.success('Kobo sync settings saved')
  } catch (e) {
    settingsError.value = e instanceof Error ? e.message : 'Failed to save'
    toast.error(settingsError.value ?? 'Failed to save settings')
  } finally {
    savingSettings.value = false
  }
}
</script>

<template>
  <SettingsPageHeader v-if="!props.embedded" title="Kobo Sync" subtitle="Pair your Kobo device to sync your library." />

  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- Tab switcher (not shown when embedded) -->
    <div
      v-if="!props.embedded"
      class="flex gap-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
    >
      <button
        class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
        :class="
          activeTab === 'settings'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        "
        @click="handleSelectSettingsTab"
      >
        Sync Settings
      </button>
      <button
        class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
        :class="
          activeTab === 'activity'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        "
        @click="handleSelectActivityTab"
      >
        Activity Log
      </button>
    </div>

    <div v-show="activeTab === 'settings' || props.embedded">
      <!-- New device token display -->
      <div v-if="newDeviceSyncUrl" class="mb-8 border-2 border-primary/30 rounded-lg p-4 bg-primary/5 shadow-xs">
        <div class="flex items-start justify-between gap-4 mb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
              <Check :size="13" stroke-width="3" />
            </div>
            <div>
              <p class="settings-label leading-none mb-0.5">Device paired successfully</p>
              <p class="settings-hint">You're ready to set up your Kobo. Enable Kobo Sync on your collections to start syncing books.</p>
            </div>
          </div>
          <button @click="dismissToken()" class="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
            <X :size="18" />
          </button>
        </div>

        <div class="space-y-4">
          <div class="bg-background rounded-lg border border-border p-4">
            <p class="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2.5">Sync URL</p>
            <div class="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-muted/30">
              <Tablet :size="14" class="text-muted-foreground shrink-0" />
              <span class="flex-1 text-sm text-foreground font-mono select-all truncate min-w-0">{{ newDeviceSyncUrl }}</span>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
                @click="copyToken()"
              >
                <Copy :size="12" />
                Copy
              </button>
            </div>
          </div>
          <div
            class="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md border border-amber-200 dark:border-amber-900/50"
          >
            <X :size="14" class="shrink-0" />
            This URL will not be shown again. Keep it private.
          </div>
          <div class="flex items-start gap-2.5 rounded-md border border-border bg-background p-4 text-xs mt-4">
            <Info :size="16" class="text-primary shrink-0 mt-0.5" />
            <div class="space-y-1">
              <p class="font-semibold text-foreground">Next Steps</p>
              <p class="text-muted-foreground leading-normal">1. Configure your Kobo device to sync with the Sync URL above.</p>
              <p class="text-muted-foreground leading-normal">
                2. In BookOrbit, go to any collection from the sidebar, click the Edit icon, and enable
                <strong class="text-foreground">Sync to Kobo</strong>. Only books inside sync-enabled collections will download to your device.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Devices -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">Registered Devices</p>
          <button v-if="!showCreateForm" class="settings-btn-primary" @click="showCreateForm = true">
            <Plus :size="12" />
            Add device
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showCreateForm" class="border border-border rounded-lg p-5 bg-card mb-4 space-y-4 shadow-xs">
          <div>
            <label class="settings-label block mb-1.5">Device name</label>
            <input v-model="newDeviceName" type="text" placeholder="e.g. My Kobo Libra" autofocus class="input-field w-full" />
          </div>
          <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
          <div class="flex items-center gap-2 pt-1">
            <button class="settings-btn-primary" :disabled="creating || !newDeviceName.trim()" @click="submitCreate()">
              {{ creating ? 'Creating...' : 'Create device' }}
            </button>
            <button class="settings-btn-outline" @click="cancelCreate()">Cancel</button>
          </div>
        </div>

        <div v-if="devices.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-10 bg-card text-center shadow-xs">
          <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Tablet :size="18" class="text-muted-foreground/70" />
          </div>
          <p class="text-sm font-medium text-foreground">No devices yet</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">Add a device to start syncing your books to your Kobo.</p>
        </div>

        <div v-else-if="devices.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div v-for="device in devices" :key="device.id" class="px-5 py-4 bg-card transition-colors hover:bg-muted/30">
            <div v-if="renamingId === device.id" class="flex items-center gap-2">
              <input
                v-model="renameValue"
                type="text"
                class="flex-1 input-field"
                @keydown.enter="submitRename(device)"
                @keydown.esc="cancelRename()"
              />
              <button class="settings-btn-primary" :disabled="renaming || !renameValue.trim()" @click="submitRename(device)">Save</button>
              <button class="settings-btn-outline h-9 w-9 p-0 flex items-center justify-center" @click="cancelRename()">
                <X :size="14" />
              </button>
            </div>
            <div v-else class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                <Tablet :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="settings-label truncate leading-none mb-1.5">{{ device.name }}</p>
                <p class="settings-hint leading-none">Last sync: {{ formatLastSeen(device.lastSeenAt) }}</p>
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="startRename(device)"
                  title="Rename device"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  @click="revoke(device)"
                  title="Revoke access"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Setup Tip / Collection Sync Notice -->
      <div class="mb-8 p-4 rounded-lg bg-primary/5 border border-primary/10 shadow-xs max-w-4xl">
        <div class="flex items-start gap-3">
          <Info :size="18" class="text-primary shrink-0 mt-0.5" />
          <div class="space-y-1.5">
            <p class="text-sm font-semibold text-foreground">How books are synced</p>
            <p class="text-xs leading-relaxed text-muted-foreground">
              To send books to your Kobo device, you must enable
              <strong class="text-foreground font-medium">Sync to Kobo</strong> on the collections containing those books. Open any collection from
              the sidebar, click the Edit icon, and toggle <strong class="text-foreground font-medium">Sync to Kobo</strong>. Books that are not part
              of an enabled collection will not sync.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync history -->
    <div v-show="activeTab === 'activity' && !props.embedded" class="mb-8">
      <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <p class="settings-group-label mb-0">Recent Kobo Activity</p>
            <span v-if="latestHistoryEntry" class="h-2 w-2 shrink-0 rounded-full" :class="historyStatusDotClass(latestHistoryEntry)" />
          </div>
          <p class="settings-hint mt-1 truncate" :title="historyHeaderDetail">{{ historyHeaderDetail }}</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="inline-flex h-8 rounded-md border border-border bg-muted p-0.5">
            <button
              class="rounded-[4px] px-2.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5"
              :class="historyFilter === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              @click="showAllHistory"
            >
              <span>All</span>
              <span
                v-if="syncHistory.length > 0"
                class="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold"
                :class="historyFilter === 'all' ? 'text-foreground/80' : 'text-muted-foreground'"
              >
                {{ syncHistory.length }}
              </span>
            </button>
            <button
              class="rounded-[4px] px-2.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5"
              :class="historyFilter === 'failures' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              @click="showFailedHistory"
            >
              <span>Failures</span>
              <span v-if="recentFailureCount > 0" class="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                {{ recentFailureCount }}
              </span>
            </button>
          </div>
          <button
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="refreshingHistory || historyLoading"
            @click="refreshHistory"
          >
            <RefreshCw :size="12" :class="{ 'animate-spin': refreshingHistory || historyLoading }" />
            Refresh
          </button>
        </div>
      </div>

      <div class="border border-border rounded-lg bg-card p-6 shadow-xs">
        <div v-if="historyLoading && !hasSyncHistory" class="text-sm text-muted-foreground">Loading Kobo activity...</div>
        <div v-else-if="!hasSyncHistory" class="text-center py-4">
          <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <History :size="18" class="text-muted-foreground/80" />
          </div>
          <p class="text-sm font-medium text-foreground">No Kobo activity yet</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Recent sync activity will appear after a paired Kobo contacts BookOrbit.</p>
        </div>
        <template v-else>
          <div v-if="filteredSyncHistory.length === 0" class="text-sm text-muted-foreground">
            {{ filteredHistoryEmptyLabel }}
          </div>

          <div v-else class="relative">
            <!-- Vertical track line -->
            <div class="absolute left-[13px] top-3 bottom-3 w-0.5 bg-border/60"></div>

            <TransitionGroup name="timeline" tag="div" class="space-y-6">
              <div v-for="item in displayedSyncHistory" :key="item.key" class="relative pl-10">
                <!-- Icon status indicator -->
                <div
                  class="absolute left-0 top-0 h-7 w-7 rounded-full border bg-card flex items-center justify-center shadow-xs overflow-hidden"
                  :class="
                    item.primary.status === 'failed'
                      ? 'border-destructive/20 text-destructive'
                      : isHistoryNoOp(item.primary)
                        ? 'border-border text-muted-foreground'
                        : 'border-primary/20 text-primary'
                  "
                >
                  <div
                    class="h-full w-full rounded-full flex items-center justify-center"
                    :class="item.primary.status === 'failed' ? 'bg-destructive/10' : isHistoryNoOp(item.primary) ? 'bg-muted/10' : 'bg-primary/10'"
                  >
                    <component :is="getHistoryEventIcon(item.primary.event)" :size="12" class="stroke-[2.5]" />
                  </div>
                </div>

                <div class="flex flex-col gap-1.5 pt-0.5">
                  <!-- Header: Title, Outcome Badge, Time -->
                  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="min-w-0 text-sm font-semibold text-foreground leading-snug">{{ historyItemTitle(item) }}</span>
                      <span
                        class="shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider leading-none"
                        :class="historyOutcomeClass(item.primary)"
                      >
                        {{ historyItemOutcomeText(item) }}
                      </span>
                    </div>
                    <span class="text-xs text-muted-foreground/80" :title="historyItemTimeTitle(item)">
                      {{ formatLastSeen(item.primary.createdAt) }}
                    </span>
                  </div>

                  <!-- Messages / Details -->
                  <div class="min-w-0">
                    <p class="text-sm text-foreground/80 leading-normal">{{ historyItemSummary(item) }}</p>
                    <p v-if="historyItemSecondaryText(item)" class="mt-0.5 text-xs text-muted-foreground leading-normal">
                      {{ historyItemSecondaryText(item) }}
                    </p>
                  </div>

                  <!-- Callout block for Errors -->
                  <div
                    v-if="item.primary.error"
                    class="mt-1 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"
                  >
                    <div class="flex flex-col gap-1 min-w-0">
                      <span class="font-semibold">{{ item.primary.errorClass ?? 'Error' }}</span>
                      <p class="whitespace-pre-wrap break-all leading-normal text-destructive/90">{{ item.primary.error }}</p>
                    </div>
                  </div>

                  <!-- Footer Metadata row -->
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/60">
                    <div class="flex items-center gap-1">
                      <Tablet :size="12" class="text-muted-foreground/40" />
                      <span>{{ historyDeviceName(item.primary) }}</span>
                    </div>
                    <div v-if="historyItemGroupedLabel(item)" class="flex items-center gap-1">
                      <History :size="12" class="text-muted-foreground/40" />
                      <span>{{ historyItemGroupedLabel(item) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </TransitionGroup>

            <!-- Load More -->
            <div v-if="syncHistory.length >= currentLimit && currentLimit < 100" class="mt-6 pl-10">
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 shadow-xs"
                :disabled="loadingMore || historyLoading"
                @click="loadMoreHistory"
              >
                <RefreshCw v-if="loadingMore || historyLoading" :size="12" class="animate-spin" />
                <span>{{ loadingMore || historyLoading ? 'Loading...' : 'Load more activity' }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Sync settings -->
    <div v-show="activeTab === 'settings' || props.embedded" class="mb-8">
      <p class="settings-group-label">Sync Preferences</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Two-way progress sync</p>
            <p class="settings-hint">
              Sync reading position between BookOrbit and Kobo. Requires KEPUB delivery for precise locations and reliable page restore.
            </p>
          </div>
          <ToggleSwitch v-model="twoWayProgressSync" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Sync BookOrbit highlights to Kobo</p>
            <p class="settings-hint">
              Send highlights made in BookOrbit or KOReader to your Kobo. Kobo highlights are imported into BookOrbit even when this is off. Linked
              annotations sync edits and deletes both ways. Requires KEPUB delivery; the book on Kobo must be the KEPUB downloaded from BookOrbit.
            </p>
          </div>
          <ToggleSwitch v-model="syncBookOrbitAnnotationsToKobo" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Convert to KEPUB</p>
            <p class="settings-hint">
              Send eligible EPUBs as KEPUB. This stays on when progress sync or BookOrbit-to-Kobo highlights are enabled. On the next Kobo sync,
              affected books are offered again as KEPUB downloads; remove any old EPUB copy if Kobo keeps opening it.
            </p>
          </div>
          <ToggleSwitch v-model="convertToKepub" :disabled="twoWayProgressSync || syncBookOrbitAnnotationsToKobo" />
        </div>

        <div v-if="convertToKepub" class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Force hyphenation</p>
            <p class="settings-hint">Ensures consistent text justification. This will regenerate cached KEPUBs.</p>
          </div>
          <ToggleSwitch v-model="forceEnableHyphenation" />
        </div>

        <div class="px-5 py-5 bg-card space-y-5">
          <div>
            <p class="settings-label mb-1">Progress Thresholds</p>
            <p class="settings-hint">Define when Kobo reading progress updates your library status.</p>
          </div>

          <div class="grid sm:grid-cols-2 gap-6">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">Mark as Reading</label>
                <span class="text-xs font-mono text-primary font-bold">{{ readingThreshold }}%</span>
              </div>
              <input v-model.number="readingThreshold" type="range" min="0.5" max="10" step="0.5" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">Minimum percentage to move a book to "Reading".</p>
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">Mark as Finished</label>
                <span class="text-xs font-mono text-primary font-bold">{{ finishedThreshold }}%</span>
              </div>
              <input v-model.number="finishedThreshold" type="range" min="75" max="100" step="1" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">Percentage threshold to mark a book as "Finished".</p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">KEPUB conversion limit</label>
              <span class="text-xs font-mono text-primary font-bold">{{ kepubConversionLimitMb }} MB</span>
            </div>
            <input v-model.number="kepubConversionLimitMb" type="range" min="1" max="500" step="5" class="w-full accent-primary cursor-pointer" />
            <p class="text-[12px] text-muted-foreground mt-2">
              Books above this limit are sent as regular EPUBs, so BookOrbit will not sync their reader position back to Kobo.
            </p>
          </div>
        </div>

        <div class="px-5 py-4 bg-muted/30 flex items-center justify-between">
          <div v-if="settingsError" class="text-xs text-destructive font-medium flex items-center gap-1.5"><X :size="14" /> {{ settingsError }}</div>
          <div v-else class="text-[12px] text-muted-foreground italic">Changes must be saved to take effect.</div>

          <button class="settings-btn-primary" :disabled="savingSettings" @click="saveSettings()">
            {{ savingSettings ? 'Saving...' : 'Save Sync Settings' }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.timeline-enter-active,
.timeline-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.timeline-enter-from,
.timeline-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.timeline-leave-active {
  position: absolute;
  width: 100%;
}
.timeline-move {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
