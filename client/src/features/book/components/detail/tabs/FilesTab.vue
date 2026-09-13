<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import { FilePlus, Files, X } from '@lucide/vue'
import type { BookDetail } from '@bookorbit/types'
import { Permission } from '@bookorbit/types'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookFileTree, type SortKey, type TreeFile } from '@/features/book/composables/useBookFileTree'
import FilesHeroBar from '../files/FilesHeroBar.vue'
import FileListCard from '../files/FileListCard.vue'
import FileDetailCard from '../files/FileDetailCard.vue'
import WriteBackCard from '../files/WriteBackCard.vue'
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
 * The rail turns into a sheet on the CSS side at 40rem of *tab* width, so the decision to open one
 * has to be measured the same way. A viewport media query disagrees with the stylesheet the moment
 * the sidebar is involved: an 834px tablet still shows it, leaving the tab under 40rem while the
 * viewport is nowhere near a phone, and the rail would have had no way to open at all.
 */
const SHEET_MAX_TAB_WIDTH = 640
const tabRoot = ref<HTMLElement | null>(null)
const { width: tabWidth } = useElementSize(tabRoot)
const isPhone = computed(() => tabWidth.value > 0 && tabWidth.value < SHEET_MAX_TAB_WIDTH)
const sheetOpen = ref(false)
const sheetCloseButton = ref<HTMLButtonElement | null>(null)
/** Where the keyboard was before the sheet took over, so closing it puts focus back. */
let sheetOpener: HTMLElement | null = null

async function openSheet() {
  sheetOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  sheetOpen.value = true
  await nextTick()
  requestAnimationFrame(() => sheetCloseButton.value?.focus())
}

watch(
  () => props.book.id,
  () => {
    sheetOpen.value = false
  },
)
watch(isPhone, (phone) => {
  if (!phone) sheetOpen.value = false
})

const sortOptions = computed<{ key: SortKey; label: string }[]>(() => [
  { key: 'name', label: t('book.detail.files.sort.name') },
  { key: 'format', label: t('book.detail.files.sort.format') },
  { key: 'size', label: t('book.detail.files.sort.size') },
  { key: 'date', label: t('book.detail.files.sortAdded') },
])

