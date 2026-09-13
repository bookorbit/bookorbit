<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen, Plus, RefreshCw } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { Library as LibraryType } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { useLibraryFileSync } from '@/features/library/composables/useLibraryFileSync'
import { getSocket, useScanProgress } from '@/features/scanner/composables/useScanProgress'
import LibrariesToolbar from './libraries/components/LibrariesToolbar.vue'
import LibraryLedgerCards from './libraries/components/LibraryLedgerCards.vue'
import LibraryLedgerList from './libraries/components/LibraryLedgerList.vue'
import { useLibraryDetail } from './libraries/composables/useLibraryDetail'
import { useLibraryOverview } from './libraries/composables/useLibraryOverview'
import { matchesLibraryQuery, sortLibraries, type LibrarySortField } from './libraries/lib/library-sort'

const HEADER_ACTIONS_TARGET = '#settings-header-actions'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

if (!hasPermission('manage_libraries')) {
  router.replace({ name: 'settings-appearance-theme' })
}

const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const { subscribeLibrary, getProgress, isScanning, progressMap, isRefreshingCovers } = useScanProgress()
const { syncAll: syncAllFiles } = useLibraryFileSync()
const overview = useLibraryOverview()
const detail = useLibraryDetail()

const query = ref('')
const expandedId = ref<number | null>(null)
const sortBy = ref<LibrarySortField>('default')
const scanningAll = ref(false)
const creatorOpen = ref(false)
const editingLibrary = ref<LibraryType | null>(null)
const deletingLibrary = ref<LibraryType | null>(null)
const deleteConfirmName = ref('')
const deleting = ref(false)
const fileSyncingMap = ref<Record<number, boolean>>({})
const confirmSyncLibrary = ref<LibraryType | null>(null)

/**
 * The header renders the primary actions beside the title. Falling back to rendering in place keeps
 * them reachable when this panel is mounted outside the settings shell, including in tests.
 */
const headerSlotAvailable = ref(false)

const collator = computed(() => new Intl.Collator(locale.value, { sensitivity: 'base', numeric: true }))
const visibleLibraries = computed(() =>
  sortLibraries(
    libraries.value.filter((library) => matchesLibraryQuery(library, query.value)),
    sortBy.value,
    overview.entries.value,
    collator.value,
  ),
)
const folderCount = computed(() => libraries.value.reduce((sum, library) => sum + library.folders.length, 0))
const hasLibraries = computed(() => libraries.value.length > 0)
const showSkeleton = computed(() => !overview.loaded.value && !overview.error.value && hasLibraries.value)

function subscribeAll() {
  for (const library of libraries.value) subscribeLibrary(library.id)
}

onMounted(async () => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  getSocket()
  await fetchLibraries()
  subscribeAll()
  void overview.load()
})

onUnmounted(() => {
  overview.dispose()
})

/**
 * A completed event lingers in the map for a few seconds, and the map is replaced on every socket
 * tick, so each finished job is recorded and acted on exactly once. Ids are pruned as their events
 * leave the map, which keeps the set bounded to the scans currently in flight.
 */
const handledScanJobs = new Set<number>()

watch(progressMap, (map) => {
  const liveJobIds = new Set<number>()
  let finished = false
  for (const event of map.values()) {
    liveJobIds.add(event.jobId)
    if (event.status === 'running' || handledScanJobs.has(event.jobId)) continue
    handledScanJobs.add(event.jobId)
    finished = true
  }
  for (const jobId of handledScanJobs) {
    if (!liveJobIds.has(jobId)) handledScanJobs.delete(jobId)
  }
  if (!finished) return

  // A finished scan changes counts, sizes and the last-scan row, and appends a history row.
  overview.scheduleReload()
  detail.invalidate()
  if (expandedId.value !== null) void detail.load(expandedId.value)
})

function isSyncingFiles(libraryId: number): boolean {
  return Boolean(fileSyncingMap.value[libraryId])
}

/** One row open at a time keeps the list scannable and bounds the lazy detail fetches. */
function toggleDetail(lib: LibraryType) {
  if (expandedId.value === lib.id) {
    expandedId.value = null
    return
  }
  expandedId.value = lib.id
  void detail.load(lib.id)
}

function historyFor(libraryId: number) {
  return detail.get(libraryId)?.history ?? null
}

function accessCountFor(libraryId: number): number | null {
  return detail.get(libraryId)?.accessCount ?? null
}

function isDetailLoading(libraryId: number): boolean {
  return detail.loading.value.has(libraryId)
}

function isDetailFailed(libraryId: number): boolean {
  return detail.failed.value.has(libraryId)
}

function updateQuery(value: string) {
  query.value = value
}

function updateSortBy(value: LibrarySortField) {
  sortBy.value = value
}

function clearQuery() {
  query.value = ''
}

