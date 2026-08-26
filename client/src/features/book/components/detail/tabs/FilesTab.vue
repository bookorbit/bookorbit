<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { ArrowUpDown, CircleCheck, FilePlus, Files, Folder, TriangleAlert } from '@lucide/vue'
import type { BookDetail, WriteLogEntry } from '@bookorbit/types'
import { Permission } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookFileTree, type SortKey, type TreeFile } from '@/features/book/composables/useBookFileTree'
import FileTreeRail from '../files/FileTreeRail.vue'
import FileInspector from '../files/FileInspector.vue'
import AddBookFileModal from './AddBookFileModal.vue'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ refetch: [] }>()

const { t } = useI18n()
const router = useRouter()
const { downloadFile: downloadBookFile } = useBookDownload()
const { hasPermission } = usePermissions()

const book = toRef(props, 'book')
const {
  files,
  groups,
  audioFiles,
  isMultiTrackAudio,
  totalBytes,
  runtimeSeconds,
  formatShares,
  selectedFile,
  siblingFiles,
  startedCount,
  folderSegments,
  sortKey,
  sortDirection,
  selectFile,
  toggleSort,
} = useBookFileTree(book)

const canUpload = computed(() => hasPermission(Permission.LibraryUpload))
const canDownload = computed(() => hasPermission('library_download'))
const canEdit = computed(() => hasPermission('library_edit_metadata'))
const canDelete = computed(() => hasPermission('library_delete_books'))

/**
 * Below lg the two panes cannot sit side by side, so the tab becomes master-detail: the folder
 * first, the inspector in its place once a file is picked, with a back control to return.
 */
const isCompact = useMediaQuery('(max-width: 1023px)')
/**
 * Whether the inspector can hold every section at a fixed height. Width alone is the wrong test:
 * a 1600x900 window is wide enough for the two-pane split and 200px too short for the sections,
 * so it clipped them instead of scrolling.
 */
const paneFitsInspector = useMediaQuery('(min-width: 1536px) and (min-height: 1000px)')
const compactShowsInspector = ref(false)

watch(
  () => props.book.id,
  () => {
    compactShowsInspector.value = false
  },
)

function handleSelect(id: number) {
  selectFile(id)
  compactShowsInspector.value = true
}

function handleBack() {
  compactShowsInspector.value = false
}

const sortOptions = computed<{ key: SortKey; label: string }[]>(() => [
  { key: 'name', label: t('book.detail.files.sort.name') },
  { key: 'format', label: t('book.detail.files.sort.format') },
  { key: 'size', label: t('book.detail.files.sort.size') },
  { key: 'date', label: t('book.detail.files.sortAdded') },
])

const activeSortLabel = computed(() => sortOptions.value.find((option) => option.key === sortKey.value)?.label ?? '')

function handleSort(key: SortKey) {
  toggleSort(key)
}

function formatRuntime(seconds: number | null): string | null {
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  return t('book.detail.files.duration.minutes', { minutes: Math.max(minutes, 1) })
}

