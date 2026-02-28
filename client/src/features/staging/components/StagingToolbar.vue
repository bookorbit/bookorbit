<script setup lang="ts">
import { ref } from 'vue'
import { Upload, RotateCw, Trash2, PenLine, FileText, Search, X, Wand2, RefreshCw } from 'lucide-vue-next'
import type { StagingFileStatus } from '@projectx/types'
import { api } from '@/lib/api'
import { SUPPORTED_FORMATS_ACCEPT, useStagingUpload } from '../composables/useStagingUpload'

defineProps<{
  activeStatus: StagingFileStatus | undefined
  selectionCount: number
  hasSelection: boolean
  fetchedCount: number
  errorCount: number
}>()

const emit = defineEmits<{
  statusFilter: [StagingFileStatus | undefined]
  rescan: []
  rescanError: []
  retryFetch: []
  bulkDiscard: []
  bulkEdit: []
  finalize: []
  refresh: []
  search: [string]
  applyFetched: []
}>()

const { addFiles } = useStagingUpload()
const fileInput = ref<HTMLInputElement | null>(null)
const rescanning = ref(false)
const searchQuery = ref('')
const showSearch = ref(false)

const tabs: { label: string; value: StagingFileStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'Ready', value: 'ready' },
  { label: 'Error', value: 'error' },
]

function openFilePicker() {
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
  rescanning.value = true
  try {
    const res = await api('/api/v1/staging/rescan', { method: 'POST' })
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
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.label"
        class="h-7 px-3 rounded-lg text-xs font-medium transition-all active:scale-95"
        :class="activeStatus === tab.value ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'"
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
          class="h-full w-32 sm:w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          @input="onSearchInput"
        />
        <button class="text-muted-foreground hover:text-foreground shrink-0" @click="clearSearch">
          <X class="size-3" />
        </button>
      </div>
      <button
        v-else
        class="flex items-center justify-center size-7 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        @click="showSearch = true"
      >
        <Search class="size-3.5" />
      </button>

      <div class="flex-1" />

      <input ref="fileInput" type="file" :accept="SUPPORTED_FORMATS_ACCEPT" multiple class="hidden" @change="onFilesSelected" />

      <button
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        :disabled="rescanning"
        @click="rescan"
      >
        <RotateCw class="size-3.5" :class="rescanning ? 'animate-spin' : ''" />
        Rescan
      </button>

      <button
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all active:scale-95"
        @click="openFilePicker"
      >
        <Upload class="size-3.5" />
        Upload
      </button>
    </div>

    <div v-if="hasSelection" class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <span class="text-xs font-medium text-foreground">{{ selectionCount }} selected</span>
      <div class="flex-1" />
      <button
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all active:scale-95"
        @click="$emit('finalize')"
      >
        <FileText class="size-3.5" />
        Finalize
      </button>
      <button
        v-if="fetchedCount > 0"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
        :title="`Apply auto-fetched provider metadata to ${fetchedCount} file${fetchedCount !== 1 ? 's' : ''}`"
        @click="$emit('applyFetched')"
      >
        <Wand2 class="size-3.5" />
        Apply Fetched
        <span
          class="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500/20 text-[10px] font-semibold tabular-nums"
          >{{ fetchedCount }}</span
        >
      </button>
      <button
        v-if="errorCount > 0"
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        :title="`Retry metadata fetch for ${errorCount} error file${errorCount !== 1 ? 's' : ''}`"
        @click="$emit('retryFetch')"
      >
        <RefreshCw class="size-3.5" />
        Retry Errors
        <span
          class="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-muted-foreground/20 text-[10px] font-semibold tabular-nums"
          >{{ errorCount }}</span
        >
      </button>
      <button
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95"
        @click="$emit('bulkEdit')"
      >
        <PenLine class="size-3.5" />
        Bulk Edit
      </button>
      <button
        class="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
        @click="$emit('bulkDiscard')"
      >
        <Trash2 class="size-3.5" />
        Discard
      </button>
    </div>
  </div>
</template>
