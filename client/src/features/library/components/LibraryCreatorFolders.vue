<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleX, FolderOpen, FolderPlus, FolderSearch, Info, Loader2, Plus, RefreshCw, Trash2, TriangleAlert } from '@lucide/vue'
import type { LibraryStats, LibraryType } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import LibraryFormatBar from '@/features/settings/libraries/components/LibraryFormatBar.vue'
import type { FolderCheck } from '../composables/useLibraryCreator'
import { useLibraryFolderSelection } from '../composables/useLibraryFolderSelection'
import FolderPickerModal from './FolderPickerModal.vue'
import LibraryCreatorCard from './LibraryCreatorCard.vue'
import LibraryCreatorLocalFolders from './LibraryCreatorLocalFolders.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    folders: string[]
    localFolders: string[]
    libraryType: LibraryType
    checks?: Record<string, FolderCheck>
    stats?: LibraryStats | null
  }>(),
  { checks: () => ({}), stats: null },
)

const emit = defineEmits<{
  'update:folders': [value: string[]]
  'update:localFolders': [value: string[]]
  'update:pickerOpen': [value: boolean]
  check: [paths: string[]]
}>()

const {
  pickerOpen,
  manualPath,
  manualError,
  openPicker,
  closePicker,
  addBrowsedFolders: addSelectedFolders,
  removeFolder,
  clearManualError,
  addManualFolder,
} = useLibraryFolderSelection({
  folders: () => props.folders,
  updateFolders: (folders) => emit('update:folders', folders),
  updatePickerOpen: (open) => emit('update:pickerOpen', open),
})

const podcast = computed(() => props.libraryType === 'podcasts')
const canAdd = computed(() => !podcast.value || props.folders.length === 0)
const checkedFolders = computed(() => props.folders.map((folder) => props.checks[folder]).filter((check) => check?.state === 'checked'))
const matchingFiles = computed(() =>
  checkedFolders.value.reduce((sum, check) => sum + (check.state === 'checked' && check.accessible ? check.fileCount : 0), 0),
)
const anyChecking = computed(() => props.folders.some((folder) => props.checks[folder]?.state === 'checking'))
const showStats = computed(() => !podcast.value && props.stats !== null && props.stats.totalBooks > 0)

type FolderStatus =
  | { kind: 'unchecked' }
  | { kind: 'checking' }
  | { kind: 'failed' }
  | { kind: 'inaccessible' }
  | { kind: 'overlap'; library: string }
  | { kind: 'ok'; files: number }

interface FolderRow {
  folder: string
  parent: string
  leaf: string
  status: FolderStatus
}

const rows = computed<FolderRow[]>(() => props.folders.map((folder) => ({ folder, ...splitPath(folder), status: statusOf(props.checks[folder]) })))

function statusOf(check: FolderCheck | undefined): FolderStatus {
  if (!check) return { kind: 'unchecked' }
  if (check.state === 'checking') return { kind: 'checking' }
  if (check.state === 'failed') return { kind: 'failed' }
  if (!check.accessible) return { kind: 'inaccessible' }
  if (check.overlapLibrary) return { kind: 'overlap', library: check.overlapLibrary }
  return { kind: 'ok', files: check.fileCount }
}

function splitPath(path: string): { parent: string; leaf: string } {
  const index = path.lastIndexOf('/')
  if (index < 0) return { parent: '', leaf: path }
  return { parent: path.slice(0, index + 1), leaf: path.slice(index + 1) }
}

function checkAll() {
  emit('check', props.folders)
}

function retry(folder: string) {
  emit('check', [folder])
}

function handleRemove(folder: string) {
  removeFolder(folder)
}

function handleLocalFoldersUpdate(value: string[]) {
  emit('update:localFolders', value)
}

function handleNestedPickerChange(value: boolean) {
  emit('update:pickerOpen', value)
}

