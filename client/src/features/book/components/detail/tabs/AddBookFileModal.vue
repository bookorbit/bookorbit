<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CheckCircle2, FileUp, Loader2, Plus, Upload, X, XCircle, RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Permission } from '@bookorbit/types'
import { SUPPORTED_FORMATS_ACCEPT, useAddBookFile } from '@/features/book/composables/useAddBookFile'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  bookId: number
}>()

const emit = defineEmits<{
  close: []
  uploaded: []
}>()

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { maxUploadSizeMb } = useAppInfo()

const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const renameAfter = ref(false)

const { files, pendingCount, isUploading, doneCount, errorCount, addFiles, removeFile, retryFile, reset, startUpload } = useAddBookFile()

const canUpload = computed(() => pendingCount.value > 0 && !isUploading.value)
const hasFiles = computed(() => files.value.length > 0)
const allDone = computed(() => hasFiles.value && files.value.every((f) => f.status === 'done' || f.status === 'error'))
const allSuccess = computed(() => allDone.value && errorCount.value === 0)

const headerTitle = computed(() => {
  if (isUploading.value) return t('book.detail.addFile.uploading')
  if (allDone.value) return t('book.detail.addFile.uploadComplete')
  return t('book.detail.addFile.title')
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

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function handleClose() {
  if (doneCount.value > 0) emit('uploaded')
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
  if (pendingCount.value === 0 || isUploading.value) return
  await startUpload(props.bookId, { renameAfter: renameAfter.value })
}

function fileRowClass(status: string): string {
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
    kepub: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    pdf: 'bg-red-500/15 text-red-600 dark:text-red-400',
    mobi: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    azw3: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    cbz: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    cbr: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    cb7: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    fb2: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  }
  return map[ext] ?? 'bg-muted text-muted-foreground/85'
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="handleClose" />

      <div
        class="relative flex flex-col w-full max-w-2xl bg-background rounded-lg shadow-2xl border border-border overflow-hidden"
        style="max-height: min(92vh, 720px)"
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
              <p class="text-sm font-medium text-foreground">{{ t('book.detail.addFile.dropzone.title') }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ t('book.detail.addFile.dropzone.hint', { size: maxUploadSizeMb }) }}</p>
            </div>
          </div>

          <!-- Compact add-more strip (files queued) -->
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
            {{ t('book.detail.addFile.addMore') }}
          </div>

          <!-- File list -->
          <div v-if="hasFiles" class="flex flex-col gap-2">
            <!-- Summary line -->
            <div v-if="fileSummary" class="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              <span class="font-medium text-foreground tabular-nums">{{
                t('book.detail.addFile.fileCount', { count: fileSummary.total }, fileSummary.total)
              }}</span>
              <span>·</span>
              <span>{{ formatBytes(fileSummary.totalBytes) }}</span>
              <span>·</span>
              <span>{{ fileSummary.formatParts.join(', ') }}</span>
              <div class="flex-1" />
              <button v-if="!isUploading" class="hover:text-foreground transition-colors" @click="reset">
                {{ t('book.detail.addFile.clearAll') }}
              </button>
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
                    <span class="text-[10px] font-semibold px-1.5 py-px rounded uppercase tracking-wide" :class="formatPillClass(item.file.name)">
                      {{ getFormat(item.file.name) }}
                    </span>
                    <span v-if="item.status === 'error'" class="text-[11px] text-destructive truncate">{{ item.error }}</span>
                    <span v-else-if="item.status === 'uploading'" class="text-[11px] text-primary tabular-nums">{{ item.progress }}%</span>
                    <span v-else-if="item.status === 'done'" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{
                      t('book.detail.addFile.done')
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
                    v-if="item.status === 'error'"
                    class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground/85 hover:text-primary hover:bg-primary/10 transition-colors"
                    :title="t('book.detail.addFile.retry')"
                    @click="retryFile(item.id)"
                  >
                    <RotateCcw :size="11" />
                  </button>
                  <button
                    v-if="item.status !== 'uploading'"
                    class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
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
            <span class="text-sm font-medium text-foreground">{{ t('book.detail.addFile.filesAdded', { count: doneCount }, doneCount) }}</span>
          </div>
          <button
            class="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="handleClose"
          >
            {{ t('common.close') }}
          </button>
        </div>

        <!-- Footer: normal / partial error state -->
        <div v-else class="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span v-if="allDone && errorCount > 0" class="text-xs text-muted-foreground">{{
              t('book.detail.addFile.uploadedFailed', { done: doneCount, failed: errorCount })
            }}</span>
            <span v-else-if="isUploading" class="text-xs text-muted-foreground tabular-nums">{{
              t('book.detail.addFile.uploadingProgress', { done: doneCount, total: files.length })
            }}</span>
            <label v-else-if="hasPermission(Permission.LibraryEditMetadata)" class="flex items-center gap-2 cursor-pointer select-none">
              <input
                v-model="renameAfter"
                type="checkbox"
                class="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                :disabled="isUploading"
              />
              <span class="text-xs text-muted-foreground">{{ t('book.detail.addFile.renameAfter') }}</span>
            </label>
            <span v-else class="text-xs text-muted-foreground" />
          </div>

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
              <Upload :size="13" />
              {{ pendingCount > 0 ? t('book.detail.addFile.uploadCount', { count: pendingCount }) : t('book.detail.addFile.upload') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
