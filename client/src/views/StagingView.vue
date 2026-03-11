<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { PackageOpen, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import type { StagingFile } from '@projectx/types'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/formatting'
import { useStagingFiles } from '@/features/staging/composables/useStagingFiles'
import { useStagingSummary } from '@/features/staging/composables/useStagingSummary'
import { useStagingStatistics } from '@/features/staging/composables/useStagingStatistics'
import { useStagingUpload, SUPPORTED_FORMATS } from '@/features/staging/composables/useStagingUpload'
import StagingToolbar from '@/features/staging/components/StagingToolbar.vue'
import StagingFileList from '@/features/staging/components/StagingFileList.vue'
import StagingFileSheet from '@/features/staging/components/StagingFileSheet.vue'
import StagingFinalizeDialog from '@/features/staging/components/StagingFinalizeDialog.vue'
import StagingBulkEditDialog from '@/features/staging/components/StagingBulkEditDialog.vue'
import StagingSetDestinationDialog from '@/features/staging/components/StagingSetDestinationDialog.vue'

type ApplyFetchedResult = {
  total: number
  applied: number
  skipped: number
  skippedEdited: number
}

const {
  items,
  loading,
  filters,
  pageCount,
  fetchFiles,
  setStatus,
  setSearch,
  setPage,
  toggleSelect,
  toggleSelectAll,
  clearSelection,
  isSelected,
  selectAll,
  selectionCount,
  hasSelection,
  getSelectionPayload,
} = useStagingFiles()

const { summary, fetchSummary, subscribe, onStagingChange, socketConnected } = useStagingSummary()
const { statistics, fetchStatistics } = useStagingStatistics()
const { addFiles, isUploading } = useStagingUpload()

const selectedFile = ref<StagingFile | null>(null)
const showFinalizeDialog = ref(false)
const showBulkEditDialog = ref(false)
const showSetDestinationDialog = ref(false)
const dragOver = ref(false)
const newFilesDetected = ref(false)
const namePreviewByFileId = ref<Record<number, string>>({})
const applyFetchedResult = ref<ApplyFetchedResult | null>(null)
const rescanFailed = ref(false)
const retryQueued = ref<number | null>(null)
let newFilesTimer: ReturnType<typeof setTimeout> | null = null
let applyFetchedTimer: ReturnType<typeof setTimeout> | null = null
let rescanFailedTimer: ReturnType<typeof setTimeout> | null = null
let retryQueuedTimer: ReturnType<typeof setTimeout> | null = null
let namePreviewTimer: ReturnType<typeof setTimeout> | null = null
let namePreviewReqSeq = 0

let prevTotal = -1

const unsubscribeChange = onStagingChange(() => {
  const currentTotal = summary.value.total
  fetchFiles()
  if (prevTotal >= 0 && currentTotal > prevTotal) {
    newFilesDetected.value = true
    if (newFilesTimer) clearTimeout(newFilesTimer)
    newFilesTimer = setTimeout(() => {
      newFilesDetected.value = false
    }, 3000)
  }
  prevTotal = currentTotal
})

function openSheet(file: StagingFile) {
  selectedFile.value = file
}

function closeSheet() {
  selectedFile.value = null
}

function onDiscarded() {
  selectedFile.value = null
  refresh()
}

function refresh() {
  fetchFiles()
  fetchSummary(true)
  void fetchStatistics()
}

function onFileUpdated(updated: StagingFile) {
  const idx = items.value.findIndex((f) => f.id === updated.id)
  if (idx !== -1) items.value[idx] = updated
  if (selectedFile.value?.id === updated.id) selectedFile.value = updated
  scheduleVisibleNamePreview()
}

function hasContent(obj: Record<string, unknown> | null | undefined): boolean {
  if (!obj) return false
  return Object.values(obj).some((v) => v !== undefined && v !== null && v !== '')
}

const fetchedCount = computed(() => {
  if (!hasSelection.value) return 0
  return items.value.filter((f) => isSelected(f.id) && hasContent(f.fetchedMetadata as Record<string, unknown>)).length
})

const errorCount = computed(() => {
  if (!hasSelection.value) return 0
  return items.value.filter((f) => isSelected(f.id) && f.status === 'error').length
})

const emptyMessage = computed(() => {
  if (filters.search) return `No files match "${filters.search}"`
  if (filters.status) return `No ${filters.status} files`
  return 'Upload files or drop them in the staging folder'
})

async function handleBulkDiscard() {
  const payload = getSelectionPayload()
  await api('/api/v1/staging/files/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  clearSelection()
  refresh()
}

async function handleApplyFetched() {
  const payload = getSelectionPayload()
  const res = await api('/api/v1/staging/files/apply-fetched', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.ok) {
    const result = await res.json()
    applyFetchedResult.value = {
      total: result.total ?? 0,
      applied: result.applied ?? 0,
      skipped: result.skipped ?? 0,
      skippedEdited: result.skippedEdited ?? 0,
    }
    if (applyFetchedTimer) clearTimeout(applyFetchedTimer)
    applyFetchedTimer = setTimeout(() => {
      applyFetchedResult.value = null
    }, 4000)
  }
  clearSelection()
  refresh()
}

async function handleRetryFetch() {
  const payload = getSelectionPayload()
  const res = await api('/api/v1/staging/files/retry-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.ok) {
    const result = await res.json()
    retryQueued.value = result.queued
    if (retryQueuedTimer) clearTimeout(retryQueuedTimer)
    retryQueuedTimer = setTimeout(() => (retryQueued.value = null), 4000)
    clearSelection()
  }
}

async function handleInlineApplyFetched(fileId: number) {
  const file = items.value.find((f) => f.id === fileId)
  if (!file?.fetchedMetadata) return
  const res = await api('/api/v1/staging/files/apply-fetched', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds: [fileId] }),
  })
  if (res.ok) {
    const result = await res.json()
    applyFetchedResult.value = {
      total: result.total ?? 0,
      applied: result.applied ?? 0,
      skipped: result.skipped ?? 0,
      skippedEdited: result.skippedEdited ?? 0,
    }
    if (applyFetchedTimer) clearTimeout(applyFetchedTimer)
    applyFetchedTimer = setTimeout(() => {
      applyFetchedResult.value = null
    }, 4000)
    refresh()
    scheduleVisibleNamePreview()
  }
}