function addBrowsedFolders(paths: string[]) {
  addSelectedFolders(podcast.value ? paths.slice(0, 1) : paths)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <LibraryCreatorCard
      flush
      label-id="library-folders-title"
      :label="podcast ? t('library.creator.folders.storageTitle') : t('library.creator.folders.listTitle')"
    >
      <template v-if="folders.length > 0" #meta>
        <template v-if="checkedFolders.length > 0">
          <span>{{ t('library.creator.folders.matchingFiles', { count: matchingFiles }) }}</span>
        </template>
        <template v-else-if="showStats && stats">
          <span>{{ t('library.creator.folders.bookCount', { count: stats.totalBooks }) }}</span>
          <span aria-hidden="true">&middot;</span>
          <span class="tabular-nums">{{ formatBytes(stats.totalSizeBytes) }}</span>
        </template>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          :aria-label="t('library.creator.folders.checkAll')"
          :title="t('library.creator.folders.checkAll')"
          :disabled="anyChecking"
          @click="checkAll"
        >
          <RefreshCw :size="13" :class="anyChecking ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />
        </button>
      </template>

      <ul v-if="rows.length > 0" class="divide-y divide-border border-t border-border" aria-labelledby="library-folders-title">
        <li v-for="row in rows" :key="row.folder" class="flex min-h-12 items-center gap-2.5 px-4 py-2">
          <FolderOpen :size="16" class="shrink-0 text-primary" aria-hidden="true" />
          <p class="flex min-w-0 flex-1 font-mono text-[12.5px]" dir="ltr" :title="row.folder">
            <span class="min-w-0 truncate text-path-dim">{{ row.parent }}</span>
            <span class="max-w-[70%] shrink-0 truncate font-semibold text-foreground">{{ row.leaf }}</span>
          </p>
          <span
            v-if="row.status.kind === 'checking'"
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            <Loader2 :size="11" class="motion-safe:animate-spin" aria-hidden="true" />
            {{ t('library.creator.folders.status.checking') }}
          </span>
          <template v-else-if="row.status.kind === 'failed'">
            <span class="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {{ t('library.creator.folders.status.failed') }}
            </span>
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted"
              :aria-label="t('library.creator.folders.checkAgain', { folder: row.folder })"
              @click="retry(row.folder)"
            >
              <RefreshCw :size="13" aria-hidden="true" />
            </button>
          </template>
          <span
            v-else-if="row.status.kind === 'inaccessible'"
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-xs font-medium text-destructive"
          >
            <CircleX :size="11" aria-hidden="true" />
            {{ t('library.creator.folders.status.notAccessible') }}
          </span>
          <span
            v-else-if="row.status.kind === 'overlap'"
            class="inline-flex max-w-44 shrink-0 items-center gap-1 rounded-full bg-warning/14 px-2 py-0.5 text-xs font-medium text-warning"
            :title="t('library.creator.folders.status.overlapTitle', { library: row.status.library })"
          >
            <TriangleAlert :size="11" class="shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t('library.creator.folders.status.overlap', { library: row.status.library }) }}</span>
          </span>
          <span
            v-else-if="row.status.kind === 'ok'"
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success"
          >
            <CircleCheck :size="11" aria-hidden="true" />
            {{ t('library.creator.folders.status.files', { count: row.status.files }) }}
          </span>
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :aria-label="t('library.creator.folders.removeFolder', { folder: row.folder })"
            @click="handleRemove(row.folder)"
          >
            <Trash2 :size="15" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <div v-else class="border-t border-border px-4 py-6 text-center">
        <span class="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary" aria-hidden="true">
          <FolderOpen :size="18" />
        </span>
        <p class="text-sm font-semibold text-foreground">{{ t('library.creator.folders.noneAdded') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ podcast ? t('library.creator.folders.emptyPodcastHint') : t('library.creator.folders.emptyHint') }}
        </p>
      </div>

      <div v-if="showStats && stats && checkedFolders.length === 0" class="border-t border-border px-4 pb-3 pt-3">
        <LibraryFormatBar show-legend :counts="stats.formatCounts" :legend-limit="6" />
      </div>

      <form
        v-if="canAdd"
        class="flex flex-wrap items-start gap-2 border-t border-border bg-background/50 px-3 py-2.5"
        @submit.prevent="addManualFolder"
      >
        <div class="min-w-0 flex-[1_1_14rem]">
          <label for="manual-folder-path" class="sr-only">{{ t('library.creator.folders.absolutePath') }}</label>
          <div class="relative">
            <FolderPlus :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id="manual-folder-path"
              v-model="manualPath"
              type="text"
              dir="ltr"
              :placeholder="podcast ? t('library.creator.folders.pastePodcastPlaceholder') : t('library.creator.folders.pastePlaceholder')"
              class="h-9 w-full rounded-md border border-input bg-background pe-3 ps-9 font-mono text-[12.5px] text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              :aria-invalid="manualError ? 'true' : undefined"
              :aria-describedby="manualError ? 'manual-folder-error' : undefined"
              @input="clearManualError"
            />
          </div>
          <p v-if="manualError" id="manual-folder-error" class="mt-1.5 text-xs text-destructive" role="alert">{{ manualError }}</p>
        </div>
        <button
          type="submit"
          class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus :size="14" aria-hidden="true" />
          {{ t('library.creator.folders.add') }}
        </button>
        <button
          type="button"
          class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          @click="openPicker"
        >
          <FolderSearch :size="14" aria-hidden="true" />
          {{ t('library.creator.folders.browse') }}
        </button>
      </form>
    </LibraryCreatorCard>

    <p v-if="!podcast" class="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info :size="13" class="mt-px shrink-0" aria-hidden="true" />
      <span>{{ t('library.creator.folders.checkHint') }}</span>
    </p>

    <LibraryCreatorLocalFolders
      v-if="podcast"
      :local-folders="localFolders"
      @update:local-folders="handleLocalFoldersUpdate"
      @update:picker-open="handleNestedPickerChange"
    />
  </div>

  <FolderPickerModal v-if="pickerOpen" :selected-paths="folders" @select="addBrowsedFolders" @close="closePicker" />
</template>