async function scan(lib: LibraryType) {
  try {
    const res = await api(`/api/v1/scanner/libraries/${lib.id}/scan`, { method: 'POST' })
    if (res.ok) {
      toast.success(t('settings.admin.libraries.scanStarted', { name: lib.name }))
      subscribeLibrary(lib.id)
    } else {
      toast.error(t('settings.admin.libraries.scanStartFailed', { name: lib.name }))
    }
  } catch {
    toast.error(t('settings.admin.libraries.scanStartFailed', { name: lib.name }))
  }
}

async function refreshCovers(lib: LibraryType) {
  try {
    const res = await api(`/api/v1/scanner/libraries/${lib.id}/refresh-covers`, { method: 'POST' })
    if (!res.ok) toast.error(t('settings.admin.libraries.refreshCoversFailed', { name: lib.name }))
  } catch {
    toast.error(t('settings.admin.libraries.refreshCoversFailed', { name: lib.name }))
  }
}

async function scanAll() {
  scanningAll.value = true
  try {
    const results = await Promise.all(libraries.value.map((lib) => api(`/api/v1/scanner/libraries/${lib.id}/scan`, { method: 'POST' })))
    const failed = results.filter((res) => !res.ok).length
    if (failed === 0) {
      toast.success(t('settings.admin.libraries.scanStartedAll'))
      subscribeAll()
    } else {
      toast.error(t('settings.admin.libraries.librariesFailedToStart', { count: failed }))
    }
  } catch {
    toast.error(t('settings.admin.libraries.scansStartFailed'))
  } finally {
    scanningAll.value = false
  }
}

function promptSyncFiles(lib: LibraryType) {
  confirmSyncLibrary.value = lib
}

function cancelLibrarySync() {
  confirmSyncLibrary.value = null
}

async function confirmSyncFiles() {
  const lib = confirmSyncLibrary.value
  if (!lib) return
  confirmSyncLibrary.value = null
  fileSyncingMap.value[lib.id] = true
  try {
    await syncAllFiles(lib.id)
    toast.success(t('settings.admin.libraries.metadataSynced', { name: lib.name }))
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message.includes('400')) {
      toast.error(t('settings.admin.libraries.fileWriteNotEnabled'))
    } else {
      toast.error(t('settings.admin.libraries.fileSyncFailed', { name: lib.name }))
    }
  } finally {
    fileSyncingMap.value[lib.id] = false
  }
}

function openCreate() {
  editingLibrary.value = null
  creatorOpen.value = true
}

function openEdit(lib: LibraryType) {
  editingLibrary.value = lib
  creatorOpen.value = true
}

function closeCreator() {
  creatorOpen.value = false
  editingLibrary.value = null
}

async function onSaved(library: LibraryType) {
  const isNew = !editingLibrary.value
  creatorOpen.value = false
  editingLibrary.value = null
  subscribeLibrary(library.id)
  if (isNew) {
    toast.success(t('settings.admin.libraries.libraryCreated', { name: library.name }))
    await handleLibraryCreated(library)
  } else {
    toast.success(t('settings.admin.libraries.libraryUpdated', { name: library.name }))
    await refreshLibraries()
  }
  detail.invalidate()
  if (expandedId.value !== null) void detail.load(expandedId.value)
  void overview.load()
}

function openDelete(lib: LibraryType) {
  deletingLibrary.value = lib
  deleteConfirmName.value = ''
}

function cancelLibraryDelete() {
  deletingLibrary.value = null
}

