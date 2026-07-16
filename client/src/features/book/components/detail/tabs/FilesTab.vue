<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { BookOpen, Download, Eye, FilePlus, Files, Headphones, History, FolderOpen, ArrowUpDown, MoreVertical, Pencil, Trash2 } from '@lucide/vue'
import type { BookDetail, BookDetailFile, WriteLogEntry } from '@bookorbit/types'
import { Permission, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import AddBookFileModal from './AddBookFileModal.vue'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ refetch: [] }>()
const { t } = useI18n()
const router = useRouter()

const { downloadFile: downloadBookFile } = useBookDownload()
const { hasPermission } = usePermissions()

const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])

function isAudioFile(file: BookDetailFile): boolean {
  return !!file.format && AUDIO_FORMATS.has(file.format.toLowerCase())
}

const audioTrackIndex = computed(() => {
  const map = new Map<number, number>()
  let track = 1
  for (const file of props.book.files) {
    if (isAudioFile(file)) {
      map.set(file.id, track++)
    }
  }
  return map
})

const audioTrackCount = computed(() => audioTrackIndex.value.size)

type SortKey = 'name' | 'format' | 'size' | 'date'
type SortDir = 'asc' | 'desc'

const sortOptions = computed<[SortKey, string][]>(() => [
  ['name', t('book.detail.files.sort.name')],
  ['format', t('book.detail.files.sort.format')],
  ['size', t('book.detail.files.sort.size')],
  ['date', t('book.detail.files.sort.date')],
])

const sortKey = ref<SortKey>('name')
const sortDir = ref<SortDir>('asc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const sortedFiles = computed(() => {
  const files = [...props.book.files]
  const dir = sortDir.value === 'asc' ? 1 : -1
  return files.sort((a, b) => {
    switch (sortKey.value) {
      case 'name':
        return dir * (a.filename ?? '').localeCompare(b.filename ?? '')
      case 'format':
        return dir * (a.format ?? '').localeCompare(b.format ?? '')
      case 'size':
        return dir * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
      case 'date':
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    }
  })
})

