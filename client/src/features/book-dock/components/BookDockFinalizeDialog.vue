<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { X, Check, AlertCircle, Copy, Loader2, ExternalLink, ChevronDown, FileText, Trash2 } from '@lucide/vue'
import type { BookDockDiscardDuplicatesResult, BookDockFinalizePreviewResult } from '@bookorbit/types'

import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useBookDockFinalize } from '../composables/useBookDockFinalize'

const { t } = useI18n()

const props = defineProps<{
  selectionPayload: { fileIds?: number[]; selectAll?: boolean; excludedIds?: number[]; status?: string; search?: string }
  selectionCount: number
}>()

type FinalizePayload = {
  fileIds?: number[]
  selectAll?: boolean
  excludedIds?: number[]
  status?: string
  search?: string
  defaultLibraryId?: number
  defaultFolderId?: number
}

const emit = defineEmits<{
  close: []
  finalized: []
}>()

const router = useRouter()
const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { result, loading, error, finalize, reset } = useBookDockFinalize()

const defaultLibraryId = ref<number | null>(null)
const defaultFolderId = ref<number | null>(null)
const expandedErrors = ref<Set<number>>(new Set())
const reimportingIds = reactive(new Set<number>())
const renameInputs = ref<Map<number, string>>(new Map())
const selectionSummary = ref<{ total: number; withDestination: number; withoutDestination: number } | null>(null)
const finalizePreview = ref<BookDockFinalizePreviewResult | null>(null)
const finalizePreviewLoading = ref(false)
const finalizePreviewError = ref<string | null>(null)
const duplicateDiscardLoading = ref(false)
const discardedIds = ref<Set<number>>(new Set())

const resultDuplicateIds = computed(() => result.value?.results.filter((r) => !r.success && r.isDuplicate).map((r) => r.fileId) ?? [])
const resultDuplicateCount = computed(() => resultDuplicateIds.value.length)
const previewDuplicateItems = computed(() => finalizePreview.value?.items.filter((item) => item.status === 'duplicate') ?? [])
const previewDuplicateCount = computed(() => finalizePreview.value?.duplicates ?? 0)
const effectiveSelectionCount = computed(() => finalizePreview.value?.total ?? Math.max(0, props.selectionCount - discardedIds.value.size))

function isFileExistsError(msg: string | undefined): boolean {
  return !!msg?.includes('file with this name already exists')
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot) : ''
}

function getRenameInput(fileId: number): string {
  return renameInputs.value.get(fileId) ?? ''
}

function setRenameInput(fileId: number, value: string) {
  renameInputs.value.set(fileId, value)
  renameInputs.value = new Map(renameInputs.value)
}

function markDiscarded(ids: number[]) {
  if (!ids.length) return
  discardedIds.value = new Set([...discardedIds.value, ...ids])
}

function effectiveSelectionPayload(): {
  fileIds?: number[]
  selectAll?: boolean
  excludedIds?: number[]
  status?: string
  search?: string
} {
  if (props.selectionPayload.selectAll) {
    return {
      ...props.selectionPayload,
      excludedIds: [...new Set([...(props.selectionPayload.excludedIds ?? []), ...discardedIds.value])],
    }
  }

  return {
    ...props.selectionPayload,
    fileIds: (props.selectionPayload.fileIds ?? []).filter((id) => !discardedIds.value.has(id)),
  }
}

function finalizePayload(): FinalizePayload {
  return {
    ...effectiveSelectionPayload(),
    ...(requiresDefaultDestination.value && defaultLibraryId.value !== null && defaultFolderId.value !== null
      ? {
          defaultLibraryId: defaultLibraryId.value,
          defaultFolderId: defaultFolderId.value,
        }
      : {}),
  }
}