function pluralizeFiles(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`
}

function applyFetchedResultMessage(result: ApplyFetchedResult): string {
  const reasons: string[] = []
  if (result.skippedEdited > 0)
    reasons.push(`skipped ${pluralizeFiles(result.skippedEdited)} because ${result.skippedEdited === 1 ? 'it has' : 'they have'} manual edits`)
  if (result.skipped > 0)
    reasons.push(`skipped ${pluralizeFiles(result.skipped)} because ${result.skipped === 1 ? 'it has' : 'they have'} no fetched metadata`)

  if (result.applied > 0) {
    const base = `Applied to ${pluralizeFiles(result.applied)}`
    return reasons.length ? `${base}; ${reasons.join('; ')}` : base
  }

  if (reasons.length) return `No files applied; ${reasons.join('; ')}`
  return 'No files selected'
}

function handleRescanError() {
  rescanFailed.value = true
  if (rescanFailedTimer) clearTimeout(rescanFailedTimer)
  rescanFailedTimer = setTimeout(() => (rescanFailed.value = false), 4000)
}

function openFinalize() {
  showFinalizeDialog.value = true
}

function openBulkEdit() {
  showBulkEditDialog.value = true
}

function openSetDestination() {
  showSetDestinationDialog.value = true
}

function onFinalized() {
  showFinalizeDialog.value = false
  clearSelection()
  refresh()
}

function onBulkEdited() {
  showBulkEditDialog.value = false
  clearSelection()
  refresh()
}

function onDestinationSet() {
  showSetDestinationDialog.value = false
  refresh()
  scheduleVisibleNamePreview()
}

async function fetchVisibleNamePreview() {
  const ids = items.value.map((f) => f.id)
  if (!ids.length) {
    namePreviewByFileId.value = {}
    return
  }

  const reqId = ++namePreviewReqSeq
  try {
    const res = await api('/api/v1/staging/files/preview-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: ids }),
    })
    if (!res.ok || reqId !== namePreviewReqSeq) return
    const rows: { fileId: number; newName: string }[] = await res.json()
    if (reqId !== namePreviewReqSeq) return
    namePreviewByFileId.value = Object.fromEntries(rows.map((r) => [r.fileId, r.newName]))
  } catch {
    if (reqId !== namePreviewReqSeq) return
    namePreviewByFileId.value = {}
  }
}

function scheduleVisibleNamePreview() {
  if (namePreviewTimer) clearTimeout(namePreviewTimer)
  namePreviewTimer = setTimeout(() => {
    void fetchVisibleNamePreview()
  }, 120)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

let dragCounter = 0

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  dragCounter++
  dragOver.value = true
}

function onDragLeave() {
  dragCounter = Math.max(0, dragCounter - 1)
  if (dragCounter === 0) dragOver.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter = 0
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) {
    const valid = [...files].filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return SUPPORTED_FORMATS.includes(ext)
    })
    if (valid.length) {
      addFiles(valid)
    }
  }
}

watch(isUploading, (uploading, was) => {
  if (was && !uploading) refresh()
})

watch(
  () => items.value.map((f) => `${f.id}:${f.updatedAt}:${f.targetLibraryId ?? ''}:${f.targetFolderId ?? ''}`).join('|'),
  () => {
    scheduleVisibleNamePreview()
  },
)

onMounted(() => {
  fetchFiles()
  fetchSummary(true)
  fetchStatistics()
  subscribe()
})

onUnmounted(() => {
  unsubscribeChange()
  if (newFilesTimer) clearTimeout(newFilesTimer)
  if (applyFetchedTimer) clearTimeout(applyFetchedTimer)
  if (rescanFailedTimer) clearTimeout(rescanFailedTimer)
  if (retryQueuedTimer) clearTimeout(retryQueuedTimer)
  if (namePreviewTimer) clearTimeout(namePreviewTimer)
})
</script>

<template>
  <main class="flex-1" @dragover="onDragOver" @dragenter="onDragEnter" @dragleave="onDragLeave" @drop="onDrop">
    <div class="flex flex-col gap-4 p-4 sm:p-6 max-w-8xl w-full">
      <div class="flex items-center gap-2.5">
        <div class="flex items-center justify-center size-9 rounded-lg bg-primary/10">
          <PackageOpen class="size-4.5 text-primary" />
        </div>
        <h1 class="text-xl font-semibold text-foreground tracking-tight">Staging</h1>
        <span
          v-if="summary.total > 0"
          class="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary/15 text-primary text-xs font-semibold tabular-nums"
        >
          {{ summary.total }}
        </span>
        <Transition name="fade">
          <span
            v-if="newFilesDetected"
            class="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-medium"
          >
            <span class="size-1.5 rounded-full bg-current animate-pulse" />
            New files detected
          </span>
        </Transition>
        <Transition name="fade">
          <span
            v-if="applyFetchedResult"
            class="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-medium"
          >
            <CheckCircle2 class="size-3.5" />
            {{ applyFetchedResultMessage(applyFetchedResult) }}
          </span>
        </Transition>
        <Transition name="fade">
          <span
            v-if="retryQueued !== null"
            class="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-primary/15 text-primary text-xs font-medium"
          >
            <CheckCircle2 class="size-3.5" />
            {{ retryQueued === 0 ? 'No error files to retry' : `Retrying ${retryQueued} file${retryQueued !== 1 ? 's' : ''}` }}
          </span>
        </Transition>
        <Transition name="fade">
          <span
            v-if="!socketConnected"
            class="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-muted text-muted-foreground text-xs font-medium"
          >
            <span class="size-1.5 rounded-full bg-muted-foreground animate-pulse" />
            Reconnecting
          </span>
        </Transition>
        <Transition name="fade">
          <span
            v-if="rescanFailed"
            class="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-xs font-medium"
          >
            <AlertCircle class="size-3.5" />
            Rescan failed
          </span>
        </Transition>
      </div>

      <StagingToolbar
        :active-status="filters.status"
        :selection-count="selectionCount"
        :has-selection="hasSelection"
        :fetched-count="fetchedCount"
        :error-count="errorCount"
        @status-filter="setStatus"
        @search="setSearch"
        @rescan="refresh"
        @rescan-error="handleRescanError"
        @retry-fetch="handleRetryFetch"
        @bulk-discard="handleBulkDiscard"
        @finalize="openFinalize"
        @bulk-edit="openBulkEdit"
        @set-destination="openSetDestination"
        @refresh="refresh"
        @apply-fetched="handleApplyFetched"
      />

      <!-- Statistics bar -->
      <div v-if="statistics && statistics.byFormat.length > 0" class="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span class="font-medium text-foreground">{{ formatBytes(statistics.totalSizeBytes) }} staged</span>
        <span
          v-for="f in statistics.byFormat"
          :key="f.format"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 tabular-nums"
        >
          <span class="uppercase font-medium text-foreground/70">{{ f.format }}</span>
          {{ f.count }} &middot; {{ formatBytes(f.sizeBytes) }}
        </span>
      </div>

      <!-- Drag-and-drop overlay -->
      <div v-if="dragOver" class="fixed inset-0 z-40 flex items-center justify-center bg-primary/5 backdrop-blur-sm pointer-events-none">
        <div
          class="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary/50 bg-card/90 px-12 py-10 shadow-xl max-w-sm w-full"
        >
          <div class="flex items-center justify-center size-16 rounded-2xl bg-primary/10 animate-pulse">
            <PackageOpen class="size-8 text-primary" />
          </div>
          <div class="text-center">
            <p class="text-sm font-medium text-foreground">Drop files to stage</p>
            <p class="text-xs text-muted-foreground mt-1">Supported: {{ SUPPORTED_FORMATS.join(', ') }}</p>
          </div>
        </div>
      </div>

      <StagingFileList
        :items="items"
        :loading="loading"
        :is-selected="isSelected"
        :select-all="selectAll"
        :name-preview-by-file-id="namePreviewByFileId"
        :empty-message="emptyMessage"
        @select="toggleSelect"
        @select-all="toggleSelectAll"
        @open="openSheet"
        @apply-fetched="handleInlineApplyFetched"
      />

      <div v-if="pageCount > 1" class="flex items-center justify-center gap-1">
        <button
          v-for="p in pageCount"
          :key="p"
          class="size-8 rounded-lg text-xs font-medium transition-all active:scale-95"
          :class="filters.page === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
          @click="setPage(p)"
        >
          {{ p }}
        </button>
      </div>
    </div>
  </main>

  <Teleport to="body">
    <StagingFileSheet v-if="selectedFile" :file="selectedFile" @close="closeSheet" @discarded="onDiscarded" @updated="onFileUpdated" />
  </Teleport>

  <StagingFinalizeDialog
    v-if="showFinalizeDialog"
    :selection-payload="getSelectionPayload()"
    :selection-count="selectionCount"
    @close="showFinalizeDialog = false"
    @finalized="onFinalized"
  />

  <StagingBulkEditDialog
    v-if="showBulkEditDialog"
    :selection-payload="getSelectionPayload()"
    :selection-count="selectionCount"
    @close="showBulkEditDialog = false"
    @edited="onBulkEdited"
  />

  <StagingSetDestinationDialog
    v-if="showSetDestinationDialog"
    :selection-payload="getSelectionPayload()"
    :selection-count="selectionCount"
    @close="showSetDestinationDialog = false"
    @updated="onDestinationSet"
  />
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