async function confirmDelete() {
  const lib = deletingLibrary.value
  if (!lib) return
  deleting.value = true
  try {
    const res = await api(`/api/v1/libraries/${lib.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success(t('settings.admin.libraries.libraryDeleted', { name: lib.name }))
      deletingLibrary.value = null
      if (expandedId.value === lib.id) expandedId.value = null
      detail.invalidate()
      await refreshLibraries()
      void overview.load()
      if (route.name === 'library' && Number(route.params.id) === lib.id) {
        const next = libraries.value[0]
        if (next) router.replace({ name: 'library', params: { id: next.id } })
        else router.replace('/')
      }
    } else {
      toast.error(t('settings.admin.libraries.deleteFailed'))
    }
  } catch {
    toast.error(t('settings.admin.libraries.deleteFailed'))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <TooltipProvider>
    <div class="space-y-4">
      <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
        <Button
          variant="outline"
          size="sm"
          type="button"
          class="max-sm:size-8 max-sm:p-0"
          :disabled="scanningAll || libraries.length === 0"
          :aria-label="t('settings.admin.libraries.scanAll')"
          @click="scanAll"
        >
          <RefreshCw :size="14" :class="scanningAll ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
          <span class="max-sm:sr-only">
            {{ scanningAll ? t('settings.admin.libraries.scanning') : t('settings.admin.libraries.scanAll') }}
          </span>
        </Button>
        <Button size="sm" type="button" @click="openCreate">
          <Plus :size="14" aria-hidden="true" />
          {{ t('settings.admin.libraries.addLibrary') }}
        </Button>
      </Teleport>

      <template v-if="hasLibraries">
        <LibrariesToolbar
          :query="query"
          :sort-by="sortBy"
          :library-count="libraries.length"
          :folder-count="folderCount"
          :total-books="overview.totalBooks.value"
          :total-size-bytes="overview.totalSizeBytes.value"
          :stats-pending="!overview.loaded.value"
          @update:query="updateQuery"
          @update:sort-by="updateSortBy"
        />

        <p v-if="overview.error.value" role="alert" class="settings-error-state">
          {{ t('settings.admin.libraries.statsFailed') }}
        </p>

        <div v-if="showSkeleton" class="space-y-2.5" aria-hidden="true">
          <Skeleton v-for="index in libraries.length" :key="index" class="h-44 w-full rounded-xl md:h-[7.6875rem]" />
        </div>

        <template v-else-if="visibleLibraries.length > 0">
          <LibraryLedgerList
            :libraries="visibleLibraries"
            :overview="overview.entries.value"
            :overview-loaded="overview.loaded.value"
            :expanded-id="expandedId"
            :progress-for="getProgress"
            :is-scanning="isScanning"
            :is-refreshing-covers="isRefreshingCovers"
            :is-syncing-files="isSyncingFiles"
            :history-for="historyFor"
            :access-count-for="accessCountFor"
            :is-detail-loading="isDetailLoading"
            :is-detail-failed="isDetailFailed"
            @toggle="toggleDetail"
            @scan="scan"
            @edit="openEdit"
            @refresh-covers="refreshCovers"
            @sync-files="promptSyncFiles"
            @remove="openDelete"
          />
          <LibraryLedgerCards
            :libraries="visibleLibraries"
            :overview="overview.entries.value"
            :overview-loaded="overview.loaded.value"
            :progress-for="getProgress"
            :is-scanning="isScanning"
            :is-refreshing-covers="isRefreshingCovers"
            :is-syncing-files="isSyncingFiles"
            @scan="scan"
            @edit="openEdit"
            @refresh-covers="refreshCovers"
            @sync-files="promptSyncFiles"
            @remove="openDelete"
          />
        </template>

        <div v-else class="settings-empty-state px-6 py-10">
          <p class="text-sm font-medium text-foreground">{{ t('settings.admin.libraries.noMatchesTitle') }}</p>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.admin.libraries.noMatchesHint', { query }) }}</p>
          <Button variant="outline" size="sm" type="button" class="mt-4" @click="clearQuery">
            {{ t('settings.admin.libraries.filterClear') }}
          </Button>
        </div>
      </template>

      <div v-else class="settings-empty-state px-8 py-16">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-muted">
          <FolderOpen :size="22" class="text-muted-foreground" aria-hidden="true" />
        </div>
        <p class="mb-1 text-sm font-medium text-foreground">{{ t('settings.admin.libraries.emptyTitle') }}</p>
        <p class="mb-5 text-sm text-muted-foreground">{{ t('settings.admin.libraries.emptyHint') }}</p>
        <Button size="sm" type="button" @click="openCreate">
          <Plus :size="14" aria-hidden="true" />
          {{ t('settings.admin.libraries.addFirstLibrary') }}
        </Button>
      </div>
    </div>

    <LibraryCreatorModal v-if="creatorOpen" :library="editingLibrary" @close="closeCreator" @saved="onSaved" />

    <ConfirmDialog
      v-if="deletingLibrary"
      open
      destructive
      :title="t('settings.admin.libraries.deleteConfirmTitle', { name: deletingLibrary.name })"
      :description="t('settings.admin.libraries.deleteConfirmBody')"
      :confirm-label="deleting ? t('settings.admin.libraries.deleting') : t('settings.admin.libraries.deleteLibraryButton')"
      :busy="deleting"
      :confirm-disabled="deleteConfirmName !== deletingLibrary.name"
      @confirm="confirmDelete"
      @cancel="cancelLibraryDelete"
    >
      <label class="mt-4 block">
        <span class="text-sm text-foreground">{{ t('settings.admin.libraries.deleteConfirmTypeName') }}</span>
        <input v-model="deleteConfirmName" type="text" class="input-field mt-2 w-full" :placeholder="deletingLibrary.name" />
      </label>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="confirmSyncLibrary"
      open
      :destructive="false"
      :title="t('settings.admin.libraries.syncConfirmTitle')"
      :description="t('settings.admin.libraries.syncConfirmBody', { name: confirmSyncLibrary.name })"
      :confirm-label="t('settings.admin.libraries.syncFiles')"
      @confirm="confirmSyncFiles"
      @cancel="cancelLibrarySync"
    />
  </TooltipProvider>
</template>
