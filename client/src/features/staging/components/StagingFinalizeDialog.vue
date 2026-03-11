<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { X, Check, AlertCircle, Copy, Loader2, ExternalLink, ChevronDown, FileText } from 'lucide-vue-next'

import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useStagingFinalize } from '../composables/useStagingFinalize'

const props = defineProps<{
  selectionPayload: { fileIds?: number[]; selectAll?: boolean; excludedIds?: number[]; status?: string; search?: string }
  selectionCount: number
}>()

const emit = defineEmits<{
  close: []
  finalized: []
}>()

const router = useRouter()
const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { result, loading, error, finalize, reset } = useStagingFinalize()

const defaultLibraryId = ref<number | null>(null)
const defaultFolderId = ref<number | null>(null)
const expandedErrors = ref<Set<number>>(new Set())
const selectionSummary = ref<{ total: number; withDestination: number; withoutDestination: number } | null>(null)

const duplicateCount = computed(() => result.value?.results.filter((r) => r.isDuplicate).length ?? 0)

const namePreview = ref<{ fileId: number; fileName: string; newName: string }[]>([])
const previewLoading = ref(false)
let previewReqSeq = 0

const selectedLibrary = computed(() => libraries.value.find((l) => l.id === defaultLibraryId.value))
const folders = computed(() => selectedLibrary.value?.folders ?? [])

const requiresDefaultDestination = computed(() => (selectionSummary.value?.withoutDestination ?? props.selectionCount) > 0)
const canStart = computed(() => {
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
  void fetchNamePreview(requiresDefaultDestination.value ? defaultLibraryId.value : null)
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

async function fetchNamePreview(libId: number | null) {
  if (requiresDefaultDestination.value && !libId) {
    namePreview.value = []
    previewLoading.value = false
    return
  }
  const reqId = ++previewReqSeq
  previewLoading.value = true
  try {
    const payload = {
      ...props.selectionPayload,
      ...(requiresDefaultDestination.value && libId ? { defaultLibraryId: libId } : {}),
    }
    const res = await api('/api/v1/staging/files/preview-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok || reqId !== previewReqSeq) return
    const rows: { fileId: number; fileName: string; newName: string }[] = await res.json()
    if (reqId !== previewReqSeq) return
    namePreview.value = rows
    previewLoading.value = false
  } catch {
    if (reqId !== previewReqSeq) return
    namePreview.value = []
    previewLoading.value = false
  }
}

async function fetchSelectionSummary() {
  try {
    const res = await api('/api/v1/staging/files/selection-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(props.selectionPayload),
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

watch([defaultLibraryId, requiresDefaultDestination], ([libId]) => {
  void fetchNamePreview(libId)
})

async function start() {
  if (!canStart.value) return
  await finalize({
    ...props.selectionPayload,
    ...(requiresDefaultDestination.value
      ? {
          defaultLibraryId: defaultLibraryId.value!,
          defaultFolderId: defaultFolderId.value!,
        }
      : {}),
  })
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
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-2xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 class="text-base font-semibold text-foreground">
            {{ result ? 'Finalize Results' : `Finalize ${selectionCount} file${selectionCount === 1 ? '' : 's'}` }}
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
                  ? `${selectionSummary.withoutDestination} of ${selectionSummary.total} selected file${selectionSummary.total === 1 ? '' : 's'} need a destination`
                  : 'All selected files already have destination set'
              }}
            </p>
          </div>

          <div v-if="requiresDefaultDestination" class="space-y-3">
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Default Destination Library</span>
              <select
                class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="defaultLibraryId ?? ''"
                @change="onLibraryChange"
              >
                <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
              </select>
            </label>

            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Default Destination Folder</span>
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
              <span class="text-xs font-medium text-muted-foreground">Rename preview</span>
              <span v-if="previewLoading" class="text-xs text-muted-foreground italic">Loading...</span>
            </div>
            <div class="rounded-lg border border-border bg-muted/20 divide-y divide-border max-h-48 overflow-y-auto">
              <div v-for="p in namePreview.slice(0, 8)" :key="p.fileId" class="px-3 py-1.5 text-xs">
                <span class="text-foreground font-medium font-mono break-all">{{ p.newName }}</span>
              </div>
              <div v-if="namePreview.length > 8" class="px-3 py-1.5 text-xs text-muted-foreground italic">
                +{{ namePreview.length - 8 }} more files
              </div>
            </div>
          </div>

          <p v-if="error" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ error }}</p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button class="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all" @click="handleClose">
              Cancel
            </button>
            <button
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              :disabled="!canStart || loading"
              @click="start"
            >
              <Loader2 v-if="loading" class="size-3.5 animate-spin" />
              Start
            </button>
          </div>
        </div>

        <div v-else class="px-5 py-4 space-y-4">
          <div class="flex items-center gap-3 rounded-lg p-3" :class="result.failed === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'">
            <Check v-if="result.failed === 0" class="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <AlertCircle v-else class="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <p class="text-sm font-medium">{{ result.succeeded }} of {{ result.total }} files finalized</p>
              <p v-if="result.failed > 0" class="text-xs text-muted-foreground mt-0.5">
                {{ result.failed }} failed{{ duplicateCount > 0 ? ` (${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''})` : '' }}
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
                  View <ExternalLink class="size-3" />
                </button>
                <button
                  v-if="!r.success && r.isDuplicate && r.existingBookId"
                  class="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 shrink-0"
                  @click="goToBook(r.existingBookId!)"
                >
                  View existing <ExternalLink class="size-3" />
                </button>
                <button
                  v-if="!r.success && !r.isDuplicate && r.message"
                  class="text-xs text-red-500 flex items-center gap-1 shrink-0 hover:text-red-600 transition-colors"
                  @click="expandedErrors.has(r.fileId) ? expandedErrors.delete(r.fileId) : expandedErrors.add(r.fileId)"
                >
                  {{ expandedErrors.has(r.fileId) ? 'Hide' : 'Details' }}
                  <ChevronDown class="size-3 transition-transform" :class="expandedErrors.has(r.fileId) ? 'rotate-180' : ''" />
                </button>
              </div>
              <div v-if="!r.success && r.message && expandedErrors.has(r.fileId)" class="px-3 pb-2">
                <p class="text-xs text-red-500 bg-red-500/10 rounded-md p-2 break-all">{{ r.message }}</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end pt-2">
            <button
              class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              @click="handleClose"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