const fileSummary = computed(() => {
  const formats = new Map<string, number>()
  let totalBytes = 0

  for (const file of props.book.files) {
    if (file.sizeBytes != null) totalBytes += file.sizeBytes
    const format = file.format?.toUpperCase() ?? 'Unknown'
    formats.set(format, (formats.get(format) ?? 0) + 1)
  }

  return {
    totalBytes,
    formats: [...formats.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([format, count]) => (count > 1 ? `${format} × ${count}` : format)),
  }
})
function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(iso: string): string {
  return formatLocaleDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return t('book.detail.files.relative.seconds', { value: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('book.detail.files.relative.minutes', { value: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('book.detail.files.relative.hours', { value: h })
  const d = Math.floor(h / 24)
  return t('book.detail.files.relative.days', { value: d })
}

function openFile(file: BookDetailFile, mode?: 'peek') {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function downloadFile(file: BookDetailFile) {
  void downloadBookFile(file.id)
}

function fileIconStyle(format: string | null): Record<string, string> {
  const color = getFormatColor(format)
  return {
    backgroundColor: `${color}35`,
    color,
  }
}

const showPaths = useLocalStorage('bookDetailShowFilePaths', false)
const writeLogOpen = ref(false)
const writeLog = ref<WriteLogEntry[]>([])
const writeLogLoading = ref(false)

// Modals
const renameFileTarget = ref<BookDetailFile | null>(null)
const renameInput = ref('')
const renaming = ref(false)

const deleteFileTarget = ref<BookDetailFile | null>(null)
const deletingFile = ref(false)

const addFileModalOpen = ref(false)

function handleTogglePaths() {
  showPaths.value = !showPaths.value
}

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

function openRenameModal(file: BookDetailFile) {
  renameFileTarget.value = file
  renameInput.value = file.filename ?? ''
}

function closeRenameModal() {
  if (renaming.value) return
  renameFileTarget.value = null
}

async function submitRename() {
  if (!renameFileTarget.value || renaming.value || !renameInput.value.trim()) return
  renaming.value = true
  try {
    const res = await api(`/api/v1/books/files/${renameFileTarget.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: renameInput.value.trim() }),
    })
    if (!res.ok) throw new Error(t('book.detail.files.renameFailed'))
    renameFileTarget.value = null
    emit('refetch')
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  } finally {
    renaming.value = false
    renameFileTarget.value = null
  }
}

function openDeleteModal(file: BookDetailFile) {
  deleteFileTarget.value = file
}

function closeDeleteModal() {
  if (deletingFile.value) return
  deleteFileTarget.value = null
}

async function confirmDelete() {
  if (!deleteFileTarget.value || deletingFile.value) return
  deletingFile.value = true
  try {
    const res = await api(`/api/v1/books/files/${deleteFileTarget.value.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(t('book.detail.files.deleteFailed'))
    emit('refetch')
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  } finally {
    deletingFile.value = false
    deleteFileTarget.value = null
  }
}

watch(
  () => props.book.id,
  () => {
    writeLogOpen.value = false
    writeLog.value = []
  },
)

async function toggleWriteLog() {
  if (writeLogOpen.value) {
    writeLogOpen.value = false
    return
  }
  writeLogOpen.value = true
  if (writeLog.value.length > 0) return
  writeLogLoading.value = true
  try {
    const res = await api(`/api/v1/books/${props.book.id}/write-log`)
    if (res.ok) {
      const data: { entries: WriteLogEntry[] } = await res.json()
      writeLog.value = data.entries
    }
  } finally {
    writeLogLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-0">
    <section class="flex flex-col gap-3 px-1 pb-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
          <Files class="size-4" />
        </div>
        <div class="min-w-0">
          <h1 class="text-base font-semibold tracking-tight text-foreground">{{ t('book.detail.files.title') }}</h1>
          <p class="truncate text-xs text-muted-foreground">
            {{ t('book.detail.files.fileCount', { count: book.files.length }, book.files.length) }}
            <span class="mx-1 opacity-40">·</span>
            {{ formatBytes(fileSummary.totalBytes) }}
            <template v-if="fileSummary.formats.length"> · {{ fileSummary.formats.join(' · ') }}</template>
            <template v-if="book.lastWrittenAt"> · {{ t('book.detail.files.synced', { time: formatRelative(book.lastWrittenAt) }) }}</template>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="book.lastWrittenAt"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="toggleWriteLog"
        >
          <History class="size-3.5" />
          {{ writeLogOpen ? t('book.detail.files.hideLog') : t('book.detail.files.viewSyncLog') }}
        </button>
        <button
          v-if="hasPermission(Permission.LibraryUpload)"
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="openAddFileModal"
        >
          <FilePlus class="size-3.5" />
          {{ t('book.detail.files.addFile') }}
        </button>
      </div>
    </section>

    <div class="flex flex-col gap-2 border-y border-border/70 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none">
        <ArrowUpDown class="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        <div class="flex shrink-0 items-center rounded-lg bg-muted p-1" role="group" :aria-label="t('book.detail.files.sortAria')">
          <button
            v-for="opt in sortOptions"
            :key="opt[0]"
            class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors"
            :class="sortKey === opt[0] ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'"
            @click="toggleSort(opt[0])"
          >
            {{ opt[1] }}{{ sortKey === opt[0] ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}
          </button>
        </div>
      </div>

      <button
        class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors"
        :class="showPaths ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
        :aria-pressed="showPaths"
        @click="handleTogglePaths"
      >
        <FolderOpen class="size-3.5" />
        {{ showPaths ? t('book.detail.files.hidePaths') : t('book.detail.files.showPaths') }}
      </button>
    </div>

    <section v-if="writeLogOpen" class="border-b border-border/70 px-1 py-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="text-sm font-semibold text-foreground">{{ t('book.detail.files.syncHistory') }}</p>
        <span class="text-xs text-muted-foreground">{{ t('book.detail.files.metadataWriteBack') }}</span>
      </div>
      <p v-if="writeLogLoading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
      <p v-else-if="writeLog.length === 0" class="text-sm text-muted-foreground">{{ t('book.detail.files.noWriteHistory') }}</p>
      <div v-else class="space-y-2">
        <div v-for="entry in writeLog" :key="entry.id" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span
            class="font-medium"
            :class="{
              'text-primary': entry.status === 'success',
              'text-destructive': entry.status === 'failed',
              'text-muted-foreground': entry.status === 'skipped',
            }"
            >{{ entry.status }}</span
          >
          <span class="text-muted-foreground">{{ formatRelative(entry.writtenAt) }}</span>
          <span class="font-mono uppercase text-muted-foreground">{{ entry.format }}</span>
          <span v-if="entry.status === 'failed' && entry.errorMessage" class="min-w-0 flex-1 basis-full truncate text-destructive sm:basis-auto">{{
            entry.errorMessage
          }}</span>
          <span v-else-if="entry.fieldsWritten.length" class="min-w-0 flex-1 basis-full truncate text-muted-foreground sm:basis-auto">{{
            t('book.detail.files.fieldsWritten', { count: entry.fieldsWritten.length }, entry.fieldsWritten.length)
          }}</span>
        </div>
      </div>
    </section>

    <section v-if="sortedFiles.length" class="divide-y divide-border pt-1">
      <div v-for="file in sortedFiles" :key="file.id" class="flex items-center gap-3 px-1 py-3 transition-colors hover:bg-muted/30 sm:px-2">
        <div
          class="relative flex h-10 w-8 shrink-0 items-end justify-center pb-1"
          :style="fileIconStyle(file.format)"
          style="clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); border-radius: 3px 0 3px 3px"
        >
          <div class="absolute right-0 top-0 h-2 w-2 bg-current opacity-25" />
          <div class="absolute left-1 right-1 top-3 flex flex-col gap-[2px]">
            <div class="h-px rounded-full bg-current opacity-20" />
            <div class="h-px w-3/4 rounded-full bg-current opacity-20" />
          </div>
          <span class="text-[8px] font-bold uppercase tracking-wide leading-none">{{ file.format ?? '?' }}</span>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="min-w-0 truncate text-sm font-medium text-foreground">{{ file.filename ?? '-' }}</p>
            <span
              v-if="file.role === 'primary'"
              class="hidden shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary sm:inline"
              >{{ t('book.detail.files.primary') }}</span
            >
            <span
              v-else-if="isAudioFile(file) && audioTrackCount > 1"
              class="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline"
              >{{ t('book.detail.files.track', { number: audioTrackIndex.get(file.id) }) }}</span
            >
          </div>
          <p v-if="showPaths" class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{{ file.absolutePath }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ formatBytes(file.sizeBytes) }}
            <span class="mx-1 opacity-40">·</span>
            {{ formatDate(file.createdAt) }}
            <template v-if="formatDuration(file.durationSeconds)">
              <span class="mx-1 opacity-40">·</span>
              {{ formatDuration(file.durationSeconds) }}
            </template>
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <span v-if="file.role === 'primary'" class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary sm:hidden">{{
            t('book.detail.files.primary')
          }}</span>
          <span
            v-else-if="isAudioFile(file) && audioTrackCount > 1"
            class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:hidden"
            >{{ audioTrackIndex.get(file.id) }}</span
          >

          <div class="hidden items-center gap-1.5 md:flex">
            <button
              v-if="READER_OPENABLE_FORMATS.has(file.format ?? '') && !isAudioFile(file)"
              class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              @click="openFile(file)"
            >
              <BookOpen class="size-3.5" />
              {{ t('book.detail.files.read') }}
            </button>
            <button
              v-if="isAudioFile(file)"
              class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              @click="openFile(file)"
            >
              <Headphones class="size-3.5" />
              {{ t('book.detail.files.play') }}
            </button>
            <Tooltip v-if="hasPermission('library_download')">
              <TooltipTrigger as-child>
                <button
                  class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  @click="downloadFile(file)"
                >
                  <Download class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('book.detail.files.download') }}</TooltipContent>
            </Tooltip>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :title="t('book.detail.files.moreActions')"
              >
                <MoreVertical class="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-if="READER_OPENABLE_FORMATS.has(file.format ?? '') && !isAudioFile(file)" class="md:hidden" @click="openFile(file)">
                <BookOpen class="mr-2 size-4" />
                {{ t('book.detail.files.read') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="isAudioFile(file)" class="md:hidden" @click="openFile(file)">
                <Headphones class="mr-2 size-4" />
                {{ t('book.detail.files.play') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="READER_OPENABLE_FORMATS.has(file.format ?? '')" @click="openFile(file, 'peek')">
                <Eye class="mr-2 size-4" />
                {{ t('book.detail.files.peek') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="hasPermission('library_download')" class="md:hidden" @click="downloadFile(file)">
                <Download class="mr-2 size-4" />
                {{ t('book.detail.files.download') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" @click="openRenameModal(file)">
                <Pencil class="mr-2 size-4" />
                {{ t('book.detail.files.rename') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="hasPermission('library_delete_books')"
                class="text-destructive focus:text-destructive"
                @click="openDeleteModal(file)"
              >
                <Trash2 class="mr-2 size-4" />
                {{ t('common.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </section>

    <section v-else class="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div class="flex size-10 items-center justify-center text-muted-foreground">
        <Files class="size-5" />
      </div>
      <p class="mt-3 text-sm font-semibold text-foreground">{{ t('book.detail.files.empty.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.files.empty.description') }}</p>
      <button
        v-if="hasPermission(Permission.LibraryUpload)"
        class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        @click="openAddFileModal"
      >
        <FilePlus class="size-3.5" />
        {{ t('book.detail.files.addFile') }}
      </button>
    </section>

    <!-- Rename Modal -->
    <div v-if="renameFileTarget" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeRenameModal">
      <button class="absolute inset-0 bg-black/45" @click="closeRenameModal" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('book.detail.files.renameModal.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.files.renameModal.description') }}</p>
        <div class="mt-4">
          <input
            v-model="renameInput"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            :placeholder="t('book.detail.files.renameModal.placeholder')"
            @keyup.enter="submitRename"
          />
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="closeRenameModal"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            :disabled="renaming"
            @click="submitRename"
          >
            {{ renaming ? t('book.detail.files.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Modal -->
    <div v-if="deleteFileTarget" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeDeleteModal">
      <button class="absolute inset-0 bg-black/45" @click="closeDeleteModal" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('book.detail.files.deleteModal.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('book.detail.files.deleteModal.description', { filename: deleteFileTarget.filename }) }}
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="closeDeleteModal"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            :disabled="deletingFile"
            @click="confirmDelete"
          >
            {{ deletingFile ? t('book.detail.files.deleting') : t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <AddBookFileModal v-if="addFileModalOpen" :book-id="book.id" @close="closeAddFileModal" @uploaded="onFilesAdded" />
</template>
