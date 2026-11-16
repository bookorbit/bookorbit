<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { CheckCheck, CheckCircle2, FileUp, Loader2, PackageOpen, Plus, RotateCcw, Upload, X, XCircle } from '@lucide/vue'
import { Permission, type BookDockUploadTarget } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { fetchDockUploadTargets } from '@/features/book-dock/api/book-dock.api'
import { readUploadMode, rememberUploadMode, type LibraryUploadMode } from '../composables/useUploadModeMemory'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { SUPPORTED_FORMATS, SUPPORTED_FORMATS_ACCEPT, useBookUpload, type FileUploadStatus } from '../composables/useBookUpload'
import { emitLibraryUploadCompleted } from '../composables/useLibraryUploadEvents'
import { useBookDestination } from '../composables/useBookDestination'
import BookDestinationFields from './BookDestinationFields.vue'
import { formatBytes } from '@/lib/formatting'
const props = defineProps<{
  libraryId?: number
}>()

const emit = defineEmits<{
  close: []
  uploaded: [bookIds: number[]]
}>()

const router = useRouter()
const { t } = useI18n()
const destination = useBookDestination({ libraryId: props.libraryId })
const { libraryId: selectedLibraryId, folderId: selectedFolderId, selectedLibrary, hasDestination, fetchLibraries } = destination
const { maxUploadSizeMb } = useAppInfo()

const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const {
  files,
  pendingCount,
  isUploading,
  doneCount,
  errorCount,
  uploadedBookIds,
  addFiles,
  removeFile,
  retryFile,
  reset,
  applyAllowedFormats,
  startUpload,
  startDockUpload,
} = useBookUpload()
const { user } = useAuth()
const { hasPermission } = usePermissions()

/** Libraries whose dock is on and takes uploads from this person (D23). */
const dockTargets = ref<BookDockUploadTarget[]>([])
const dockTarget = computed(() => dockTargets.value.find((target) => target.libraryId === selectedLibraryId.value) ?? null)
const mode = ref<LibraryUploadMode>('review')
const reviewInDock = computed(() => dockTarget.value !== null && mode.value === 'review')
const refusedCount = computed(() => files.value.filter((item) => item.refusedFormat).length)

watch(
  [selectedLibraryId, dockTarget],
  ([libraryId, target]) => {
    if (libraryId != null && target) mode.value = readUploadMode(user.value?.id ?? null, libraryId) ?? 'review'
  },
  { immediate: true },
)

watch(
  [() => selectedLibrary.value?.allowedFormats, () => files.value.length],
  () => applyAllowedFormats(selectedLibrary.value?.allowedFormats ?? []),
  { immediate: true },
)

function itemError(item: { refusedFormat?: boolean; error?: string; file: File }): string | undefined {
  if (!item.refusedFormat) return item.error
  return t('library.upload.dock.notAllowed', { library: selectedLibrary.value?.name ?? '', format: getFormat(item.file.name) })
}

function goToDock() {
  if (dockTarget.value) void router.push({ name: 'book-dock', query: { dock: String(dockTarget.value.dockId) } })
  handleClose()
}

const canUpload = computed(() => pendingCount.value > 0 && !isUploading.value && hasDestination.value)
const hasFiles = computed(() => files.value.length > 0)
const allDone = computed(() => hasFiles.value && files.value.every((f) => f.status === 'done' || f.status === 'error'))
const allSuccess = computed(() => allDone.value && errorCount.value === 0)

const headerTitle = computed(() => {
  if (isUploading.value) return t('library.upload.header.uploading')
  if (allDone.value) return t('library.upload.header.complete')
  if (selectedLibrary.value) return t('library.upload.header.uploadTo', { library: selectedLibrary.value.name })
  return t('library.upload.header.uploadBooks')
})

