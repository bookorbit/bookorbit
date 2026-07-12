<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/i18n/formatters'
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

const { t } = useI18n()
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
  if (!latestHistoryEntry.value) return t('settings.reader.kobo.activity.waitingForActivity')
  return latestHistoryEntry.value.status === 'failed'
    ? t('settings.reader.kobo.activity.needsAttention')
    : t('settings.reader.kobo.activity.syncHealthy')
})
const latestSuccessLabel = computed(() =>
  latestSuccessfulActivity.value ? formatLastSeen(latestSuccessfulActivity.value.createdAt) : t('settings.reader.kobo.activity.never'),
)
const latestFailureLabel = computed(() =>
  latestFailedActivity.value ? formatLastSeen(latestFailedActivity.value.createdAt) : t('settings.reader.kobo.activity.none'),
)
const recentFailureLabel = computed(() =>
  t('settings.reader.kobo.activity.failureCount', { count: recentFailureCount.value }, recentFailureCount.value),
)
const historyHeaderDetail = computed(() => {
  if (!latestHistoryEntry.value) return t('settings.reader.kobo.activity.noActivityRecorded')
  const parts = [syncHealthLabel.value, t('settings.reader.kobo.activity.lastSuccess', { time: latestSuccessLabel.value })]
  if (latestFailedActivity.value) parts.push(t('settings.reader.kobo.activity.lastFailure', { time: latestFailureLabel.value }))
  if (recentFailureCount.value > 0) parts.push(recentFailureLabel.value)
  return parts.join(' · ')
})
const filteredHistoryEmptyLabel = computed(() =>
  historyFilter.value === 'failures' ? t('settings.reader.kobo.activity.noFailedActivity') : t('settings.reader.kobo.activity.noActivityYet'),
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
  if (!date) return t('settings.reader.kobo.never')
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return t('settings.reader.kobo.justNow')
  if (diffMins < 60) return t('settings.reader.kobo.minutesAgo', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('settings.reader.kobo.hoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  return t('settings.reader.kobo.daysAgo', { count: diffDays })
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return t('settings.reader.kobo.activity.unknown')
  return formatDate(new Date(date), { dateStyle: 'medium', timeStyle: 'short' })
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

const historyEventLabels = computed<Record<KoboSyncHistoryEntry['event'], string>>(() => ({
  library_sync: t('settings.reader.kobo.activity.event.librarySync'),
  book_download: t('settings.reader.kobo.activity.event.bookDownload'),
  progress_update: t('settings.reader.kobo.activity.event.progressUpdate'),
  annotations_pull: t('settings.reader.kobo.activity.event.annotationsPull'),
  annotations_push: t('settings.reader.kobo.activity.event.annotationsPush'),
}))

function formatHistoryEvent(event: KoboSyncHistoryEntry['event']): string {
  return historyEventLabels.value[event]
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
  if (entry.status === 'failed') return t('settings.reader.kobo.activity.outcome.failed')

  if (isHistoryNoOp(entry)) {
    switch (entry.event) {
      case 'library_sync':
        return t('settings.reader.kobo.activity.outcome.noUpdates')
      case 'annotations_pull':
      case 'annotations_push':
        return t('settings.reader.kobo.activity.outcome.noChanges')
    }
  }

  switch (entry.event) {
    case 'library_sync':
      return historyCountBoolean(entry, 'hasMore')
        ? t('settings.reader.kobo.activity.outcome.pending')
        : t('settings.reader.kobo.activity.outcome.completed')
    case 'book_download':
      return t('settings.reader.kobo.activity.outcome.downloaded')
    case 'progress_update':
      return t('settings.reader.kobo.activity.outcome.updated')
    case 'annotations_pull':
      return t('settings.reader.kobo.activity.outcome.sent')
    case 'annotations_push':
      return t('settings.reader.kobo.activity.outcome.imported')
  }
}

function historyFailureSummary(entry: KoboSyncHistoryEntry): string {
  switch (entry.event) {
    case 'library_sync':
      return t('settings.reader.kobo.activity.failure.librarySync')
    case 'book_download':
      return t('settings.reader.kobo.activity.failure.bookDownload')
    case 'progress_update':
      return t('settings.reader.kobo.activity.failure.progressUpdate')
    case 'annotations_pull':
      return t('settings.reader.kobo.activity.failure.annotationsPull')
    case 'annotations_push':
      return t('settings.reader.kobo.activity.failure.annotationsPush')
  }
}

function historyDetailChips(entry: KoboSyncHistoryEntry): string[] {
  switch (entry.event) {
    case 'library_sync': {
      return [
        historyCountBoolean(entry, 'hasMore')
          ? t('settings.reader.kobo.activity.chip.morePending')
          : t('settings.reader.kobo.activity.chip.noUpdatesPending'),
      ]
    }
    case 'book_download': {
      const count = historyCountNumber(entry, 'downloads') || 1
      return [t('settings.reader.kobo.activity.chip.bookCount', { count }, count)]
    }
    case 'progress_update':
      return [progressSyncModeText(entry)]
    case 'annotations_pull': {
      const labels: string[] = []
      const tombstones = historyCountNumber(entry, 'tombstones')
      if (tombstones > 0) labels.push(t('settings.reader.kobo.activity.chip.deletedAnnotations', { count: tombstones }, tombstones))
      labels.push(
        historyCountBoolean(entry, 'notModified')
          ? t('settings.reader.kobo.activity.chip.deviceAlreadyCurrent')
          : t('settings.reader.kobo.activity.chip.freshHighlightData'),
      )
      return labels
    }
    case 'annotations_push': {
      const labels: string[] = []
      const created = historyCountNumber(entry, 'created')
      const updated = historyCountNumber(entry, 'updated')
      const deleted = historyCountNumber(entry, 'deleted')
      const unchanged = historyCountNumber(entry, 'unchanged')
      if (created > 0) labels.push(t('settings.reader.kobo.activity.chip.created', { count: created }))
      if (updated > 0) labels.push(t('settings.reader.kobo.activity.chip.updated', { count: updated }))
      if (deleted > 0) labels.push(t('settings.reader.kobo.activity.chip.deleted', { count: deleted }))
      if (unchanged > 0) labels.push(t('settings.reader.kobo.activity.chip.unchanged', { count: unchanged }))
      return labels.length > 0 ? labels : [t('settings.reader.kobo.activity.outcome.noChanges')]
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
    return title ? t('settings.reader.kobo.activity.readingPositionSyncedTitle', { title }) : t('settings.reader.kobo.activity.readingPositionSynced')
  }

  const label = formatHistoryEvent(entry.event)
  if (!title || entry.event === 'library_sync') return label
  return t('settings.reader.kobo.activity.labelWithTitle', { label, title })
}

function historyItemOutcomeText(item: HistoryDisplayItem): string {
  return isGroupedHistoryItem(item)
    ? t('settings.reader.kobo.activity.updateCount', { count: item.entries.length }, item.entries.length)
    : historyOutcomeText(item.primary)
}

function historyDirectionText(entry: KoboSyncHistoryEntry): string {
  switch (entry.event) {
    case 'library_sync':
    case 'book_download':
    case 'annotations_pull':
      return t('settings.reader.kobo.activity.directionToKobo')
    case 'progress_update':
    case 'annotations_push':
      return t('settings.reader.kobo.activity.directionToBookOrbit')
  }
}

function progressSyncModeText(entry: KoboSyncHistoryEntry): string {
  return historyCountBoolean(entry, 'twoWayProgressSync')
    ? t('settings.reader.kobo.activity.twoWaySyncEnabled')
    : t('settings.reader.kobo.activity.deviceProgressSaved')
}

function historyItemSummary(item: HistoryDisplayItem): string {
  const entry = item.primary
  if (entry.status === 'failed') return historyFailureSummary(entry)

  const title = historyBookTitle(entry)
  switch (entry.event) {
    case 'library_sync': {
      const updates = historyCountNumber(entry, 'entitlements')
      if (updates === 0) return t('settings.reader.kobo.activity.summary.noLibraryUpdatesPending')
      return t('settings.reader.kobo.activity.summary.libraryUpdatesPrepared', { count: updates }, updates)
    }
    case 'book_download':
      if (title) return t('settings.reader.kobo.activity.summary.bookDownloadedBy', { title, device: historyDeviceName(entry) })
      return t(
        'settings.reader.kobo.activity.summary.booksDownloaded',
        { count: historyCountNumber(entry, 'downloads') || 1 },
        historyCountNumber(entry, 'downloads') || 1,
      )
    case 'progress_update':
      if (isGroupedHistoryItem(item)) {
        return title
          ? t('settings.reader.kobo.activity.summary.progressUpdatesSyncedFor', { count: item.entries.length, title }, item.entries.length)
          : t('settings.reader.kobo.activity.summary.progressUpdatesSynced', { count: item.entries.length }, item.entries.length)
      }
      return title
        ? t('settings.reader.kobo.activity.summary.newReadingPositionFor', { title })
        : t('settings.reader.kobo.activity.summary.newReadingPosition')
    case 'annotations_pull': {
      const served = historyCountNumber(entry, 'served')
      if (served === 0)
        return title
          ? t('settings.reader.kobo.activity.summary.noHighlightChangesNeededFor', { title })
          : t('settings.reader.kobo.activity.summary.noHighlightChangesNeeded')
      return title
        ? t('settings.reader.kobo.activity.summary.highlightsSentToKoboFor', { count: served, title }, served)
        : t('settings.reader.kobo.activity.summary.highlightsSentToKobo', { count: served }, served)
    }
    case 'annotations_push': {
      const changed = historyCountNumber(entry, 'created') + historyCountNumber(entry, 'updated') + historyCountNumber(entry, 'deleted')
      if (changed === 0)
        return title
          ? t('settings.reader.kobo.activity.summary.noKoboHighlightChangesFor', { title })
          : t('settings.reader.kobo.activity.summary.noKoboHighlightChanges')
      return title
        ? t('settings.reader.kobo.activity.summary.highlightsImportedFromKoboFor', { count: changed, title }, changed)
        : t('settings.reader.kobo.activity.summary.highlightsImportedFromKobo', { count: changed }, changed)
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
  return t('settings.reader.kobo.activity.timeRange', {
    from: formatDateTime(oldest?.createdAt),
    to: formatDateTime(item.primary.createdAt),
  })
}

function historyItemGroupedLabel(item: HistoryDisplayItem): string {
  return isGroupedHistoryItem(item) ? t('settings.reader.kobo.activity.eventsGrouped', { count: item.entries.length }, item.entries.length) : ''
}

function historyDeviceName(entry: KoboSyncHistoryEntry): string {
  return entry.deviceName ?? t('settings.reader.kobo.activity.removedDevice')
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
    toast.error(e instanceof Error ? e.message : t('settings.reader.kobo.activity.loadMoreFailed'))
  } finally {
    loadingMore.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([fetchDevices(), fetchSettings(), fetchHistory(currentLimit.value)])
    applySettingsToLocal()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('settings.reader.kobo.loadFailed')
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
    toast.success(t('settings.reader.kobo.deviceRegistered', { name: device.name }))
  } catch (e) {
    createError.value = e instanceof Error ? e.message : t('settings.reader.kobo.createDeviceFailed')
    toast.error(createError.value ?? t('settings.reader.kobo.createDeviceFailed'))
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
    toast.success(t('settings.reader.kobo.syncUrlCopied'))
  } else {
    toast.error(t('settings.reader.kobo.syncUrlCopyFailed'))
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
    toast.success(t('settings.reader.kobo.deviceRenamed'))
    renamingId.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.kobo.renameDeviceFailed'))
  } finally {
    renaming.value = false
  }
}

async function revoke(device: KoboDevice) {
  if (!confirm(t('settings.reader.kobo.revokeConfirm', { name: device.name }))) return
  try {
    await revokeDevice(device.id)
    toast.success(t('settings.reader.kobo.accessRevoked', { name: device.name }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.kobo.revokeFailed'))
  }
}

async function refreshHistory() {
  refreshingHistory.value = true
  try {
    await fetchHistory(currentLimit.value)
    toast.success(t('settings.reader.kobo.activity.historyRefreshed'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.kobo.activity.refreshFailed'))
  } finally {
    refreshingHistory.value = false
  }
}

async function saveSettings() {
  if (readingThreshold.value >= finishedThreshold.value) {
    settingsError.value = t('settings.reader.kobo.thresholdOrderError')
    toast.error(settingsError.value ?? t('settings.reader.kobo.saveSettingsFailed'))
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
    toast.success(t('settings.reader.kobo.settingsSaved'))
  } catch (e) {
    settingsError.value = e instanceof Error ? e.message : t('settings.reader.kobo.saveFailed')
    toast.error(settingsError.value ?? t('settings.reader.kobo.saveSettingsFailed'))
  } finally {
    savingSettings.value = false
  }
}
</script>

<template>
  <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.kobo.title')" :subtitle="t('settings.reader.kobo.subtitle')" />

  <div v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</div>
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
        {{ t('settings.reader.kobo.tabs.syncSettings') }}
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
        {{ t('settings.reader.kobo.tabs.activityLog') }}
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
              <p class="settings-label leading-none mb-0.5">{{ t('settings.reader.kobo.devicePaired') }}</p>
              <p class="settings-hint">{{ t('settings.reader.kobo.devicePairedHint') }}</p>
            </div>
          </div>
          <button @click="dismissToken()" class="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
            <X :size="18" />
          </button>
        </div>

        <div class="space-y-4">
          <div class="bg-background rounded-lg border border-border p-4">
            <p class="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2.5">{{ t('settings.reader.kobo.syncUrl') }}</p>
            <div class="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-muted/30">
              <Tablet :size="14" class="text-muted-foreground shrink-0" />
              <span class="flex-1 text-sm text-foreground font-mono select-all truncate min-w-0">{{ newDeviceSyncUrl }}</span>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
                @click="copyToken()"
              >
                <Copy :size="12" />
                {{ t('settings.reader.kobo.copy') }}
              </button>
            </div>
          </div>
          <div
            class="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md border border-amber-200 dark:border-amber-900/50"
          >
            <X :size="14" class="shrink-0" />
            {{ t('settings.reader.kobo.urlNotShownAgain') }}
          </div>
          <div class="flex items-start gap-2.5 rounded-md border border-border bg-background p-4 text-xs mt-4">
            <Info :size="16" class="text-primary shrink-0 mt-0.5" />
            <div class="space-y-1">
              <p class="font-semibold text-foreground">{{ t('settings.reader.kobo.nextSteps.title') }}</p>
              <p class="text-muted-foreground leading-normal">{{ t('settings.reader.kobo.nextSteps.step1') }}</p>
              <i18n-t keypath="settings.reader.kobo.nextSteps.step2" tag="p" class="text-muted-foreground leading-normal" scope="global">
                <template #syncToKobo>
                  <strong class="text-foreground">{{ t('settings.reader.kobo.syncToKobo') }}</strong>
                </template>
              </i18n-t>
            </div>
          </div>
        </div>
      </div>

      <!-- Devices -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.kobo.registeredDevices') }}</p>
          <button v-if="!showCreateForm" class="settings-btn-primary" @click="showCreateForm = true">
            <Plus :size="12" />
            {{ t('settings.reader.kobo.addDevice') }}
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showCreateForm" class="border border-border rounded-lg p-5 bg-card mb-4 space-y-4 shadow-xs">
          <div>
            <label class="settings-label block mb-1.5">{{ t('settings.reader.kobo.deviceName') }}</label>
            <input
              v-model="newDeviceName"
              type="text"
              :placeholder="t('settings.reader.kobo.deviceNamePlaceholder')"
              autofocus
              class="input-field w-full"
            />
          </div>
          <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
          <div class="flex items-center gap-2 pt-1">
            <button class="settings-btn-primary" :disabled="creating || !newDeviceName.trim()" @click="submitCreate()">
              {{ creating ? t('settings.reader.kobo.creating') : t('settings.reader.kobo.createDevice') }}
            </button>
            <button class="settings-btn-outline" @click="cancelCreate()">{{ t('common.cancel') }}</button>
          </div>
        </div>

        <div v-if="devices.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-10 bg-card text-center shadow-xs">
          <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Tablet :size="18" class="text-muted-foreground/70" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.kobo.noDevicesYet') }}</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">{{ t('settings.reader.kobo.noDevicesHint') }}</p>
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
              <button class="settings-btn-primary" :disabled="renaming || !renameValue.trim()" @click="submitRename(device)">
                {{ t('common.save') }}
              </button>
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
                <p class="settings-hint leading-none">{{ t('settings.reader.kobo.lastSync', { time: formatLastSeen(device.lastSeenAt) }) }}</p>
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="startRename(device)"
                  :title="t('settings.reader.kobo.renameDevice')"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  @click="revoke(device)"
                  :title="t('settings.reader.kobo.revokeAccess')"
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
            <p class="text-sm font-semibold text-foreground">{{ t('settings.reader.kobo.howBooksSynced.title') }}</p>
            <i18n-t keypath="settings.reader.kobo.howBooksSynced.body" tag="p" class="text-xs leading-relaxed text-muted-foreground" scope="global">
              <template #syncToKobo>
                <strong class="text-foreground font-medium">{{ t('settings.reader.kobo.syncToKobo') }}</strong>
              </template>
            </i18n-t>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync history -->
    <div v-show="activeTab === 'activity' && !props.embedded" class="mb-8">
      <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <p class="settings-group-label mb-0">{{ t('settings.reader.kobo.activity.recentActivity') }}</p>
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
              <span>{{ t('settings.reader.kobo.activity.filterAll') }}</span>
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
              <span>{{ t('settings.reader.kobo.activity.filterFailures') }}</span>
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
            {{ t('settings.reader.kobo.activity.refresh') }}
          </button>
        </div>
      </div>

      <div class="border border-border rounded-lg bg-card p-6 shadow-xs">
        <div v-if="historyLoading && !hasSyncHistory" class="text-sm text-muted-foreground">
          {{ t('settings.reader.kobo.activity.loadingActivity') }}
        </div>
        <div v-else-if="!hasSyncHistory" class="text-center py-4">
          <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <History :size="18" class="text-muted-foreground/80" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.kobo.activity.noActivityYet') }}</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{{ t('settings.reader.kobo.activity.noActivityHint') }}</p>
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
                      <span class="font-semibold">{{ item.primary.errorClass ?? t('settings.reader.kobo.activity.error') }}</span>
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
                <span>{{
                  loadingMore || historyLoading ? t('settings.reader.kobo.activity.loading') : t('settings.reader.kobo.activity.loadMore')
                }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Sync settings -->
    <div v-show="activeTab === 'settings' || props.embedded" class="mb-8">
      <p class="settings-group-label">{{ t('settings.reader.kobo.syncPreferences') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">{{ t('settings.reader.kobo.twoWaySync') }}</p>
            <p class="settings-hint">
              {{ t('settings.reader.kobo.twoWaySyncHint') }}
            </p>
          </div>
          <ToggleSwitch v-model="twoWayProgressSync" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">{{ t('settings.reader.kobo.syncHighlights') }}</p>
            <p class="settings-hint">
              {{ t('settings.reader.kobo.syncHighlightsHint') }}
            </p>
          </div>
          <ToggleSwitch v-model="syncBookOrbitAnnotationsToKobo" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">{{ t('settings.reader.kobo.convertKepub') }}</p>
            <p class="settings-hint">
              {{ t('settings.reader.kobo.convertKepubHint') }}
            </p>
          </div>
          <ToggleSwitch v-model="convertToKepub" :disabled="twoWayProgressSync || syncBookOrbitAnnotationsToKobo" />
        </div>

        <div v-if="convertToKepub" class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">{{ t('settings.reader.kobo.forceHyphenation') }}</p>
            <p class="settings-hint">{{ t('settings.reader.kobo.forceHyphenationHint') }}</p>
          </div>
          <ToggleSwitch v-model="forceEnableHyphenation" />
        </div>

        <div class="px-5 py-5 bg-card space-y-5">
          <div>
            <p class="settings-label mb-1">{{ t('settings.reader.kobo.progressThresholds') }}</p>
            <p class="settings-hint">{{ t('settings.reader.kobo.progressThresholdsHint') }}</p>
          </div>

          <div class="grid sm:grid-cols-2 gap-6">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">{{
                  t('settings.reader.kobo.markAsReading')
                }}</label>
                <span class="text-xs font-mono text-primary font-bold">{{ readingThreshold }}%</span>
              </div>
              <input v-model.number="readingThreshold" type="range" min="0.5" max="10" step="0.5" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">{{ t('settings.reader.kobo.markAsReadingHint') }}</p>
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">{{
                  t('settings.reader.kobo.markAsFinished')
                }}</label>
                <span class="text-xs font-mono text-primary font-bold">{{ finishedThreshold }}%</span>
              </div>
              <input v-model.number="finishedThreshold" type="range" min="75" max="100" step="1" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">{{ t('settings.reader.kobo.markAsFinishedHint') }}</p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.reader.kobo.kepubLimit') }}</label>
              <span class="text-xs font-mono text-primary font-bold">{{ kepubConversionLimitMb }} MB</span>
            </div>
            <input v-model.number="kepubConversionLimitMb" type="range" min="1" max="500" step="5" class="w-full accent-primary cursor-pointer" />
            <p class="text-[12px] text-muted-foreground mt-2">
              {{ t('settings.reader.kobo.kepubLimitHint') }}
            </p>
          </div>
        </div>

        <div class="px-5 py-4 bg-muted/30 flex items-center justify-between">
          <div v-if="settingsError" class="text-xs text-destructive font-medium flex items-center gap-1.5"><X :size="14" /> {{ settingsError }}</div>
          <div v-else class="text-[12px] text-muted-foreground italic">{{ t('settings.reader.kobo.changesMustBeSaved') }}</div>

          <button class="settings-btn-primary" :disabled="savingSettings" @click="saveSettings()">
            {{ savingSettings ? t('settings.reader.kobo.saving') : t('settings.reader.kobo.saveSyncSettings') }}
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
