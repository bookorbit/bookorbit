<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Upload, RotateCw, Trash2, PenLine, FileText, Search, X, Wand2, RefreshCw, FolderPlus, Loader2, Pause, Play } from '@lucide/vue'
import type { BookDockFileStatus } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { SUPPORTED_FORMATS_ACCEPT, useBookDockUpload } from '../composables/useBookDockUpload'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  activeStatus: BookDockFileStatus | undefined
  selectionCount: number
  hasSelection: boolean
  fetchedCount: number
  errorCount: number
  paused: boolean
}>()

const emit = defineEmits<{
  statusFilter: [BookDockFileStatus | undefined]
  pause: []
  pauseError: []
  resume: []
  resumeError: []
  rescan: []
  rescanError: []
  retryFetch: []
  setDestination: []
  bulkDiscard: []
  bulkEdit: []
  finalize: []
  refresh: []
  search: [string]
  applyFetched: []
}>()

const { files: uploadFiles, isUploading, addFiles, clearCompleted } = useBookDockUpload()
const { isDemoRestrictedAccount } = usePermissions()
const fileInput = ref<HTMLInputElement | null>(null)
const rescanning = ref(false)
const processingStateChanging = ref(false)
const searchQuery = ref('')
const showSearch = ref(false)
const showUploadPopover = ref(false)

const uploadTotal = computed(() => uploadFiles.value.length)
const uploadDone = computed(() => uploadFiles.value.filter((f) => f.status === 'done').length)
const uploadError = computed(() => uploadFiles.value.filter((f) => f.status === 'error').length)
const uploadProgress = computed(() => (uploadTotal.value > 0 ? Math.round((uploadDone.value / uploadTotal.value) * 100) : 0))
const canBulkEdit = computed(() => !isDemoRestrictedAccount.value)

let popoverTimer: ReturnType<typeof setTimeout> | null = null

watch(isUploading, (uploading) => {
  if (uploading) {
    showUploadPopover.value = true
    if (popoverTimer) clearTimeout(popoverTimer)
  } else if (showUploadPopover.value) {
    if (popoverTimer) clearTimeout(popoverTimer)
    popoverTimer = setTimeout(() => {
      showUploadPopover.value = false
    }, 3000)
  }
})

onUnmounted(() => {
  if (popoverTimer) clearTimeout(popoverTimer)
})

const tabs: { label: string; value: BookDockFileStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'Ready', value: 'ready' },
  { label: 'Error', value: 'error' },
]

function openFilePicker() {
  clearCompleted()
  fileInput.value?.click()
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    addFiles(input.files)
    input.value = ''
  }
}

async function rescan() {
  if (props.paused) return
  rescanning.value = true
  try {
    const res = await api('/api/v1/book-dock/rescan', { method: 'POST' })
    if (res.ok) {
      emit('rescan')
    } else {
      emit('rescanError')
    }
  } catch {
    emit('rescanError')
  } finally {
    rescanning.value = false
  }
}

async function toggleProcessingState() {
  if (processingStateChanging.value) return
  processingStateChanging.value = true
  const endpoint = props.paused ? '/api/v1/book-dock/resume' : '/api/v1/book-dock/pause'
  const wasPaused = props.paused
  try {
    const res = await api(endpoint, { method: 'POST' })
    if (res.ok) {
      if (wasPaused) emit('resume')
      else emit('pause')
    } else {
      if (wasPaused) emit('resumeError')
      else emit('pauseError')
    }
  } catch {
    if (wasPaused) emit('resumeError')
    else emit('pauseError')
  } finally {
    processingStateChanging.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => emit('search', searchQuery.value), 300)
}

function clearSearch() {
  searchQuery.value = ''
  showSearch.value = false
  emit('search', '')
}

function openSearch() {
  showSearch.value = true
}

function closeUploadPopover() {
  showUploadPopover.value = false
}

function emitFinalize() {
  emit('finalize')
}

function emitSetDestination() {
  emit('setDestination')
}

function emitApplyFetched() {
  emit('applyFetched')
}

function emitRetryFetch() {
  emit('retryFetch')
}

function emitBulkEdit() {
  emit('bulkEdit')
}