const fileSummary = computed(() => {
  if (!hasFiles.value) return null
  const totalBytes = files.value.reduce((sum, f) => sum + f.file.size, 0)
  const byFormat: Record<string, number> = {}
  for (const f of files.value) {
    const ext = f.file.name.split('.').pop()?.toUpperCase() ?? '?'
    byFormat[ext] = (byFormat[ext] ?? 0) + 1
  }
  const formatParts = Object.entries(byFormat).map(([ext, count]) => `${count} ${ext}`)
  return { total: files.value.length, totalBytes, formatParts }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') handleClose()
}

onMounted(() => {
  void fetchLibraries()
  if (hasPermission(Permission.BookDockAccess)) {
    void fetchDockUploadTargets().then((targets) => {
      dockTargets.value = targets
    })
  }
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function handleClose() {
  if (uploadedBookIds.value.length > 0) emit('uploaded', uploadedBookIds.value)
  emit('close')
}

function goToLibrary() {
  if (selectedLibraryId.value) {
    router.push({ name: 'library', params: { id: selectedLibraryId.value } })
  }
  handleClose()
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
  const libraryId = selectedLibraryId.value
  if (!hasDestination.value || libraryId === null) return
  const folderId = selectedFolderId.value ?? undefined

  const pendingAtStart = files.value.filter((f) => f.status === 'pending').length
  if (pendingAtStart === 0) return

  if (dockTarget.value) rememberUploadMode(user.value?.id ?? null, libraryId, mode.value)
  if (reviewInDock.value) {
    await startDockUpload(libraryId)
    return
  }

  const uploadedBefore = new Set(files.value.filter((f) => f.status === 'done' && f.bookId !== undefined).map((f) => f.bookId!))
  const errorCountBefore = files.value.filter((f) => f.status === 'error').length

  await startUpload(libraryId, folderId)

  const uploadedAfter = files.value.filter((f) => f.status === 'done' && f.bookId !== undefined).map((f) => f.bookId!)
  const newlyUploaded = uploadedAfter.filter((id) => !uploadedBefore.has(id))
  const errorCountAfter = files.value.filter((f) => f.status === 'error').length

  emitLibraryUploadCompleted({
    libraryId,
    uploadedBookIds: newlyUploaded,
    uploadedCount: newlyUploaded.length,
    failedCount: Math.max(0, errorCountAfter - errorCountBefore),
    attemptedCount: pendingAtStart,
  })
}

function fileRowClass(status: FileUploadStatus): string {
  if (status === 'done') return 'bg-emerald-500/5 border-emerald-500/20'
  if (status === 'error') return 'bg-destructive/5 border-destructive/20'
  if (status === 'uploading') return 'bg-primary/5 border-primary/20'
  return 'bg-muted/40 border-border/40'
}

function getFormat(filename: string): string {
  return filename.split('.').pop()?.toUpperCase() ?? '?'
}

function formatPillClass(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    epub: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    pdf: 'bg-red-500/15 text-red-600 dark:text-red-400',
    mobi: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    azw3: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    cbz: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    cbr: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    cb7: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    fb2: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  }
  return map[ext] ?? 'bg-muted text-muted-foreground'
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4">
      <div class="absolute inset-0 bg-scrim" @click="handleClose" />

      <div
        class="relative flex flex-col w-full max-w-2xl bg-background rounded-lg shadow-2xl border border-border overflow-hidden"
        style="max-height: min(92vh, 760px)"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-foreground">{{ headerTitle }}</span>
            <span
              v-if="hasFiles"
              class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary/15 text-primary text-xs font-semibold tabular-nums"
            >
              {{ files.length }}
            </span>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="handleClose"
          >
            <X :size="15" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <BookDestinationFields
            :destination="destination"
            :library-label="t('library.upload.library')"
            :folder-label="t('library.upload.targetFolder')"
            :scoped="libraryId !== undefined"
          />

          <fieldset v-if="dockTarget" class="min-w-0" data-testid="library-upload-mode">
            <legend class="mb-2 flex w-full items-baseline justify-between gap-3 text-xs font-medium text-muted-foreground">
              <span>{{ t('library.upload.dock.howToAdd') }}</span>
              <span class="font-normal">{{ t('library.upload.dock.remembered', { library: dockTarget.libraryName }) }}</span>
            </legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="mode-choice">
                <input v-model="mode" type="radio" value="review" class="sr-only" data-testid="library-upload-mode-review" />
                <span class="flex items-center gap-2 text-sm font-medium text-foreground">
                  <PackageOpen class="size-4 text-primary" aria-hidden="true" />
                  {{ t('library.upload.dock.review') }}
                </span>
                <span class="text-xs text-muted-foreground">{{ t('library.upload.dock.reviewHint', { library: dockTarget.libraryName }) }}</span>
              </label>
              <label class="mode-choice">
                <input v-model="mode" type="radio" value="now" class="sr-only" data-testid="library-upload-mode-now" />
                <span class="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCheck class="size-4 text-primary" aria-hidden="true" />
                  {{ t('library.upload.dock.fileNow') }}
                </span>
                <span class="text-xs text-muted-foreground">{{ t('library.upload.dock.fileNowHint', { library: dockTarget.libraryName }) }}</span>
              </label>
            </div>
          </fieldset>

          <!-- Shared file input -->
          <input ref="fileInputRef" type="file" multiple :accept="SUPPORTED_FORMATS_ACCEPT" class="sr-only" @change="onFileInputChange" />

          <!-- Full dropzone (no files queued yet) -->
          <div
            v-if="!hasFiles"
            class="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer"
            :class="isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80 hover:bg-muted/30'"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="openFilePicker"
          >
            <div class="flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10">
              <FileUp :size="20" class="text-primary" />
            </div>
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('library.upload.dropzone.title') }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">
                {{ t('library.upload.dropzone.hint', { formats: SUPPORTED_FORMATS.join(', '), size: maxUploadSizeMb }) }}
              </p>
            </div>
          </div>

          <!-- Compact strip (files queued) -->
          <div
            v-else
            class="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-2.5 px-4 transition-colors cursor-pointer text-xs font-medium"
            :class="
              isDragging
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/30'
            "
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="openFilePicker"
          >
            <Plus :size="13" />
            {{ t('library.upload.addMoreFiles') }}
          </div>

          <!-- File list -->
          <div v-if="hasFiles" class="flex flex-col gap-2">
            <!-- Summary line -->
            <div v-if="fileSummary" class="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              <span class="font-medium text-foreground tabular-nums">{{ t('library.upload.fileCount', { count: fileSummary.total }) }}</span>
              <span>·</span>
              <span>{{ formatBytes(fileSummary.totalBytes) }}</span>
              <span>·</span>
              <span>{{ fileSummary.formatParts.join(', ') }}</span>
              <div class="flex-1" />
              <button v-if="!isUploading" class="hover:text-foreground transition-colors" @click="reset">{{ t('library.upload.clearAll') }}</button>
            </div>

            <TransitionGroup name="file-row" tag="div" class="relative flex flex-col gap-1">
              <div
                v-for="item in files"
                :key="item.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
                :class="fileRowClass(item.status)"
              >
                <!-- Status icon -->
                <div class="shrink-0">
                  <Loader2 v-if="item.status === 'uploading'" :size="16" class="text-primary animate-spin" />
                  <CheckCircle2 v-else-if="item.status === 'done'" :size="16" class="text-emerald-500" />
                  <XCircle v-else-if="item.status === 'error'" :size="16" class="text-destructive" />
                  <div v-else class="w-4 h-4 rounded-full border-2 border-border" />
                </div>

                <!-- File info -->
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-foreground truncate">{{ item.file.name }}</p>
                  <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span class="text-[11px] text-muted-foreground">{{ formatBytes(item.file.size) }}</span>
                    <span class="text-[10px] font-semibold px-1.5 py-px rounded-xs uppercase tracking-wide" :class="formatPillClass(item.file.name)">
                      {{ getFormat(item.file.name) }}
                    </span>
                    <span v-if="item.status === 'error'" class="text-[11px] text-destructive truncate">{{ itemError(item) }}</span>
                    <span v-else-if="item.status === 'uploading'" class="text-[11px] text-primary tabular-nums">{{ item.progress }}%</span>
                    <span v-else-if="item.status === 'done'" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{
                      t('library.upload.done')
                    }}</span>
                  </div>

                  <!-- Progress bar -->
                  <div v-if="item.status === 'uploading'" class="mt-1.5 h-1 rounded-full bg-primary/20 overflow-hidden">
                    <div class="h-full bg-primary rounded-full transition-all duration-150" :style="{ width: `${item.progress}%` }" />
                  </div>
                </div>

                <!-- Actions -->
                <div class="shrink-0 flex items-center gap-0.5">
                  <button
                    v-if="item.status === 'error' && !item.validationError && !item.refusedFormat"
                    class="flex items-center justify-center w-6 h-6 rounded-xs text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    :title="t('library.upload.retry')"
                    @click="retryFile(item.id)"
                  >
                    <RotateCcw :size="11" />
                  </button>
                  <button
                    v-if="item.status !== 'uploading'"
                    class="flex items-center justify-center w-6 h-6 rounded-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="removeFile(item.id)"
                  >
                    <X :size="12" />
                  </button>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>

        <!-- Footer: all succeeded -->
        <div v-if="allSuccess" class="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <CheckCircle2 class="size-4 text-emerald-500 shrink-0" />
            <span class="text-sm font-medium text-foreground">{{
              reviewInDock ? t('library.upload.dock.sent', { count: doneCount }) : t('library.upload.booksAdded', { count: doneCount })
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="handleClose"
            >
              {{ t('common.close') }}
            </button>
            <button
              v-if="reviewInDock"
              class="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              data-testid="library-upload-open-dock"
              @click="goToDock"
            >
              {{ t('library.upload.dock.openDock') }}
            </button>
            <button
              v-else
              class="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              @click="goToLibrary"
            >
              {{ t('library.upload.viewInLibrary') }}
            </button>
          </div>
        </div>

        <!-- Footer: normal / partial error state -->
        <div v-else class="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <span v-if="allDone && errorCount > 0" class="text-xs text-muted-foreground">
            {{ t('library.upload.uploadedFailed', { done: doneCount, failed: errorCount }) }}
          </span>
          <span v-else-if="isUploading" class="text-xs text-muted-foreground tabular-nums">
            {{ t('library.upload.progress', { done: doneCount, total: files.length }) }}
          </span>
          <span v-else-if="refusedCount > 0" class="text-xs text-muted-foreground">
            {{ t('library.upload.dock.refusedCount', { count: refusedCount, library: selectedLibrary?.name ?? '' }) }}
          </span>
          <span v-else class="text-xs text-muted-foreground" />

          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="handleClose"
            >
              {{ allDone ? t('common.close') : t('common.cancel') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="!canUpload"
              @click="handleUpload"
            >
              <PackageOpen v-if="reviewInDock" :size="13" />
              <Upload v-else :size="13" />
              <template v-if="reviewInDock">{{
                pendingCount > 0
                  ? t('library.upload.dock.send', { count: pendingCount, library: dockTarget?.libraryName ?? '' })
                  : t('library.upload.dock.sendEmpty', { library: dockTarget?.libraryName ?? '' })
              }}</template>
              <template v-else>{{
                pendingCount > 0 ? t('library.upload.uploadWithCount', { count: pendingCount }) : t('library.upload.upload')
              }}</template>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mode-choice {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  cursor: pointer;
}
.mode-choice:hover {
  border-color: color-mix(in oklch, var(--primary) 40%, var(--border));
}
.mode-choice:has(input:checked) {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 8%, var(--card));
}
.mode-choice:has(input:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.file-row-enter-active {
  transition: all 0.2s ease;
}
.file-row-leave-active {
  transition: all 0.15s ease;
  position: absolute;
  width: 100%;
}
.file-row-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.file-row-leave-to {
  opacity: 0;
  transform: translateX(6px);
}
.file-row-move {
  transition: transform 0.2s ease;
}
</style>