const runtimeLabel = computed(() => {
  const seconds = runtimeSeconds.value
  if (seconds == null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  return t('book.detail.files.duration.minutes', { minutes: Math.max(minutes, 1) })
})

const isWriteTarget = computed(() => {
  const format = selectedFile.value?.formatKey
  if (!format) return false
  return (props.book.fileWriteStatus?.writableFormats ?? []).includes(format as never)
})

function handleSort(key: SortKey) {
  toggleSort(key)
}

function handleSelect(id: number) {
  selectFile(id)
  if (isPhone.value) void openSheet()
}

function closeSheet() {
  if (!sheetOpen.value) return
  sheetOpen.value = false
  sheetOpener?.focus()
  sheetOpener = null
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

function goToMetadata() {
  router.push({ name: 'book-detail', params: { bookId: props.book.id }, query: { tab: 'edit' } })
}

const copiedPathFileId = ref<number | null>(null)

async function copyPath(file: TreeFile) {
  if (!(await copyToClipboard(file.absolutePath))) return
  copiedPathFileId.value = file.id
  window.setTimeout(() => {
    if (copiedPathFileId.value === file.id) copiedPathFileId.value = null
  }, 2000)
}

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
    sheetOpen.value = false
    emit('refetch')
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('book.detail.files.deleteFailed')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div ref="tabRoot" class="files-tab flex flex-col gap-3.5 lg:h-full lg:min-h-0">
    <FilesHeroBar
      :book="book"
      :file-count="files.length"
      :total-bytes="totalBytes"
      :runtime-label="runtimeLabel"
      :format-shares="formatShares"
      :folder-segments="folderSegments.relative"
      :can-upload="canUpload"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :sort-options="sortOptions"
      @sort="handleSort"
      @add-file="openAddFileModal"
    />

    <!-- Empty state -->
    <section
      v-if="files.length === 0"
      class="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-16 text-center lg:flex-1"
    >
      <Files class="size-5 text-muted-foreground" aria-hidden="true" />
      <p class="mt-3 text-sm font-semibold">{{ t('book.detail.files.empty.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.files.empty.description') }}</p>
      <button
        v-if="canUpload"
        class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="openAddFileModal"
      >
        <FilePlus class="size-3.5" aria-hidden="true" />
        {{ t('book.detail.files.addFile') }}
      </button>
    </section>

    <div v-else class="files-body relative lg:min-h-0 lg:flex-1">
      <FileListCard
        class="files-list"
        :groups="groups"
        :selected-id="selectedFile?.id ?? null"
        :runtime-label="runtimeLabel"
        :can-download="canDownload"
        :can-edit="canEdit"
        :can-delete="canDelete"
        @select="handleSelect"
        @open="openFile"
        @download="downloadFile"
        @rename="openRenameModal"
        @remove="openDeleteModal"
        @copy-path="copyPath"
      />

      <Teleport to="body" :disabled="!isPhone">
        <button v-if="sheetOpen" class="files-scrim" :aria-label="t('book.detail.files.closeDetails')" @click="closeSheet" />

        <div
          v-if="selectedFile"
          class="files-rail"
          :data-sheet="isPhone ? '1' : '0'"
          :data-open="sheetOpen ? '1' : '0'"
          :role="sheetOpen ? 'dialog' : undefined"
          :aria-modal="sheetOpen ? 'true' : undefined"
          :aria-label="sheetOpen ? t('book.detail.files.fileDetails') : undefined"
          @keydown.esc="closeSheet"
        >
          <div class="sheet-head">
            <span class="sheet-grabber" aria-hidden="true" />
            <button
              ref="sheetCloseButton"
              class="sheet-close inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('book.detail.files.closeDetails')"
              @click="closeSheet"
            >
              <X class="size-4" aria-hidden="true" />
            </button>
          </div>

          <FileDetailCard
            :file="selectedFile"
            :audio-files="audioFiles"
            :is-multi-track-audio="isMultiTrackAudio"
            :runtime-seconds="runtimeSeconds"
            :is-write-target="isWriteTarget"
            :can-download="canDownload"
            :can-edit="canEdit"
            :can-delete="canDelete"
            @open="openFile"
            @download="downloadFile"
            @rename="openRenameModal"
            @remove="openDeleteModal"
            @copy-path="copyPath"
          />

          <WriteBackCard :book="book" :can-edit="canEdit" @edit-metadata="goToMetadata" />
        </div>
      </Teleport>
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

<style scoped>
/*
 * The tab is the container every child measures itself against, so the layout answers "how much
 * room does this pane have", not "how wide is the window". A collapsed sidebar and a wide screen
 * are the same thing to it, and so are an `md` tablet and a phone.
 */
.files-tab {
  container-type: inline-size;
  container-name: filestab;
}

.files-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.875rem;
}

.files-list {
  min-height: 0;
}

.files-rail {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  min-height: 0;
}

.sheet-head {
  display: none;
}

/* Two lanes as soon as the pane can hold a list and a rail without squeezing either. */
@container filestab (min-width: 62.5rem) {
  .files-body {
    grid-template-columns: minmax(0, 1fr) 24rem;
    align-items: start;
    min-height: 0;
  }

  .files-rail {
    overflow-y: auto;
    max-height: 100%;
  }
}

@container filestab (min-width: 75rem) {
  .files-body {
    grid-template-columns: minmax(0, 1fr) 27rem;
  }
}

@container filestab (min-width: 87.5rem) {
  .files-body {
    grid-template-columns: minmax(0, 1fr) 30rem;
  }
}

/* Between those, the rail sits under the list, two cards abreast while they still fit. */
@container filestab (min-width: 45rem) and (max-width: 62.4375rem) {
  .files-rail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
}

/*
 * A phone shows the files; detail arrives over them and gives the screen back. Teleported to the
 * body so "bottom" means the bottom of the screen: anchored to the pane it landed at the foot of a
 * scrolling document, which on a phone is nowhere near what you can see.
 */
.files-scrim {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 60;
  background: oklch(0 0 0 / 45%);
  animation: files-scrim-in 140ms ease-out;
}

.files-rail[data-sheet='1'] {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 61;
  max-height: 78dvh;
  overflow-y: auto;
  border-radius: 1rem 1rem 0 0;
  border: 1px solid var(--border);
  background: var(--card);
  padding: 0.5rem 0.75rem calc(1rem + env(safe-area-inset-bottom));
  box-shadow: var(--elevation-lg);
  transform: translateY(100%);
  visibility: hidden;
  transition:
    transform 180ms ease-out,
    visibility 0s linear 180ms;
}

.files-rail[data-sheet='1'][data-open='1'] {
  transform: translateY(0);
  visibility: visible;
  transition:
    transform 180ms ease-out,
    visibility 0s;
}

.files-rail[data-sheet='1'] .sheet-head {
  display: flex;
  align-items: center;
  padding-bottom: 0.25rem;
}

.files-rail[data-sheet='1'] .sheet-grabber {
  position: absolute;
  inset-inline: 0;
  margin-inline: auto;
  top: 0.5rem;
  width: 2.25rem;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--border);
}

.files-rail[data-sheet='1'] .sheet-close {
  margin-inline-start: auto;
}

/* Inside a sheet the cards are the sheet, so they drop their own frame. */
.files-rail[data-sheet='1'] > section {
  border: 0;
  background: transparent;
}

.files-rail[data-sheet='1'] > section > :first-child,
.files-rail[data-sheet='1'] > section > :last-child {
  padding-inline: 0.25rem;
}

@keyframes files-scrim-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .files-rail,
  .files-scrim {
    transition: none;
    animation: none;
  }
}
</style>