function openFile(file: TreeFile, mode?: 'peek') {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function downloadFile(file: TreeFile) {
  void downloadBookFile(file.id)
}

const copiedPathFileId = ref<number | null>(null)

async function copyPath(file: TreeFile) {
  if (!(await copyToClipboard(file.absolutePath))) return
  copiedPathFileId.value = file.id
  window.setTimeout(() => {
    if (copiedPathFileId.value === file.id) copiedPathFileId.value = null
  }, 2000)
}

const writeLog = ref<WriteLogEntry[]>([])

async function loadWriteLog(bookId: number) {
  writeLog.value = []
  if (!props.book.lastWrittenAt) return
  try {
    const response = await api(`/api/v1/books/${bookId}/write-log`)
    if (!response.ok) return
    const data = (await response.json()) as { entries: WriteLogEntry[] }
    if (bookId === props.book.id) writeLog.value = data.entries
  } catch {
    writeLog.value = []
  }
}

watch(() => props.book.id, loadWriteLog, { immediate: true })
watch(
  () => props.book.lastWrittenAt,
  () => loadWriteLog(props.book.id),
)

// Modals
const addFileModalOpen = ref(false)
const renameTarget = ref<TreeFile | null>(null)
const renameInput = ref('')
const renaming = ref(false)
const renameError = ref<string | null>(null)
const deleteTarget = ref<TreeFile | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function openAddFileModal() {
  addFileModalOpen.value = true
}
function closeAddFileModal() {
  addFileModalOpen.value = false
}
function onFilesAdded() {
  addFileModalOpen.value = false
  emit('refetch')
}

function openRenameModal(file: TreeFile) {
  renameTarget.value = file
  renameInput.value = file.leaf
  renameError.value = null
}
function closeRenameModal() {
  if (renaming.value) return
  renameTarget.value = null
}

async function submitRename() {
  const target = renameTarget.value
  if (!target || renaming.value || !renameInput.value.trim()) return
  renaming.value = true
  renameError.value = null
  try {
    const response = await api(`/api/v1/books/files/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: renameInput.value.trim() }),
    })
    if (!response.ok) throw new Error(t('book.detail.files.renameFailed'))
    renameTarget.value = null
    emit('refetch')
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : t('book.detail.files.renameFailed')
  } finally {
    renaming.value = false
  }
}

function openDeleteModal(file: TreeFile) {
  deleteTarget.value = file
  deleteError.value = null
}
function closeDeleteModal() {
  if (deleting.value) return
  deleteTarget.value = null
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    const response = await api(`/api/v1/books/files/${target.id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(t('book.detail.files.deleteFailed'))
    deleteTarget.value = null
    compactShowsInspector.value = false
    emit('refetch')
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('book.detail.files.deleteFailed')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3.5 lg:h-full lg:min-h-0">
    <!-- Command bar -->
    <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <Folder class="hidden size-[15px] shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <nav class="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted-foreground" :aria-label="t('book.detail.files.folderAria')">
        <span class="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] sm:inline" :title="folderSegments.root">{{
          t('book.detail.files.libraryRoot')
        }}</span>
        <template v-for="(segment, index) in folderSegments.relative" :key="`${segment}-${index}`">
          <span class="shrink-0 opacity-40" aria-hidden="true">/</span>
          <span class="min-w-[3ch] truncate" :class="index === folderSegments.relative.length - 1 ? 'font-semibold text-foreground' : ''">{{
            segment
          }}</span>
        </template>
      </nav>

      <div class="flex shrink-0 items-center gap-2">
        <span
          class="inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
          :class="book.status === 'missing' ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'"
        >
          <TriangleAlert v-if="book.status === 'missing'" class="size-2.5" />
          <CircleCheck v-else class="size-2.5" />
          {{ book.status === 'missing' ? t('book.detail.files.missing') : t('book.detail.files.onDisk') }}
        </span>
        <span class="hidden rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground md:inline">{{
          t('book.detail.files.fileCount', { count: files.length })
        }}</span>
        <span class="hidden rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground lg:inline">{{
          formatBytes(totalBytes)
        }}</span>
        <span v-if="runtimeSeconds" class="hidden rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground xl:inline">{{
          formatRuntime(runtimeSeconds)
        }}</span>

        <div class="hidden items-center rounded-lg border border-border xl:flex" role="group" :aria-label="t('book.detail.files.sortAria')">
          <button
            v-for="option in sortOptions"
            :key="option.key"
            class="h-8 border-r border-border px-2.5 text-xs font-semibold transition-colors last:border-r-0 first:rounded-l-[7px] last:rounded-r-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="sortKey === option.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            :aria-pressed="sortKey === option.key"
            @click="handleSort(option.key)"
          >
            {{ option.label }}{{ sortKey === option.key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '' }}
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
              :aria-label="t('book.detail.files.sortAria')"
            >
              <ArrowUpDown class="size-3.5" />
              <span class="hidden sm:inline">{{ activeSortLabel }}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-for="option in sortOptions" :key="option.key" @click="handleSort(option.key)">
              {{ option.label }}{{ sortKey === option.key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '' }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          v-if="canUpload"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="openAddFileModal"
        >
          <FilePlus class="size-3.5" />
          <span class="hidden sm:inline">{{ t('book.detail.files.addFile') }}</span>
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <section
      v-if="files.length === 0"
      class="flex flex-col items-center justify-center lg:flex-1 rounded-xl border border-border bg-card px-4 py-16 text-center"
    >
      <Files class="size-5 text-muted-foreground" aria-hidden="true" />
      <p class="mt-3 text-sm font-semibold">{{ t('book.detail.files.empty.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.files.empty.description') }}</p>
      <button
        v-if="canUpload"
        class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        @click="openAddFileModal"
      >
        <FilePlus class="size-3.5" />
        {{ t('book.detail.files.addFile') }}
      </button>
    </section>

    <!--
      From lg the folder and the inspector sit side by side. The rail is sized in rem rather than a
      fraction so it stays legible as the pane grows, and the inspector takes every pixel left.
    -->
    <div
      v-else
      class="grid grid-cols-1 gap-3.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)] xl:gap-5 2xl:grid-cols-[25rem_minmax(0,1fr)]"
    >
      <FileTreeRail
        v-show="!isCompact || !compactShowsInspector"
        :groups="groups"
        :format-shares="formatShares"
        :folder-name="folderSegments.relative.at(-1) ?? '/'"
        :folder-path="folderSegments.relative.join('/')"
        :total-bytes="totalBytes"
        :selected-id="selectedFile?.id ?? null"
        :file-count="files.length"
        @select="handleSelect"
      />

      <FileInspector
        v-if="selectedFile"
        v-show="!isCompact || compactShowsInspector"
        :book="book"
        :file="selectedFile"
        :siblings="siblingFiles"
        :all-files="files"
        :audio-files="audioFiles"
        :is-multi-track-audio="isMultiTrackAudio"
        :runtime-seconds="runtimeSeconds"
        :started-count="startedCount"
        :file-count="files.length"
        :format-count="formatShares.length"
        :folder-relative="folderSegments.relative"
        :write-log="writeLog"
        :can-download="canDownload"
        :can-edit="canEdit"
        :can-delete="canDelete"
        :show-back="isCompact"
        :fits-without-scroll="paneFitsInspector"
        @select="selectFile"
        @open="openFile"
        @download="downloadFile"
        @rename="openRenameModal"
        @remove="openDeleteModal"
        @copy-path="copyPath"
        @back="handleBack"
      />
    </div>

    <p v-if="copiedPathFileId != null" role="status" class="sr-only">{{ t('book.detail.files.pathCopied') }}</p>

    <!-- Rename -->
    <div v-if="renameTarget" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeRenameModal">
      <button class="absolute inset-0 bg-black/45" :aria-label="t('common.cancel')" @click="closeRenameModal" />
      <div
        class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5"
        role="dialog"
        aria-modal="true"
      >
        <p class="text-base font-semibold">{{ t('book.detail.files.renameModal.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.files.renameModal.description') }}</p>
        <label class="mt-4 block">
          <span class="sr-only">{{ t('book.detail.files.renameModal.placeholder') }}</span>
          <input
            v-model="renameInput"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            :placeholder="t('book.detail.files.renameModal.placeholder')"
            :aria-invalid="renameError ? 'true' : undefined"
            @keyup.enter="submitRename"
          />
        </label>
        <p v-if="renameError" role="alert" class="mt-2 text-xs text-destructive">{{ renameError }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button class="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted" @click="closeRenameModal">
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            :disabled="renaming"
            @click="submitRename"
          >
            {{ renaming ? t('book.detail.files.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete -->
    <div v-if="deleteTarget" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeDeleteModal">
      <button class="absolute inset-0 bg-black/45" :aria-label="t('common.cancel')" @click="closeDeleteModal" />
      <div
        class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5"
        role="dialog"
        aria-modal="true"
      >
        <p class="text-base font-semibold">{{ t('book.detail.files.deleteModal.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('book.detail.files.deleteModal.description', { filename: deleteTarget.leaf }) }}
        </p>
        <p v-if="deleteError" role="alert" class="mt-2 text-xs text-destructive">{{ deleteError }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button class="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted" @click="closeDeleteModal">
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? t('book.detail.files.deleting') : t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <AddBookFileModal v-if="addFileModalOpen" :book-id="book.id" @close="closeAddFileModal" @uploaded="onFilesAdded" />
</template>