function emitBulkDiscard() {
  emit('bulkDiscard')
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.label"
        class="h-7 px-3 rounded-lg text-xs font-medium transition-all active:scale-95"
        :class="
          props.activeStatus === tab.value ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'
        "
        @click="$emit('statusFilter', tab.value)"
      >
        {{ tab.label }}
      </button>

      <!-- Search toggle + input -->
      <div v-if="showSearch" class="flex items-center gap-1.5 h-7 rounded-lg border border-input bg-background px-2">
        <Search class="size-3.5 text-muted-foreground shrink-0" />
        <input
          v-model="searchQuery"
          placeholder="Search files..."
          class="h-full w-32 sm:w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground/80"
          @input="onSearchInput"
        />
        <button data-testid="book-dock-search-clear" class="text-muted-foreground hover:text-foreground shrink-0" @click="clearSearch">
          <X class="size-3" />
        </button>
      </div>
      <button
        v-else
        data-testid="book-dock-search-toggle"
        class="flex items-center justify-center size-7 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        @click="openSearch"
      >
        <Search class="size-3.5" />
      </button>

      <div class="flex-1" />

      <input ref="fileInput" type="file" :accept="SUPPORTED_FORMATS_ACCEPT" multiple class="hidden" @change="onFilesSelected" />

      <button
        data-testid="book-dock-processing-toggle"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100"
        :disabled="processingStateChanging"
        @click="toggleProcessingState"
      >
        <Loader2 v-if="processingStateChanging" class="size-3.5 animate-spin" />
        <Play v-else-if="props.paused" class="size-3.5" />
        <Pause v-else class="size-3.5" />
        {{ props.paused ? 'Resume' : 'Pause' }}
      </button>

      <button
        data-testid="book-dock-rescan"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        :disabled="rescanning || props.paused"
        @click="rescan"
      >
        <RotateCw class="size-3.5" :class="rescanning ? 'animate-spin' : ''" />
        Rescan
      </button>

      <div class="relative">
        <button
          data-testid="book-dock-upload"
          class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all active:scale-95"
          @click="openFilePicker"
        >
          <Loader2 v-if="isUploading" class="size-3.5 animate-spin" />
          <Upload v-else class="size-3.5" />
          Upload
        </button>

        <div
          v-if="showUploadPopover"
          class="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-lg border border-border bg-card shadow-lg p-3 space-y-2.5"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-foreground">{{ isUploading ? 'Uploading...' : 'Done' }}</span>
            <button class="text-muted-foreground hover:text-foreground transition-colors" @click="closeUploadPopover">
              <X class="size-3" />
            </button>
          </div>
          <div class="h-1 rounded-full bg-muted overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="uploadError > 0 && !isUploading ? 'bg-destructive' : 'bg-primary'"
              :style="{ width: `${uploadProgress}%` }"
            />
          </div>
          <div class="flex items-center gap-3 text-[11px]">
            <span class="text-emerald-600 dark:text-emerald-400 tabular-nums">{{ uploadDone }} done</span>
            <span v-if="uploadError > 0" class="text-destructive tabular-nums">{{ uploadError }} failed</span>
            <span class="text-muted-foreground tabular-nums ml-auto">{{ uploadTotal }} total</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="props.hasSelection" class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <span class="text-xs font-medium text-foreground">{{ props.selectionCount }} selected</span>
      <div class="flex-1" />
      <button
        data-testid="book-dock-finalize"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all active:scale-95"
        @click="emitFinalize"
      >
        <FileText class="size-3.5" />
        Finalize
      </button>
      <button
        data-testid="book-dock-set-destination"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-all active:scale-95"
        @click="emitSetDestination"
      >
        <FolderPlus class="size-3.5" />
        Set Destination
      </button>
      <Tooltip v-if="props.fetchedCount > 0">
        <TooltipTrigger as-child>
          <button
            data-testid="book-dock-apply-fetched"
            class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
            @click="emitApplyFetched"
          >
            <Wand2 class="size-3.5" />
            Apply Fetched
            <span
              class="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500/20 text-[10px] font-semibold tabular-nums"
              >{{ props.fetchedCount }}</span
            >
          </button>
        </TooltipTrigger>
        <TooltipContent
          >Apply auto-fetched provider metadata to {{ props.fetchedCount }} file{{ props.fetchedCount !== 1 ? 's' : '' }}</TooltipContent
        >
      </Tooltip>
      <Tooltip v-if="props.errorCount > 0">
        <TooltipTrigger as-child>
          <button
            data-testid="book-dock-retry-errors"
            class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-sky-500/12 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 transition-all active:scale-95"
            @click="emitRetryFetch"
          >
            <RefreshCw class="size-3.5" />
            Retry Errors
            <span
              class="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-muted-foreground/20 text-[10px] font-semibold tabular-nums"
              >{{ props.errorCount }}</span
            >
          </button>
        </TooltipTrigger>
        <TooltipContent>Retry metadata fetch for {{ props.errorCount }} error file{{ props.errorCount !== 1 ? 's' : '' }}</TooltipContent>
      </Tooltip>
      <button
        v-if="canBulkEdit"
        data-testid="book-dock-bulk-edit"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-violet-500/12 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-all active:scale-95"
        @click="emitBulkEdit"
      >
        <PenLine class="size-3.5" />
        Bulk Edit
      </button>
      <button
        data-testid="book-dock-bulk-discard"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
        @click="emitBulkDiscard"
      >
        <Trash2 class="size-3.5" />
        Discard
      </button>
    </div>
  </div>
</template>
