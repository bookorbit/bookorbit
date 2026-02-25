<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CheckCircle2, FileUp, Loader2, Upload, X, XCircle } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { Library } from '@projectx/types'
import { SUPPORTED_FORMATS, SUPPORTED_FORMATS_ACCEPT, useBookUpload } from '../composables/useBookUpload'
import { useLibraries } from '../composables/useLibraries'

const props = defineProps<{
  libraryId?: number
}>()

const emit = defineEmits<{
  close: []
  uploaded: [bookIds: number[]]
}>()

const { libraries, fetchLibraries } = useLibraries()

const selectedLibraryId = ref<number | undefined>(props.libraryId)
const folders = ref<Library['folders']>([])
const selectedFolderId = ref<number | undefined>(undefined)
const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const { files, pendingCount, isUploading, doneCount, errorCount, uploadedBookIds, addFiles, removeFile, reset, startUpload } = useBookUpload()

const canUpload = computed(() => pendingCount.value > 0 && !isUploading.value && selectedLibraryId.value !== undefined)
const hasFiles = computed(() => files.value.length > 0)
const allDone = computed(() => hasFiles.value && files.value.every((f) => f.status === 'done' || f.status === 'error'))

async function loadFolders(libraryId: number) {
  const res = await api(`/api/libraries/${libraryId}`)
  if (res.ok) {
    const data: Library = await res.json()
    folders.value = data.folders ?? []
    selectedFolderId.value = folders.value[0]?.id
  }
}

watch(selectedLibraryId, (id) => {
  folders.value = []
  selectedFolderId.value = undefined
  if (id !== undefined) loadFolders(id)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') handleClose()
}

onMounted(async () => {
  if (!props.libraryId) {
    if (!libraries.value.length) await fetchLibraries()
    if (selectedLibraryId.value !== undefined) loadFolders(selectedLibraryId.value)
  } else {
    loadFolders(props.libraryId)
  }
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function handleClose() {
  if (uploadedBookIds.value.length > 0) emit('uploaded', uploadedBookIds.value)
  emit('close')
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const dropped = Array.from(e.dataTransfer?.files ?? [])
  if (dropped.length > 0) addFiles(dropped)
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  if (picked.length > 0) addFiles(picked)
  input.value = ''
}

async function handleUpload() {
  if (selectedLibraryId.value === undefined) return
  await startUpload(selectedLibraryId.value, selectedFolderId.value)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="handleClose" />

      <div
        class="relative flex flex-col w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden"
        style="max-height: min(90vh, 640px)"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span class="text-sm font-semibold text-foreground">Upload Books</span>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="handleClose"
          >
            <X :size="15" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <!-- Library selector (only when not pre-scoped to a library) -->
          <div v-if="!libraryId" class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">Library</label>
            <select
              v-model="selectedLibraryId"
              class="h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option :value="undefined" disabled>Select a library...</option>
              <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
            </select>
          </div>

          <!-- Folder selector (only shown when library has multiple folders) -->
          <div v-if="folders.length > 1" class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">Target folder</label>
            <select
              v-model="selectedFolderId"
              class="h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </select>
          </div>

          <!-- Dropzone -->
          <div
            class="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer"
            :class="isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/30'"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="openFilePicker"
          >
            <div class="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
              <FileUp :size="20" class="text-muted-foreground" />
            </div>
            <div>
              <p class="text-sm font-medium text-foreground">Drop files here or click to browse</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ SUPPORTED_FORMATS.join(', ') }} - up to 500 MB each</p>
            </div>
            <input ref="fileInputRef" type="file" multiple :accept="SUPPORTED_FORMATS_ACCEPT" class="sr-only" @change="onFileInputChange" />
          </div>

          <!-- File list -->
          <div v-if="hasFiles" class="flex flex-col gap-1">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-medium text-muted-foreground">{{ files.length }} file{{ files.length === 1 ? '' : 's' }}</span>
              <button v-if="!isUploading" class="text-xs text-muted-foreground hover:text-foreground transition-colors" @click="reset">
                Clear all
              </button>
            </div>

            <div v-for="item in files" :key="item.id" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/40 border border-border/40">
              <!-- Status icon -->
              <div class="shrink-0">
                <Loader2 v-if="item.status === 'uploading'" :size="16" class="text-primary animate-spin" />
                <CheckCircle2 v-else-if="item.status === 'done'" :size="16" class="text-green-500" />
                <XCircle v-else-if="item.status === 'error'" :size="16" class="text-destructive" />
                <div v-else class="w-4 h-4 rounded-full border-2 border-border" />
              </div>

              <!-- File info -->
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-foreground truncate">{{ item.file.name }}</p>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[11px] text-muted-foreground">{{ formatBytes(item.file.size) }}</span>
                  <span v-if="item.status === 'error'" class="text-[11px] text-destructive truncate">{{ item.error }}</span>
                  <span v-else-if="item.status === 'uploading'" class="text-[11px] text-primary">{{ item.progress }}%</span>
                  <span v-else-if="item.status === 'done'" class="text-[11px] text-green-500">Done</span>
                </div>

                <!-- Progress bar -->
                <div v-if="item.status === 'uploading'" class="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                  <div class="h-full bg-primary rounded-full transition-all duration-150" :style="{ width: `${item.progress}%` }" />
                </div>
              </div>

              <!-- Remove button -->
              <button
                v-if="item.status !== 'uploading'"
                class="shrink-0 flex items-center justify-center w-5 h-5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                @click="removeFile(item.id)"
              >
                <X :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <!-- Summary -->
          <span v-if="allDone" class="text-xs text-muted-foreground">
            {{ doneCount }} uploaded<template v-if="errorCount > 0">, {{ errorCount }} failed</template>
          </span>
          <span v-else class="text-xs text-muted-foreground" />

          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="handleClose"
            >
              {{ allDone ? 'Close' : 'Cancel' }}
            </button>
            <button
              class="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="!canUpload"
              @click="handleUpload"
            >
              <Upload :size="13" />
              Upload{{ pendingCount > 0 ? ` (${pendingCount})` : '' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
