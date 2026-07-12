<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  Library,
  Link2,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  User,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookCard, KoreaderDeviceInfo, KoreaderManualHashLink, KoreaderUnmatchedBook } from '@bookorbit/types'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { useKoreaderSync } from '@/features/koreader/composables/useKoreaderSync'
import { useGlobalSearch } from '@/features/book/composables/useGlobalSearch'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const {
  credentials,
  syncStatus,
  unmatchedBooks,
  manualHashLinks,
  loading,
  unmatchedLoading,
  manualLinksLoading,
  fetchSyncStatus,
  fetchUnmatchedBooks,
  fetchManualHashLinks,
  createCredentials,
  updateCredentials,
  deleteCredentials,
  getSyncUrl,
  downloadPluginPackage,
  linkUnmatchedBook,
  dismissUnmatchedBook,
  dismissAllUnmatchedBooks,
  relinkManualHashLink,
  unlinkManualHashLink,
  removeDevice,
} = useKoreaderSync()

const error = ref<string | null>(null)
const showSetupForm = ref(false)
const newUsername = ref('')
const newPassword = ref('')
const creating = ref(false)
const showPassword = ref(false)
const deleteConfirmOpen = ref(false)
const helpOpen = ref(false)
const urlCopied = ref(false)
const selectedUnmatched = ref<KoreaderUnmatchedBook | null>(null)
const selectedManualLink = ref<KoreaderManualHashLink | null>(null)
const linkSearchQuery = ref('')
const linkingBookId = ref<number | null>(null)
const pendingLinkTarget = ref<BookCard | null>(null)
const unlinkConfirmLink = ref<KoreaderManualHashLink | null>(null)
const unlinkingHash = ref<string | null>(null)
const removeDeviceConfirmTarget = ref<KoreaderDeviceInfo | null>(null)
const removingDeviceId = ref<string | null>(null)
const dismissConfirmBook = ref<KoreaderUnmatchedBook | null>(null)
const dismissingHash = ref<string | null>(null)
const dismissAllConfirmOpen = ref(false)
const dismissingAll = ref(false)
const unmatchedPage = ref(1)
const unmatchedPageSize = 6
const {
  results: linkSearchResults,
  loading: linkSearchLoading,
  loadingMore: linkSearchLoadingMore,
  settled: linkSearchSettled,
  hasMore: linkSearchHasMore,
  loadMore: loadMoreLinkSearch,
  clear: clearLinkSearch,
} = useGlobalSearch(linkSearchQuery)

let urlCopiedTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
})

const syncUrl = computed(() => getSyncUrl())
const hasCredentials = computed(() => !!credentials.value)
const deviceCount = computed(() => syncStatus.value?.devices.length ?? 0)
const totalSyncedBooks = computed(() => syncStatus.value?.totalSyncedBooks ?? 0)
const sweeps = computed(() => syncStatus.value?.sweeps ?? [])
const pluginTotals = computed(
  () =>
    syncStatus.value?.pluginTotals ?? {
      matchedBooks: 0,
      pageStatEvents: 0,
      annotations: 0,
      trashedAnnotations: 0,
      pendingDeletes: 0,
      failedPositions: 0,
      unmatchedBooks: 0,
    },
)
const latestPluginVersion = computed(() => syncStatus.value?.latestPluginVersion ?? null)
const pluginUpdateAvailable = computed(() => syncStatus.value?.pluginUpdateAvailable ?? false)
const latestPluginLabel = computed(() =>
  latestPluginVersion.value
    ? t('settings.reader.koreader.latestPlugin', { version: latestPluginVersion.value })
    : t('settings.reader.koreader.latestPluginUnavailable'),
)
const pendingDeletes = computed(() => pluginTotals.value.pendingDeletes)
const failedPositions = computed(() => pluginTotals.value.failedPositions)
const unmatchedCount = computed(() => Math.max(pluginTotals.value.unmatchedBooks, unmatchedBooks.value.length))
const unmatchedTotalPages = computed(() => Math.max(1, Math.ceil(unmatchedBooks.value.length / unmatchedPageSize)))
const clampedUnmatchedPage = computed(() => Math.min(unmatchedPage.value, unmatchedTotalPages.value))
const pagedUnmatchedBooks = computed(() => {
  const start = (clampedUnmatchedPage.value - 1) * unmatchedPageSize
  return unmatchedBooks.value.slice(start, start + unmatchedPageSize)
})
const unmatchedPageStart = computed(() => (unmatchedBooks.value.length === 0 ? 0 : (clampedUnmatchedPage.value - 1) * unmatchedPageSize + 1))
const unmatchedPageEnd = computed(() => Math.min(clampedUnmatchedPage.value * unmatchedPageSize, unmatchedBooks.value.length))
const showUnmatchedPager = computed(() => unmatchedBooks.value.length > unmatchedPageSize)
const hasPluginActivity = computed(
  () =>
    sweeps.value.length > 0 ||
    pluginTotals.value.matchedBooks > 0 ||
    pluginTotals.value.pageStatEvents > 0 ||
    pluginTotals.value.annotations > 0 ||
    pluginTotals.value.trashedAnnotations > 0 ||
    pendingDeletes.value > 0 ||
    failedPositions.value > 0 ||
    unmatchedCount.value > 0,
)
const createDisabled = computed(() => creating.value || !newUsername.value || newPassword.value.length < 6)
const linkDialogOpen = computed(() => !!selectedUnmatched.value || !!selectedManualLink.value)
const selectedLinkHash = computed(() => selectedUnmatched.value?.hash ?? selectedManualLink.value?.hash ?? '')
const selectedLinkLabel = computed(() => {
  if (selectedUnmatched.value) return unmatchedBookTitle(selectedUnmatched.value)
  if (selectedManualLink.value) return manualLinkTitle(selectedManualLink.value)
  return ''
})
const selectedLinkSubtitle = computed(() => {
  if (selectedUnmatched.value) return unmatchedBookSubtitle(selectedUnmatched.value)
  if (selectedManualLink.value) return manualLinkSubtitle(selectedManualLink.value)
  return ''
})
const selectedLinkLastOpen = computed(() => selectedUnmatched.value?.lastOpen ?? selectedManualLink.value?.koreaderLastOpen ?? null)
const linkDialogTitle = computed(() =>
  selectedManualLink.value ? t('settings.reader.koreader.hashLinks.changeLinkTitle') : t('settings.reader.koreader.hashLinks.linkBookTitle'),
)