async function handleRenameAndRetry(fileId: number) {
  const name = getRenameInput(fileId).trim()
  if (!name || !result.value || reimportingIds.has(fileId)) return
  reimportingIds.add(fileId)
  try {
    const payload: Record<string, unknown> = {
      fileIds: [fileId],
      overrides: [{ fileId, targetFileName: name }],
    }
    if (defaultLibraryId.value !== null) payload.defaultLibraryId = defaultLibraryId.value
    if (defaultFolderId.value !== null) payload.defaultFolderId = defaultFolderId.value
    const res = await api('/api/v1/book-dock/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return
    const newResult = await res.json()
    const fileResult = (newResult.results as typeof result.value.results)[0]
    if (!fileResult) return
    const entry = result.value.results.find((r) => r.fileId === fileId)
    if (entry) {
      Object.assign(entry, fileResult)
      if (fileResult.success) {
        result.value.succeeded++
        result.value.failed--
        renameInputs.value.delete(fileId)
        renameInputs.value = new Map(renameInputs.value)
      }
    }
  } finally {
    reimportingIds.delete(fileId)
  }
}

const namePreview = ref<{ fileId: number; fileName: string; newName: string }[]>([])
const previewLoading = ref(false)
let previewReqSeq = 0

const selectedLibrary = computed(() => libraries.value.find((l) => l.id === defaultLibraryId.value))
const folders = computed(() => selectedLibrary.value?.folders ?? [])

const requiresDefaultDestination = computed(() => (selectionSummary.value?.withoutDestination ?? props.selectionCount) > 0)
const canStart = computed(() => {
  if (effectiveSelectionCount.value <= 0) return false
  if (!selectionSummary.value) return false
  if (!requiresDefaultDestination.value) return true
  return defaultLibraryId.value !== null && defaultFolderId.value !== null
})

onMounted(async () => {
  await Promise.all([fetchLibraries(), fetchSelectionSummary()])
  const first = libraries.value[0]
  if (requiresDefaultDestination.value && first) {
    defaultLibraryId.value = first.id
    const firstFolder = first.folders?.[0]
    if (firstFolder) defaultFolderId.value = firstFolder.id
  }
  void fetchFinalizePreview()
})

function onLibraryChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  const id = Number.isFinite(raw) && raw > 0 ? raw : null
  if (id === null) {
    defaultLibraryId.value = null
    defaultFolderId.value = null
    return
  }
  defaultLibraryId.value = id
  const lib = libraries.value.find((l) => l.id === id)
  defaultFolderId.value = lib?.folders?.[0]?.id ?? null
}

function onFolderChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  defaultFolderId.value = Number.isFinite(raw) && raw > 0 ? raw : null
}

function syncNamePreviewFromFinalizePreview(preview: BookDockFinalizePreviewResult | null) {
  namePreview.value =
    preview?.items.filter((item) => !!item.newName).map((item) => ({ fileId: item.fileId, fileName: item.fileName, newName: item.newName! })) ?? []
}

async function fetchFinalizePreview() {
  if (requiresDefaultDestination.value && (defaultLibraryId.value === null || defaultFolderId.value === null)) {
    finalizePreview.value = null
    namePreview.value = []
    previewLoading.value = false
    finalizePreviewLoading.value = false
    return
  }
  const reqId = ++previewReqSeq
  previewLoading.value = true
  finalizePreviewLoading.value = true
  finalizePreviewError.value = null
  try {
    const res = await api('/api/v1/book-dock/finalize/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalizePayload()),
    })
    if (!res.ok) {
      if (reqId === previewReqSeq) {
        finalizePreview.value = null
        finalizePreviewError.value = `Preview failed (${res.status})`
        namePreview.value = []
        previewLoading.value = false
        finalizePreviewLoading.value = false
      }
      return
    }
    if (reqId !== previewReqSeq) return
    const preview: BookDockFinalizePreviewResult = await res.json()
    if (reqId !== previewReqSeq) return
    finalizePreview.value = preview
    syncNamePreviewFromFinalizePreview(preview)
    previewLoading.value = false
    finalizePreviewLoading.value = false
  } catch {
    if (reqId !== previewReqSeq) return
    finalizePreview.value = null
    finalizePreviewError.value = 'Finalize preview failed'
    namePreview.value = []
    previewLoading.value = false
    finalizePreviewLoading.value = false
  }
}

async function fetchSelectionSummary() {
  try {
    const res = await api('/api/v1/book-dock/files/selection-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectiveSelectionPayload()),
    })
    if (res.ok) {
      selectionSummary.value = await res.json()
      return
    }
  } catch {
    // fallback handled below
  }
  selectionSummary.value = { total: props.selectionCount, withDestination: 0, withoutDestination: props.selectionCount }
}

watch([defaultLibraryId, defaultFolderId, requiresDefaultDestination], () => {
  void fetchFinalizePreview()
})

async function start() {
  if (!canStart.value) return
  await finalize(finalizePayload())
  if (result.value?.succeeded) refreshLibraries()
}

function handleClose() {
  if (result.value) emit('finalized')
  else emit('close')
  reset()
}

function goToBook(bookId: number) {
  router.push({ name: 'book-detail', params: { bookId } })
  handleClose()
}