watch(unmatchedTotalPages, (totalPages) => {
  if (unmatchedPage.value > totalPages) unmatchedPage.value = totalPages
})

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return t('settings.reader.koreader.never')
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return t('settings.reader.koreader.justNow')
  if (diffMins < 60) return t('settings.reader.koreader.minutesAgo', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('settings.reader.koreader.hoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  return t('settings.reader.koreader.daysAgo', { count: diffDays })
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return t('settings.reader.koreader.unknown')
  return formatLocaleDate(new Date(dateStr), { dateStyle: 'medium' })
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return t('settings.reader.koreader.unknown')
  return formatLocaleDate(new Date(dateStr), { dateStyle: 'medium', timeStyle: 'short' })
}

function formatEpochSeconds(seconds: number | null | undefined): string {
  if (!seconds) return t('settings.reader.koreader.unknown')
  return formatDateTime(new Date(seconds * 1000).toISOString())
}

function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

function unmatchedBookTitle(book: KoreaderUnmatchedBook): string {
  return book.title?.trim() || t('settings.reader.koreader.hashLinks.unknownFile', { hash: shortHash(book.hash) })
}

function unmatchedBookSubtitle(book: KoreaderUnmatchedBook): string {
  if (book.authors?.trim()) return book.authors
  return book.title?.trim() ? t('settings.reader.koreader.hashLinks.unknownAuthor') : t('settings.reader.koreader.hashLinks.noTitleOrAuthor')
}

function manualLinkTitle(link: KoreaderManualHashLink): string {
  return link.koreaderTitle?.trim() || t('settings.reader.koreader.hashLinks.unknownFile', { hash: shortHash(link.hash) })
}

function manualLinkSubtitle(link: KoreaderManualHashLink): string {
  if (link.koreaderAuthors?.trim()) return link.koreaderAuthors
  return link.koreaderTitle?.trim() ? t('settings.reader.koreader.hashLinks.unknownAuthor') : t('settings.reader.koreader.hashLinks.noTitleOrAuthor')
}

function linkedBookTitle(link: KoreaderManualHashLink): string {
  return link.bookTitle?.trim() || t('settings.reader.koreader.hashLinks.bookNumber', { id: link.bookId })
}

function linkedBookAuthors(link: KoreaderManualHashLink): string {
  return link.bookAuthors.length > 0 ? link.bookAuthors.join(', ') : t('settings.reader.koreader.hashLinks.unknownAuthor')
}

function pluginUpdateText(updateAvailable: boolean | null): string {
  if (updateAvailable === true) return t('settings.reader.koreader.updateAvailable')
  if (updateAvailable === false) return t('settings.reader.koreader.upToDate')
  return t('settings.reader.koreader.versionUnknown')
}

function pluginUpdateClass(updateAvailable: boolean | null): string {
  if (updateAvailable === true) return 'border-primary/40 bg-primary/10 text-primary'
  if (updateAvailable === false) return 'border-border bg-muted text-muted-foreground'
  return 'border-border bg-background text-muted-foreground'
}

onMounted(async () => {
  try {
    await fetchSyncStatus()
    if (credentials.value) await Promise.all([fetchUnmatchedBooks(), fetchManualHashLinks()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('settings.reader.koreader.loadFailed')
  }
})

async function handleCreate() {
  creating.value = true
  try {
    await createCredentials({ username: newUsername.value, password: newPassword.value })
    showSetupForm.value = false
    helpOpen.value = false
    newUsername.value = ''
    newPassword.value = ''
    toast.success(t('settings.reader.koreader.credentialsCreated'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.createCredentialsFailed'))
  } finally {
    creating.value = false
  }
}

function handleShowSetupForm() {
  showSetupForm.value = true
}

function handleCancelSetup() {
  showSetupForm.value = false
}

function handleTogglePassword() {
  showPassword.value = !showPassword.value
}

function handleOpenDeleteConfirm() {
  deleteConfirmOpen.value = true
}

function handleCloseDeleteConfirm() {
  deleteConfirmOpen.value = false
}

function handleToggleHelp() {
  helpOpen.value = !helpOpen.value
}

async function handleToggleSync(newValue: boolean) {
  try {
    await updateCredentials({ syncEnabled: newValue })
    toast.success(newValue ? t('settings.reader.koreader.syncEnabled') : t('settings.reader.koreader.syncDisabled'))
  } catch {
    toast.error(t('settings.reader.koreader.toggleSyncFailed'))
  }
}

async function handleDelete() {
  try {
    await deleteCredentials()
    deleteConfirmOpen.value = false
    toast.success(t('settings.reader.koreader.credentialsDeleted'))
  } catch {
    toast.error(t('settings.reader.koreader.deleteCredentialsFailed'))
  }
}

async function handleCopyUrl() {
  const copied = await copyToClipboard(syncUrl.value)
  if (!copied) {
    toast.error(t('settings.reader.koreader.syncUrlCopyFailed'))
    return
  }

  urlCopied.value = true
  toast.success(t('settings.reader.koreader.syncUrlCopied'))
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
  urlCopiedTimer = setTimeout(() => {
    urlCopied.value = false
    urlCopiedTimer = null
  }, 2000)
}

async function handleRefresh() {
  try {
    await fetchSyncStatus(true)
    if (credentials.value) await Promise.all([fetchUnmatchedBooks(), fetchManualHashLinks()])
    toast.success(t('settings.reader.koreader.statusRefreshed'))
  } catch {
    toast.error(t('settings.reader.koreader.refreshFailed'))
  }
}

async function handleRefreshUnmatched() {
  try {
    await fetchUnmatchedBooks()
    unmatchedPage.value = 1
    toast.success(t('settings.reader.koreader.hashLinks.toast.unmatchedRefreshed'))
  } catch {
    toast.error(t('settings.reader.koreader.hashLinks.toast.unmatchedRefreshFailed'))
  }
}

function handlePreviousUnmatchedPage() {
  unmatchedPage.value = Math.max(1, clampedUnmatchedPage.value - 1)
}

function handleNextUnmatchedPage() {
  unmatchedPage.value = Math.min(unmatchedTotalPages.value, clampedUnmatchedPage.value + 1)
}

async function handleRefreshManualLinks() {
  try {
    await fetchManualHashLinks()
    toast.success(t('settings.reader.koreader.hashLinks.toast.manualRefreshed'))
  } catch {
    toast.error(t('settings.reader.koreader.hashLinks.toast.manualRefreshFailed'))
  }
}

function handleOpenLink(book: KoreaderUnmatchedBook) {
  selectedUnmatched.value = book
  selectedManualLink.value = null
  pendingLinkTarget.value = null
  clearLinkSearch()
  linkSearchQuery.value = book.title ?? ''
}

function handleOpenDismiss(book: KoreaderUnmatchedBook) {
  dismissConfirmBook.value = book
}

function handleCloseDismiss() {
  dismissConfirmBook.value = null
  dismissingHash.value = null
}

async function handleDismissUnmatchedBook() {
  if (!dismissConfirmBook.value) return
  dismissingHash.value = dismissConfirmBook.value.hash
  try {
    await dismissUnmatchedBook(dismissConfirmBook.value.hash)
    toast.success(t('settings.reader.koreader.hashLinks.toast.unmatchedDismissed'))
    handleCloseDismiss()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.hashLinks.toast.dismissFailed'))
  } finally {
    dismissingHash.value = null
  }
}

function handleOpenDismissAll() {
  dismissAllConfirmOpen.value = true
}

function handleCloseDismissAll() {
  dismissAllConfirmOpen.value = false
}

async function handleDismissAllUnmatchedBooks() {
  dismissingAll.value = true
  try {
    const result = await dismissAllUnmatchedBooks()
    toast.success(t('settings.reader.koreader.hashLinks.toast.allDismissed', { count: result.count }, result.count))
    dismissAllConfirmOpen.value = false
    unmatchedPage.value = 1
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.hashLinks.toast.dismissAllFailed'))
  } finally {
    dismissingAll.value = false
  }
}

function handleOpenRelink(link: KoreaderManualHashLink) {
  selectedManualLink.value = link
  selectedUnmatched.value = null
  pendingLinkTarget.value = null
  clearLinkSearch()
  linkSearchQuery.value = link.koreaderTitle ?? link.bookTitle ?? ''
}

function handleCloseLink() {
  selectedUnmatched.value = null
  selectedManualLink.value = null
  pendingLinkTarget.value = null
  linkingBookId.value = null
  linkSearchQuery.value = ''
  clearLinkSearch()
}

function handleChooseLinkTarget(book: BookCard) {
  pendingLinkTarget.value = book
}

function handleClearLinkTarget() {
  pendingLinkTarget.value = null
}

async function handleLoadMoreLinkSearch() {
  await loadMoreLinkSearch()
}

async function handleConfirmLinkTarget() {
  if (!pendingLinkTarget.value || !selectedLinkHash.value) return
  const target = pendingLinkTarget.value
  linkingBookId.value = target.id
  try {
    if (selectedManualLink.value) {
      await relinkManualHashLink(selectedLinkHash.value, { bookId: target.id })
      toast.success(t('settings.reader.koreader.hashLinks.toast.linkUpdated'))
    } else {
      await linkUnmatchedBook(selectedLinkHash.value, { bookId: target.id })
      toast.success(t('settings.reader.koreader.hashLinks.toast.bookLinked'))
    }
    handleCloseLink()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.hashLinks.toast.linkFailed'))
  } finally {
    linkingBookId.value = null
  }
}

function handleOpenUnlink(link: KoreaderManualHashLink) {
  unlinkConfirmLink.value = link
}

function handleCloseUnlink() {
  unlinkConfirmLink.value = null
  unlinkingHash.value = null
}

async function handleUnlinkManualLink() {
  if (!unlinkConfirmLink.value) return
  unlinkingHash.value = unlinkConfirmLink.value.hash
  try {
    await unlinkManualHashLink(unlinkConfirmLink.value.hash)
    toast.success(t('settings.reader.koreader.hashLinks.toast.linkRemoved'))
    handleCloseUnlink()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.hashLinks.toast.unlinkFailed'))
  } finally {
    unlinkingHash.value = null
  }
}

function handleOpenRemoveDevice(device: KoreaderDeviceInfo) {
  removeDeviceConfirmTarget.value = device
}

function handleCloseRemoveDevice() {
  removeDeviceConfirmTarget.value = null
  removingDeviceId.value = null
}

async function handleRemoveDevice() {
  if (!removeDeviceConfirmTarget.value) return
  removingDeviceId.value = removeDeviceConfirmTarget.value.deviceId
  try {
    await removeDevice(removeDeviceConfirmTarget.value.deviceId)
    toast.success(t('settings.reader.koreader.deviceRemoved'))
    handleCloseRemoveDevice()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.removeDeviceFailed'))
  } finally {
    removingDeviceId.value = null
  }
}

function bookSearchSubtitle(book: BookCard): string {
  const authors = book.authors.length > 0 ? book.authors.join(', ') : t('settings.reader.koreader.hashLinks.unknownAuthor')
  const formats = book.files
    .map((file) => file.format)
    .filter(Boolean)
    .join(', ')
  return formats ? `${authors} - ${formats}` : authors
}

const downloadingPlugin = ref(false)

async function handleDownloadPlugin() {
  downloadingPlugin.value = true
  try {
    await downloadPluginPackage()
    toast.success(t('settings.reader.koreader.pluginDownloaded'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.pluginDownloadFailed'))
  } finally {
    downloadingPlugin.value = false
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.reader.koreader.title')"
    :subtitle="t('settings.reader.koreader.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.koreader.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.reader.koreader.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 border border-border rounded-lg px-5 py-8 bg-card text-sm text-muted-foreground shadow-xs">
    {{ t('settings.reader.koreader.loadingSettings') }}
  </div>
  <div v-else-if="error" class="border border-destructive/30 rounded-lg px-5 py-4 bg-card text-sm text-destructive shadow-xs">{{ error }}</div>
  <template v-else>
    <template v-if="!hasCredentials">
      <div v-if="!showSetupForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
          <BookOpen :size="18" class="text-muted-foreground/80" />
        </div>
        <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.notConfigured') }}</p>
        <p class="text-xs text-muted-foreground mt-1 mb-4 max-w-sm mx-auto">
          {{ t('settings.reader.koreader.notConfiguredHint') }}
        </p>
        <button class="settings-btn-primary mx-auto min-h-10 justify-center" @click="handleShowSetupForm">
          <User :size="13" />
          {{ t('settings.reader.koreader.createCredentials') }}
        </button>
      </div>

      <div v-else class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-4 shadow-xs">
        <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.createFormTitle') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('settings.reader.koreader.createFormHint') }}</p>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.koreader.username') }}</label>
          <input
            v-model="newUsername"
            type="text"
            :placeholder="t('settings.reader.koreader.usernamePlaceholder')"
            class="input-field w-full"
            autocomplete="off"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.koreader.password') }}</label>
          <div class="relative">
            <input
              v-model="newPassword"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="t('settings.reader.koreader.passwordPlaceholder')"
              class="input-field w-full pr-10"
              autocomplete="new-password"
            />
            <button class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" @click="handleTogglePassword">
              <EyeOff v-if="showPassword" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </div>
        <div class="hidden md:flex items-center gap-2 pt-1">
          <button class="settings-btn-primary" :disabled="createDisabled" @click="handleCreate">
            {{ creating ? t('settings.reader.koreader.creating') : t('settings.reader.koreader.create') }}
          </button>
          <button class="settings-btn-outline" @click="handleCancelSetup">{{ t('common.cancel') }}</button>
        </div>
        <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
          <div class="flex items-center gap-2">
            <button class="settings-btn-primary flex-1 min-h-10 justify-center" :disabled="createDisabled" @click="handleCreate">
              {{ creating ? t('settings.reader.koreader.creating') : t('settings.reader.koreader.create') }}
            </button>
            <button
              class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
              @click="handleCancelSetup"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.koreader.status') }}</p>
          <button class="settings-btn-outline" @click="handleRefresh">
            <RefreshCw :size="12" />
            {{ t('settings.reader.koreader.refresh') }}
          </button>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.progressSync') }}</p>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.progressSyncHint') }}
              </p>
            </div>
            <ToggleSwitch :model-value="credentials?.syncEnabled ?? false" class="self-start md:self-auto" @update:model-value="handleToggleSync" />
          </div>
          <div class="grid gap-3 px-4 py-4 bg-card md:grid-cols-2 lg:grid-cols-5 md:px-5">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.username') }}</p>
              <p class="settings-hint font-mono truncate">{{ credentials?.username }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.lastSync') }}</p>
              <p class="settings-hint">{{ formatLastSync(syncStatus?.lastSyncAt ?? null) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.syncedBooks') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.bookCount', { count: totalSyncedBooks }, totalSyncedBooks) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.devices') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.deviceCount', { count: deviceCount }, deviceCount) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.credentialsCreatedLabel') }}</p>
              <p class="settings-hint">{{ formatDate(credentials?.createdAt) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.setup') }}</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div class="px-4 py-4 bg-card md:px-5">
            <div class="mb-2 flex items-center gap-2">
              <BookOpen :size="14" class="text-muted-foreground shrink-0" />
              <p class="settings-label">{{ t('settings.reader.koreader.pluginServerUrl') }}</p>
            </div>
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <input :value="syncUrl" readonly class="input-field flex-1 min-w-0 font-mono text-xs md:text-sm" />
              <button class="settings-btn-outline w-full min-h-10 justify-center md:w-auto md:min-h-0" @click="handleCopyUrl">
                <Check v-if="urlCopied" :size="12" />
                <Copy v-else :size="12" />
                {{ urlCopied ? t('settings.reader.koreader.copied') : t('settings.reader.koreader.copyUrl') }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-3 px-4 py-4 bg-card md:flex-row md:items-center md:justify-between md:px-5">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="settings-label">{{ t('settings.reader.koreader.preconfiguredPlugin') }}</p>
                <span
                  v-if="pluginUpdateAvailable"
                  class="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  {{ t('settings.reader.koreader.updateAvailable') }}
                </span>
              </div>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.preconfiguredPluginHintPrefix') }}
                <span class="font-mono text-foreground/70">koreader/plugins/</span>
                {{ t('settings.reader.koreader.preconfiguredPluginHintSuffix') }}
              </p>
              <p class="settings-hint mt-1">{{ t('settings.reader.koreader.latestPluginNote', { label: latestPluginLabel }) }}</p>
            </div>
            <button class="settings-btn-primary self-start md:self-auto" :disabled="downloadingPlugin" @click="handleDownloadPlugin">
              <Download :size="12" />
              {{ downloadingPlugin ? t('settings.reader.koreader.preparing') : t('settings.reader.koreader.downloadPlugin') }}
            </button>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.devices') }}</p>
        <div v-if="deviceCount === 0" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
          <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Smartphone :size="18" class="text-muted-foreground/80" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.noDevicesSynced') }}</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {{ t('settings.reader.koreader.noDevicesSyncedHint') }}
          </p>
        </div>
        <div v-else class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-for="device in syncStatus?.devices ?? []" :key="device.deviceId" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                <Smartphone :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="settings-label truncate">{{ device.device }}</p>
                <div class="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p class="min-w-0">
                    {{ t('settings.reader.koreader.lastSyncLabel') }} <span class="text-foreground/80">{{ formatLastSync(device.lastSyncAt) }}</span>
                  </p>
                  <p class="min-w-0 truncate">
                    {{ t('settings.reader.koreader.lastBookLabel') }}
                    <span class="text-foreground/80">{{ device.lastBookTitle ?? t('settings.reader.koreader.noneYet') }}</span>
                  </p>
                </div>
              </div>
              <button
                class="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                @click="handleOpenRemoveDevice(device)"
              >
                <Trash2 :size="12" />
                {{ t('settings.reader.koreader.remove') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.pluginActivity') }}</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-if="!hasPluginActivity" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.noPluginActivity') }}
          </div>
          <div v-for="sweep in sweeps" :key="sweep.deviceId" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                <Smartphone :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="settings-label truncate">
                    {{ sweep.deviceModel }}
                    <span v-if="sweep.pluginVersion" class="font-normal text-muted-foreground"> v{{ sweep.pluginVersion }}</span>
                  </p>
                  <span class="rounded-md border px-2 py-0.5 text-[11px] font-medium" :class="pluginUpdateClass(sweep.updateAvailable)">
                    {{ pluginUpdateText(sweep.updateAvailable) }}
                  </span>
                </div>
                <p class="settings-hint mt-1">
                  {{ t('settings.reader.koreader.lastFullSync', { time: formatLastSync(sweep.lastSweepAt) }) }}
                  <span v-if="sweep.updateAvailable === true && sweep.latestPluginVersion">
                    {{ t('settings.reader.koreader.latestPluginSuffix', { version: sweep.latestPluginVersion }) }}</span
                  >
                </p>
              </div>
            </div>
            <div class="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepBooksMatched }}</p>
                <p>{{ t('settings.reader.koreader.matchedBooks') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepPageStats }}</p>
                <p>{{ t('settings.reader.koreader.readingEvents') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepAnnotations }}</p>
                <p>{{ t('settings.reader.koreader.highlights') }}</p>
              </div>
            </div>
          </div>
          <div v-if="hasPluginActivity" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-center gap-2 mb-3">
              <Library :size="14" class="text-muted-foreground shrink-0" />
              <p class="settings-label">{{ t('settings.reader.koreader.syncedTotals') }}</p>
            </div>
            <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-5">
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.matchedBooks }}</p>
                <p>{{ t('settings.reader.koreader.matchedBooks') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.pageStatEvents }}</p>
                <p>{{ t('settings.reader.koreader.readingEvents') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.annotations }}</p>
                <p>{{ t('settings.reader.koreader.highlights') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.trashedAnnotations }}</p>
                <p>{{ t('settings.reader.koreader.trashedHighlights') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ unmatchedCount }}</p>
                <p>{{ t('settings.reader.koreader.unmatchedBooks') }}</p>
              </div>
            </div>
            <div v-if="pendingDeletes > 0" class="mt-3 flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>{{ t('settings.reader.koreader.pendingDeletes', { count: pendingDeletes }, pendingDeletes) }}</p>
            </div>
            <div v-if="failedPositions > 0" class="mt-3 flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>{{ t('settings.reader.koreader.failedPositions', { count: failedPositions }, failedPositions) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <div class="flex items-center justify-between gap-3 mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.koreader.hashLinks.unmatchedTitle') }}</p>
          <div class="flex items-center gap-2">
            <button
              v-if="unmatchedBooks.length > 0"
              class="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              :disabled="unmatchedLoading"
              @click="handleOpenDismissAll"
            >
              <Trash2 :size="12" />
              {{ t('settings.reader.koreader.hashLinks.dismissAll') }}
            </button>
            <button class="settings-btn-outline" :disabled="unmatchedLoading" @click="handleRefreshUnmatched">
              <RefreshCw :size="12" />
              {{ t('settings.reader.koreader.hashLinks.refresh') }}
            </button>
          </div>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-if="unmatchedLoading" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.hashLinks.loadingUnmatched') }}
          </div>
          <div v-else-if="unmatchedBooks.length === 0" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.hashLinks.noUnmatched') }}
          </div>
          <template v-else>
            <div v-for="book in pagedUnmatchedBooks" :key="book.hash" class="px-4 py-4 bg-card md:px-5">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                  <p class="settings-label truncate">{{ unmatchedBookTitle(book) }}</p>
                  <p class="settings-hint truncate">{{ unmatchedBookSubtitle(book) }}</p>
                  <div class="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <p class="min-w-0 truncate">
                      {{ t('settings.reader.koreader.hashLinks.hash') }} <span class="font-mono text-foreground/75">{{ book.hash }}</span>
                    </p>
                    <p>
                      {{ t('settings.reader.koreader.hashLinks.lastOpened') }}
                      <span class="text-foreground/75">{{ formatEpochSeconds(book.lastOpen) }}</span>
                    </p>
                    <p>
                      {{ t('settings.reader.koreader.hashLinks.firstSeen') }}
                      <span class="text-foreground/75">{{ formatDateTime(book.firstSeenAt) }}</span>
                    </p>
                    <p>
                      {{ t('settings.reader.koreader.hashLinks.lastSeen') }}
                      <span class="text-foreground/75">{{ formatDateTime(book.lastSeenAt) }}</span>
                    </p>
                  </div>
                </div>
                <div class="flex gap-2 self-start md:self-auto">
                  <button class="settings-btn-primary" @click="handleOpenLink(book)">
                    <Link2 :size="12" />
                    {{ t('settings.reader.koreader.hashLinks.link') }}
                  </button>
                  <button
                    class="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                    @click="handleOpenDismiss(book)"
                  >
                    <Trash2 :size="12" />
                    {{ t('settings.reader.koreader.hashLinks.dismiss') }}
                  </button>
                </div>
              </div>
            </div>
            <div
              v-if="showUnmatchedPager"
              class="flex flex-col gap-3 px-4 py-3 bg-card text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-5"
            >
              <p>
                {{
                  t('settings.reader.koreader.hashLinks.showingRange', {
                    start: unmatchedPageStart,
                    end: unmatchedPageEnd,
                    total: unmatchedBooks.length,
                  })
                }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <button class="settings-btn-outline" :disabled="clampedUnmatchedPage <= 1" @click="handlePreviousUnmatchedPage">
                  <ChevronLeft :size="12" />
                  {{ t('common.previous') }}
                </button>
                <span class="min-w-20 text-center">
                  {{ t('settings.reader.koreader.hashLinks.pageOf', { page: clampedUnmatchedPage, total: unmatchedTotalPages }) }}
                </span>
                <button class="settings-btn-outline" :disabled="clampedUnmatchedPage >= unmatchedTotalPages" @click="handleNextUnmatchedPage">
                  {{ t('common.next') }}
                  <ChevronRight :size="12" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="mb-8">
        <div class="flex items-center justify-between gap-3 mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.koreader.hashLinks.manualTitle') }}</p>
          <button class="settings-btn-outline" :disabled="manualLinksLoading" @click="handleRefreshManualLinks">
            <RefreshCw :size="12" />
            {{ t('settings.reader.koreader.hashLinks.refresh') }}
          </button>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-if="manualLinksLoading" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.hashLinks.loadingManual') }}
          </div>
          <div v-else-if="manualHashLinks.length === 0" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.hashLinks.noManual') }}
          </div>
          <template v-else>
            <div v-for="link in manualHashLinks" :key="link.hash" class="px-4 py-4 bg-card md:px-5">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div class="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
                  <div class="min-w-0">
                    <p class="settings-label truncate">{{ manualLinkTitle(link) }}</p>
                    <p class="settings-hint truncate">{{ manualLinkSubtitle(link) }}</p>
                    <div class="mt-2 grid gap-1 text-xs text-muted-foreground">
                      <p class="min-w-0 truncate">
                        {{ t('settings.reader.koreader.hashLinks.hash') }} <span class="font-mono text-foreground/75">{{ link.hash }}</span>
                      </p>
                      <p>
                        {{ t('settings.reader.koreader.hashLinks.lastOpened') }}
                        <span class="text-foreground/75">{{ formatEpochSeconds(link.koreaderLastOpen) }}</span>
                      </p>
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="settings-label truncate">{{ t('settings.reader.koreader.hashLinks.linkedTo', { title: linkedBookTitle(link) }) }}</p>
                    <p class="settings-hint truncate">{{ linkedBookAuthors(link) }}</p>
                    <div class="mt-2 grid gap-1 text-xs text-muted-foreground">
                      <p>
                        {{ t('settings.reader.koreader.hashLinks.linked') }}
                        <span class="text-foreground/75">{{ formatDateTime(link.createdAt) }}</span>
                      </p>
                      <p>
                        {{ t('settings.reader.koreader.hashLinks.updated') }}
                        <span class="text-foreground/75">{{ formatDateTime(link.updatedAt) }}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div class="flex gap-2 self-start">
                  <button class="settings-btn-outline" @click="handleOpenRelink(link)">
                    <Link2 :size="12" />
                    {{ t('settings.reader.koreader.hashLinks.change') }}
                  </button>
                  <button
                    class="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                    @click="handleOpenUnlink(link)"
                  >
                    <Trash2 :size="12" />
                    {{ t('settings.reader.koreader.hashLinks.unlink') }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.setupGuide') }}</p>
        <div class="border border-border rounded-lg bg-card shadow-xs">
          <button class="w-full flex items-center justify-between gap-2 px-4 py-4 text-left md:px-5" @click="handleToggleHelp">
            <div class="flex-1 min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.setupSteps') }}</p>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.setupStepsHint') }}
              </p>
            </div>
            <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground shrink-0" />
            <ChevronDown v-else :size="14" class="text-muted-foreground shrink-0" />
          </button>
          <div v-if="helpOpen" class="border-t border-border px-4 py-4 space-y-4 text-xs text-muted-foreground md:px-5">
            <div>
              <p class="font-medium text-foreground/80 mb-2">{{ t('settings.reader.koreader.pluginGuideTitle') }}</p>
              <ol class="list-decimal list-inside space-y-2 pl-1">
                <li>{{ t('settings.reader.koreader.pluginStep1') }}</li>
                <li>
                  {{ t('settings.reader.koreader.pluginStep2Prefix') }}
                  <span class="font-mono text-foreground/70">bookorbit.koplugin</span>
                  {{ t('settings.reader.koreader.pluginStep2Middle') }}
                  <span class="font-mono text-foreground/70">koreader/plugins/</span>
                  {{ t('settings.reader.koreader.pluginStep2Suffix') }}
                </li>
                <li>{{ t('settings.reader.koreader.pluginStep3') }}</li>
                <li>
                  {{ t('settings.reader.koreader.pluginStep4Prefix') }}
                  <span class="font-mono text-foreground/70">Browse BookOrbit</span>
                  {{ t('settings.reader.koreader.pluginStep4Suffix') }}
                </li>
              </ol>
            </div>
            <div>
              <p class="font-medium text-foreground/80 mb-2">{{ t('settings.reader.koreader.stockGuideTitle') }}</p>
              <ol class="list-decimal list-inside space-y-2 pl-1">
                <li>
                  {{ t('settings.reader.koreader.stockStep1Prefix') }}
                  <span class="font-mono text-foreground/70">Tools &gt; Progress sync</span>{{ t('settings.reader.koreader.stockStep1Suffix') }}
                </li>
                <li>{{ t('settings.reader.koreader.stockStep2') }}</li>
                <li>{{ t('settings.reader.koreader.stockStep3') }}</li>
              </ol>
            </div>
            <div class="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <Calendar :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>
                {{ t('settings.reader.koreader.locationNote') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-6">
        <p class="settings-group-label">{{ t('settings.reader.koreader.dangerZone') }}</p>
        <div class="border border-destructive/30 rounded-lg overflow-hidden shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-4 bg-card md:flex-row md:items-center md:justify-between md:px-5">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.deleteCredentials') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.deleteCredentialsHint') }}</p>
            </div>
            <button
              class="self-start md:self-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shrink-0"
              @click="handleOpenDeleteConfirm"
            >
              <Trash2 :size="12" />
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="deleteConfirmOpen"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseDeleteConfirm"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseDeleteConfirm" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('settings.reader.koreader.deleteConfirmTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.deleteConfirmBody') }}
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseDeleteConfirm"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="handleDelete"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="unlinkConfirmLink" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="handleCloseUnlink">
      <button class="absolute inset-0 bg-black/45" @click="handleCloseUnlink" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('settings.reader.koreader.hashLinks.unlinkConfirmTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.hashLinks.unlinkConfirmBody', { title: linkedBookTitle(unlinkConfirmLink) }) }}
        </p>
        <div class="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p class="font-mono text-foreground/75 truncate">{{ unlinkConfirmLink.hash }}</p>
          <p class="mt-1 truncate">{{ manualLinkTitle(unlinkConfirmLink) }}</p>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseUnlink"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            :disabled="unlinkingHash !== null"
            @click="handleUnlinkManualLink"
          >
            {{
              unlinkingHash === unlinkConfirmLink.hash
                ? t('settings.reader.koreader.hashLinks.unlinking')
                : t('settings.reader.koreader.hashLinks.unlink')
            }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="removeDeviceConfirmTarget"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseRemoveDevice"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseRemoveDevice" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">
          {{ t('settings.reader.koreader.removeDeviceConfirmTitle', { device: removeDeviceConfirmTarget.device }) }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.removeDeviceConfirmBody') }}
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseRemoveDevice"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            :disabled="removingDeviceId !== null"
            @click="handleRemoveDevice"
          >
            {{
              removingDeviceId === removeDeviceConfirmTarget.deviceId ? t('settings.reader.koreader.removing') : t('settings.reader.koreader.remove')
            }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="dismissConfirmBook"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseDismiss"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseDismiss" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">
          {{ t('settings.reader.koreader.hashLinks.dismissConfirmTitle', { title: unmatchedBookTitle(dismissConfirmBook) }) }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.hashLinks.dismissConfirmBody') }}
        </p>
        <div class="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p class="font-mono text-foreground/75 truncate">{{ dismissConfirmBook.hash }}</p>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseDismiss"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            :disabled="dismissingHash !== null"
            @click="handleDismissUnmatchedBook"
          >
            {{
              dismissingHash === dismissConfirmBook.hash
                ? t('settings.reader.koreader.hashLinks.dismissing')
                : t('settings.reader.koreader.hashLinks.dismiss')
            }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="dismissAllConfirmOpen"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseDismissAll"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseDismissAll" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">
          {{ t('settings.reader.koreader.hashLinks.dismissAllConfirmTitle', { count: unmatchedBooks.length }, unmatchedBooks.length) }}
        </p>
        <div class="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle :size="14" class="mt-0.5 shrink-0" />
          <p>
            {{ t('settings.reader.koreader.hashLinks.dismissAllConfirmBody') }}
          </p>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseDismissAll"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            :disabled="dismissingAll"
            @click="handleDismissAllUnmatchedBooks"
          >
            {{ dismissingAll ? t('settings.reader.koreader.hashLinks.dismissing') : t('settings.reader.koreader.hashLinks.dismissAll') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="linkDialogOpen"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseLink"
      @keydown.esc="handleCloseLink"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseLink" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-2xl md:rounded-lg md:p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-base font-semibold text-foreground">{{ linkDialogTitle }}</p>
            <p class="mt-1 text-sm text-muted-foreground truncate">{{ selectedLinkLabel }}</p>
          </div>
          <button class="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" @click="handleCloseLink">
            <X :size="16" />
          </button>
        </div>
        <div class="mt-4">
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.koreader.hashLinks.bookOrbitBook') }}</label>
          <div class="relative">
            <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="linkSearchQuery"
              type="search"
              class="input-field w-full pl-9"
              autocomplete="off"
              :placeholder="t('settings.reader.koreader.hashLinks.searchLibraryPlaceholder')"
            />
          </div>
        </div>
        <div class="mt-4 max-h-[55vh] overflow-y-auto rounded-md border border-border divide-y divide-border">
          <div v-if="linkSearchQuery.trim().length < 2" class="px-3 py-4 text-sm text-muted-foreground">
            {{ t('settings.reader.koreader.hashLinks.enterMinChars') }}
          </div>
          <div v-else-if="linkSearchLoading" class="px-3 py-4 text-sm text-muted-foreground">
            {{ t('settings.reader.koreader.hashLinks.searching') }}
          </div>
          <div v-else-if="linkSearchSettled && linkSearchResults.length === 0" class="px-3 py-4 text-sm text-muted-foreground">
            {{ t('settings.reader.koreader.hashLinks.noBooksFound') }}
          </div>
          <template v-else>
            <button
              v-for="book in linkSearchResults"
              :key="book.id"
              class="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/70 disabled:opacity-60"
              :disabled="linkingBookId !== null"
              @click="handleChooseLinkTarget(book)"
            >
              <span class="min-w-0">
                <span class="block text-sm font-medium text-foreground truncate">{{
                  book.title ?? t('settings.reader.koreader.hashLinks.untitledBook')
                }}</span>
                <span class="block text-xs text-muted-foreground truncate">{{ bookSearchSubtitle(book) }}</span>
              </span>
              <span class="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                {{
                  pendingLinkTarget?.id === book.id
                    ? t('settings.reader.koreader.hashLinks.selected')
                    : t('settings.reader.koreader.hashLinks.select')
                }}
              </span>
            </button>
            <button
              v-if="linkSearchHasMore"
              class="flex w-full items-center justify-center gap-2 px-3 py-3 text-sm font-medium text-foreground hover:bg-muted/70 disabled:opacity-60"
              :disabled="linkSearchLoadingMore"
              @click="handleLoadMoreLinkSearch"
            >
              <ChevronDown :size="14" />
              {{ linkSearchLoadingMore ? t('settings.reader.koreader.hashLinks.loadingMore') : t('settings.reader.koreader.hashLinks.loadMore') }}
            </button>
          </template>
        </div>
        <div v-if="pendingLinkTarget" class="mt-4 rounded-md border border-border bg-muted/30 p-3">
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.hashLinks.confirmLinkTitle') }}</p>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div class="min-w-0 rounded-md border border-border bg-background px-3 py-2">
              <p class="text-xs font-medium text-muted-foreground">KOReader</p>
              <p class="mt-1 text-sm font-medium text-foreground truncate">{{ selectedLinkLabel }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ selectedLinkSubtitle }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.reader.koreader.hashLinks.lastOpened') }}
                <span class="text-foreground/75">{{ formatEpochSeconds(selectedLinkLastOpen) }}</span>
              </p>
              <p class="mt-1 font-mono text-xs text-muted-foreground truncate">{{ selectedLinkHash }}</p>
            </div>
            <div class="min-w-0 rounded-md border border-border bg-background px-3 py-2">
              <p class="text-xs font-medium text-muted-foreground">BookOrbit</p>
              <p class="mt-1 text-sm font-medium text-foreground truncate">
                {{ pendingLinkTarget.title ?? t('settings.reader.koreader.hashLinks.untitledBook') }}
              </p>
              <p class="text-xs text-muted-foreground truncate">{{ bookSearchSubtitle(pendingLinkTarget) }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.reader.koreader.hashLinks.bookId', { id: pendingLinkTarget.id }) }}</p>
            </div>
          </div>
          <div class="mt-3 flex gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle :size="14" class="mt-0.5 shrink-0" />
            <p>{{ t('settings.reader.koreader.hashLinks.syncedStatsNote') }}</p>
          </div>
          <div class="mt-3 flex items-center justify-end gap-2">
            <button
              class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
              :disabled="linkingBookId !== null"
              @click="handleClearLinkTarget"
            >
              {{ t('settings.reader.koreader.hashLinks.chooseDifferent') }}
            </button>
            <button class="settings-btn-primary" :disabled="linkingBookId !== null" @click="handleConfirmLinkTarget">
              {{
                linkingBookId === pendingLinkTarget.id
                  ? t('settings.reader.koreader.hashLinks.saving')
                  : t('settings.reader.koreader.hashLinks.confirmLink')
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