async function handleReimportDuplicate(fileId: number) {
  if (!result.value || reimportingIds.has(fileId)) return
  reimportingIds.add(fileId)
  try {
    const payload: Record<string, unknown> = {
      fileIds: [fileId],
      overrides: [{ fileId, skipDuplicateCheck: true }],
    }
    if (defaultLibraryId.value !== null) payload.defaultLibraryId = defaultLibraryId.value
    if (defaultFolderId.value !== null) payload.defaultFolderId = defaultFolderId.value
    const res = await api('/api/v1/book-dock/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return
    const newResult = await res.json()
    const fileResult = (newResult.results as typeof result.value.results)[0]
    if (!fileResult) return
    const entry = result.value.results.find((r) => r.fileId === fileId)
    if (entry) {
      Object.assign(entry, fileResult)
      if (fileResult.success) {
        result.value.succeeded++
        result.value.failed--
      }
    }
  } finally {
    reimportingIds.delete(fileId)
  }
}

async function discardDuplicateSelection(payload: FinalizePayload): Promise<BookDockDiscardDuplicatesResult | null> {
  const res = await api('/api/v1/book-dock/finalize/discard-duplicates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return (await res.json()) as BookDockDiscardDuplicatesResult
}

async function handleDiscardPreviewDuplicates() {
  if (duplicateDiscardLoading.value || previewDuplicateCount.value === 0) return
  duplicateDiscardLoading.value = true
  try {
    const discardResult = await discardDuplicateSelection(finalizePayload())
    if (!discardResult || discardResult.discarded === 0) return
    markDiscarded(discardResult.discardedFileIds)
    await fetchSelectionSummary()
    await fetchFinalizePreview()
  } finally {
    duplicateDiscardLoading.value = false
  }
}

async function handleDiscardResultDuplicates() {
  if (!result.value || duplicateDiscardLoading.value || resultDuplicateIds.value.length === 0) return
  duplicateDiscardLoading.value = true
  try {
    const discardResult = await discardDuplicateSelection({
      fileIds: resultDuplicateIds.value,
      ...(defaultLibraryId.value !== null && defaultFolderId.value !== null
        ? {
            defaultLibraryId: defaultLibraryId.value,
            defaultFolderId: defaultFolderId.value,
          }
        : {}),
    })
    if (!discardResult || discardResult.discarded === 0) return

    const removedIds = new Set(discardResult.discardedFileIds)
    markDiscarded(discardResult.discardedFileIds)
    result.value.results = result.value.results.filter((item) => !removedIds.has(item.fileId))
    result.value.total = Math.max(0, result.value.total - discardResult.discarded)
    result.value.failed = Math.max(0, result.value.failed - discardResult.discarded)
  } finally {
    duplicateDiscardLoading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-2xl mx-4 bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 class="text-base font-semibold text-foreground">
            {{ result ? 'Finalize Results' : `Finalize ${effectiveSelectionCount} file${effectiveSelectionCount === 1 ? '' : 's'}` }}
          </h2>
          <button
            class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            @click="handleClose"
          >
            <X class="size-4" />
          </button>
        </div>

        <div v-if="!result" class="px-5 py-4 space-y-4">
          <div v-if="selectionSummary" class="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <p class="text-xs text-muted-foreground">
              {{
                requiresDefaultDestination
                  ? t(
                      'bookDock.finalizeDialog.needDestination',
                      {
                        count: selectionSummary.total,
                        without: selectionSummary.withoutDestination,
                      },
                      selectionSummary.total,
                    )
                  : t('bookDock.finalizeDialog.allHaveDestination')
              }}
            </p>
          </div>

          <div v-if="finalizePreviewLoading" class="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <Loader2 class="size-3.5 animate-spin text-muted-foreground" />
            <span class="text-xs text-muted-foreground">{{ t('bookDock.finalizeDialog.checking') }}</span>
          </div>

          <div v-else-if="finalizePreview" class="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                <Check class="size-3" />
                {{ t('bookDock.finalizeDialog.readyCount', { count: finalizePreview.ready }, finalizePreview.ready) }}
              </span>
              <span
                v-if="finalizePreview.duplicates > 0"
                class="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300"
              >
                <Copy class="size-3" />
                {{ t('bookDock.finalizeDialog.duplicateCount', { count: finalizePreview.duplicates }, finalizePreview.duplicates) }}
              </span>
              <span
                v-if="finalizePreview.destinationConflicts > 0"
                class="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-400"
              >
                <AlertCircle class="size-3" />
                {{
                  t('bookDock.finalizeDialog.conflictCount', { count: finalizePreview.destinationConflicts }, finalizePreview.destinationConflicts)
                }}
              </span>
              <span
                v-if="finalizePreview.missingDestination > 0"
                class="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-400"
              >
                <AlertCircle class="size-3" />
                {{
                  t(
                    'bookDock.finalizeDialog.missingDestinationCount',
                    { count: finalizePreview.missingDestination },
                    finalizePreview.missingDestination,
                  )
                }}
              </span>
              <span
                v-if="finalizePreview.blocked > 0"
                class="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-400"
              >
                <AlertCircle class="size-3" />
                {{ t('bookDock.finalizeDialog.blockedCount', { count: finalizePreview.blocked }, finalizePreview.blocked) }}
              </span>
            </div>

            <div v-if="previewDuplicateItems.length > 0" class="rounded-md border border-amber-500/20 bg-amber-500/5 divide-y divide-amber-500/10">
              <div v-for="item in previewDuplicateItems.slice(0, 5)" :key="item.fileId" class="flex items-center gap-2 px-2.5 py-1.5">
                <Copy class="size-3.5 text-amber-500 shrink-0" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground" :title="item.fileName">{{ item.fileName }}</span>
                <button
                  v-if="item.existingBookId"
                  class="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 shrink-0"
                  @click="goToBook(item.existingBookId)"
                >
                  {{ t('bookDock.finalizeDialog.viewExisting') }} <ExternalLink class="size-3" />
                </button>
              </div>
              <div v-if="previewDuplicateCount > previewDuplicateItems.length" class="px-2.5 py-1.5 text-xs text-muted-foreground">
                {{
                  t(
                    'bookDock.finalizeDialog.moreDuplicates',
                    { count: previewDuplicateCount - previewDuplicateItems.length },
                    previewDuplicateCount - previewDuplicateItems.length,
                  )
                }}
              </div>
            </div>
          </div>

          <p v-if="finalizePreviewError" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ finalizePreviewError }}</p>

          <div v-if="requiresDefaultDestination" class="space-y-3">
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.finalizeDialog.defaultDestinationLibrary') }}</span>
              <select
                class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="defaultLibraryId ?? ''"
                @change="onLibraryChange"
              >
                <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
              </select>
            </label>

            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.finalizeDialog.defaultDestinationFolder') }}</span>
              <select
                class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="defaultFolderId ?? ''"
                @change="onFolderChange"
              >
                <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
              </select>
            </label>
          </div>

          <div v-if="namePreview.length || previewLoading" class="space-y-1.5">
            <div class="flex items-center gap-1.5">
              <FileText class="size-3.5 text-muted-foreground" />
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.finalizeDialog.renamePreview') }}</span>
              <span v-if="previewLoading" class="text-xs text-muted-foreground italic">{{ t('common.loading') }}</span>
            </div>
            <div class="rounded-lg border border-border bg-muted/20 divide-y divide-border max-h-48 overflow-y-auto">
              <div v-for="p in namePreview.slice(0, 8)" :key="p.fileId" class="px-3 py-1.5 text-xs">
                <span class="text-foreground font-medium font-mono break-all">{{ p.newName }}</span>
              </div>
              <div v-if="namePreview.length > 8" class="px-3 py-1.5 text-xs text-muted-foreground italic">
                {{ t('bookDock.finalizeDialog.moreFiles', { count: namePreview.length - 8 }) }}
              </div>
            </div>
          </div>

          <p v-if="error" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ error }}</p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button class="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all" @click="handleClose">
              {{ t('common.cancel') }}
            </button>
            <button
              v-if="previewDuplicateCount > 0"
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
              :disabled="duplicateDiscardLoading"
              @click="handleDiscardPreviewDuplicates"
            >
              <Loader2 v-if="duplicateDiscardLoading" class="size-3.5 animate-spin" />
              <Trash2 v-else class="size-3.5" />
              {{ t('bookDock.finalizeDialog.discardDuplicates') }}
            </button>
            <button
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              :disabled="!canStart || loading"
              @click="start"
            >
              <Loader2 v-if="loading" class="size-3.5 animate-spin" />
              {{ t('bookDock.finalizeDialog.start') }}
            </button>
          </div>
        </div>

        <div v-else class="px-5 py-4 space-y-4">
          <div class="flex items-center gap-3 rounded-lg p-3" :class="result.failed === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'">
            <Check v-if="result.failed === 0" class="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <AlertCircle v-else class="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <p class="text-sm font-medium">
                {{ t('bookDock.finalizeDialog.filesFinalized', { succeeded: result.succeeded, total: result.total }) }}
              </p>
              <p v-if="result.failed > 0" class="text-xs text-muted-foreground mt-0.5">
                {{
                  resultDuplicateCount > 0
                    ? t('bookDock.finalizeDialog.failedWithDuplicates', { failed: result.failed, count: resultDuplicateCount }, resultDuplicateCount)
                    : t('bookDock.finalizeDialog.failedCount', { count: result.failed }, result.failed)
                }}
              </p>
            </div>
          </div>

          <div class="max-h-56 overflow-y-auto space-y-1">
            <div
              v-for="r in result.results"
              :key="r.fileId"
              class="rounded-lg overflow-hidden"
              :class="r.success ? '' : r.isDuplicate ? 'bg-amber-500/5' : 'bg-red-500/5'"
            >
              <div class="flex items-center gap-2 px-3 py-2 text-sm" :class="r.success ? 'hover:bg-muted/50' : ''">
                <Check v-if="r.success" class="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <Copy v-else-if="r.isDuplicate" class="size-3.5 text-amber-500 shrink-0" />
                <AlertCircle v-else class="size-3.5 text-red-500 shrink-0" />
                <span class="flex-1 truncate font-mono text-xs" :title="r.newName ?? r.fileName">{{ r.newName ?? r.fileName }}</span>
                <button
                  v-if="r.success && r.bookId"
                  class="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
                  @click="goToBook(r.bookId!)"
                >
                  {{ t('bookDock.finalizeDialog.view') }} <ExternalLink class="size-3" />
                </button>
                <button
                  v-if="!r.success && r.isDuplicate && r.existingBookId"
                  class="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 shrink-0"
                  @click="goToBook(r.existingBookId!)"
                >
                  {{ t('bookDock.finalizeDialog.viewExisting') }} <ExternalLink class="size-3" />
                </button>
                <button
                  v-if="!r.success && r.isDuplicate"
                  class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0 transition-colors"
                  :disabled="reimportingIds.has(r.fileId)"
                  @click="handleReimportDuplicate(r.fileId)"
                >
                  <Loader2 v-if="reimportingIds.has(r.fileId)" class="size-3 animate-spin" />
                  {{ t('bookDock.finalizeDialog.importAnyway') }}
                </button>
                <button
                  v-if="!r.success && !r.isDuplicate && r.message && !isFileExistsError(r.message)"
                  class="text-xs text-red-500 flex items-center gap-1 shrink-0 hover:text-red-600 transition-colors"
                  @click="expandedErrors.has(r.fileId) ? expandedErrors.delete(r.fileId) : expandedErrors.add(r.fileId)"
                >
                  {{ expandedErrors.has(r.fileId) ? t('bookDock.finalizeDialog.hide') : t('bookDock.finalizeDialog.details') }}
                  <ChevronDown class="size-3 transition-transform" :class="expandedErrors.has(r.fileId) ? 'rotate-180' : ''" />
                </button>
              </div>
              <div v-if="!r.success && isFileExistsError(r.message)" class="px-3 pb-2.5">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs text-muted-foreground shrink-0">{{ t('bookDock.finalizeDialog.alreadyExistsSaveAs') }}</span>
                  <input
                    type="text"
                    :value="getRenameInput(r.fileId)"
                    :placeholder="t('bookDock.finalizeDialog.renamePlaceholder', { name: r.fileName.replace(/\.[^.]+$/, '') })"
                    class="flex-1 min-w-0 h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    @input="setRenameInput(r.fileId, ($event.target as HTMLInputElement).value)"
                  />
                  <span class="text-xs text-muted-foreground font-mono shrink-0">{{ fileExtension(r.fileName) }}</span>
                  <button
                    class="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium transition-all hover:opacity-90 active:scale-95 flex items-center gap-1 shrink-0 disabled:opacity-50"
                    :disabled="!getRenameInput(r.fileId).trim() || reimportingIds.has(r.fileId)"
                    @click="handleRenameAndRetry(r.fileId)"
                  >
                    <Loader2 v-if="reimportingIds.has(r.fileId)" class="size-3 animate-spin" />
                    {{ t('bookDock.finalizeDialog.import') }}
                  </button>
                </div>
              </div>
              <div v-if="!r.success && r.message && expandedErrors.has(r.fileId)" class="px-3 pb-2">
                <p class="text-xs text-red-500 bg-red-500/10 rounded-md p-2 break-all">{{ r.message }}</p>
              </div>
            </div>
          </div>

          <div class="flex justify-between gap-2 pt-2">
            <button
              v-if="resultDuplicateCount > 0"
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
              :disabled="duplicateDiscardLoading"
              @click="handleDiscardResultDuplicates"
            >
              <Loader2 v-if="duplicateDiscardLoading" class="size-3.5 animate-spin" />
              <Trash2 v-else class="size-3.5" />
              {{ t('bookDock.finalizeDialog.discardDuplicates') }}
            </button>
            <div v-else />
            <button
              class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              @click="handleClose"
            >
              {{ t('bookDock.done') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
