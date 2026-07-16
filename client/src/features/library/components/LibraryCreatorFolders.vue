<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FolderOpen, FolderPlus, Loader2, Plus, RefreshCw, Trash2, XCircle } from '@lucide/vue'
import type { PrescanPathResult, PrescanResult } from '@bookorbit/types'
import { useLibraryFolderSelection } from '../composables/useLibraryFolderSelection'
import FolderPickerModal from './FolderPickerModal.vue'

const { t } = useI18n()

const props = defineProps<{
  folders: string[]
  prescanResult: PrescanResult | null
  prescanLoading: boolean
}>()

const emit = defineEmits<{
  'update:folders': [value: string[]]
  'update:pickerOpen': [value: boolean]
  prescan: []
}>()

const {
  pickerOpen,
  manualEntryOpen,
  manualPath,
  manualError,
  openPicker,
  closePicker,
  addBrowsedFolders,
  removeFolder,
  toggleManualEntry,
  closeManualEntry,
  clearManualError,
  addManualFolder,
} = useLibraryFolderSelection({
  folders: () => props.folders,
  updateFolders: (folders) => emit('update:folders', folders),
  updatePickerOpen: (open) => emit('update:pickerOpen', open),
})

const prescanByPath = computed(() => new Map(props.prescanResult?.paths.map((result) => [result.path, result]) ?? []))

const validationSummary = computed(() => {
  if (props.prescanLoading) return 'Checking accessibility and counting matching book files...'
  if (!props.prescanResult) return 'Verify access and estimate matching book files.'
  const accessibleCount = props.prescanResult.paths.filter((path) => path.accessible).length
  const inaccessibleCount = props.prescanResult.paths.length - accessibleCount
  const files = `${props.prescanResult.totalFiles.toLocaleString()} matching file${props.prescanResult.totalFiles === 1 ? '' : 's'}`
  return inaccessibleCount > 0
    ? `${files}. ${inaccessibleCount} folder${inaccessibleCount === 1 ? '' : 's'} could not be accessed.`
    : `${files} across ${accessibleCount} folder${accessibleCount === 1 ? '' : 's'}.`
})

function prescanStatusFor(path: string): PrescanPathResult | null {
  return prescanByPath.value.get(path) ?? null
}

function statusLabel(path: string): string {
  if (props.prescanLoading) return 'Checking'
  const status = prescanStatusFor(path)
  if (!status) return 'Not checked'
  if (!status.accessible) return 'Not accessible'
  if (status.overlapLibrary) return 'Overlaps another library'
  return `Accessible · ${status.fileCount.toLocaleString()} file${status.fileCount === 1 ? '' : 's'}`
}

function statusClass(path: string): string {
  if (props.prescanLoading || !prescanStatusFor(path)) return 'bg-muted text-muted-foreground'
  const status = prescanStatusFor(path)!
  if (!status.accessible) return 'bg-destructive/10 text-destructive'
  if (status.overlapLibrary) return 'bg-muted text-foreground'
  return 'bg-primary/10 text-primary'
}

function statusTitle(path: string): string | undefined {
  const overlapLibrary = prescanStatusFor(path)?.overlapLibrary
  return overlapLibrary ? `Also used by “${overlapLibrary}”` : undefined
}

function handlePrescan() {
  emit('prescan')
}
</script>

<template>
  <div class="space-y-4 px-6 py-6">
    <button
      v-if="folders.length === 0"
      type="button"
      class="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/15 px-5 py-3 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
      @click="openPicker"
    >
      <span class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FolderOpen :size="19" />
      </span>
      <span>
        <span class="block text-sm font-semibold text-foreground">{{ t('library.creator.folders.browseTitle') }}</span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t('library.creator.folders.browseDescription') }}</span>
      </span>
    </button>

    <section v-else aria-labelledby="selected-folders-title">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <h4 id="selected-folders-title" class="text-sm font-semibold text-foreground">{{ t('library.creator.folders.selectedTitle') }}</h4>
          <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{{ folders.length }}</span>
        </div>
        <button
          type="button"
          class="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          @click="openPicker"
        >
          <Plus :size="16" />
          {{ t('library.creator.folders.addFolders') }}
        </button>
      </div>

      <div class="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
        <div v-for="folder in folders" :key="folder" class="flex min-h-12 items-center gap-2.5 px-3 py-2">
          <FolderOpen :size="16" class="shrink-0 text-primary" />
          <p class="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground" :title="folder">{{ folder }}</p>
          <div class="flex shrink-0 items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="statusClass(folder)" :title="statusTitle(folder)">
              <Loader2 v-if="prescanLoading" :size="11" class="mr-1 inline animate-spin" />
              <XCircle v-else-if="prescanStatusFor(folder) && !prescanStatusFor(folder)!.accessible" :size="11" class="mr-1 inline" />
              <AlertTriangle v-else-if="prescanStatusFor(folder)?.overlapLibrary" :size="11" class="mr-1 inline" />
              <CheckCircle2 v-else-if="prescanStatusFor(folder)?.accessible" :size="11" class="mr-1 inline" />
              {{ statusLabel(folder) }}
            </span>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('library.creator.folders.removeFolder', { folder })"
              @click="removeFolder(folder)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <div>
      <button
        type="button"
        class="flex h-9 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        :aria-expanded="manualEntryOpen"
        @click="toggleManualEntry"
      >
        <FolderPlus :size="16" />
        {{ t('library.creator.folders.manualEntry') }}
        <ChevronUp v-if="manualEntryOpen" :size="15" />
        <ChevronDown v-else :size="15" />
      </button>

      <form v-if="manualEntryOpen" class="mt-2 rounded-lg border border-border bg-muted/20 p-3" @submit.prevent="addManualFolder">
        <label for="manual-folder-path" class="mb-2 block text-sm font-medium text-foreground">{{ t('library.creator.folders.absolutePath') }}</label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            id="manual-folder-path"
            v-model="manualPath"
            type="text"
            :placeholder="t('library.creator.folders.pathPlaceholder')"
            class="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            @input="clearManualError"
          />
          <div class="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="submit"
              class="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {{ t('library.creator.folders.addFolder') }}
            </button>
            <button
              type="button"
              class="h-10 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="closeManualEntry"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
        <p v-if="manualError" class="mt-2 text-sm text-destructive">{{ manualError }}</p>
        <p v-else class="mt-2 text-xs text-muted-foreground">{{ t('library.creator.folders.manualCheckHint') }}</p>
      </form>
    </div>

    <div v-if="folders.length > 0" class="rounded-lg border border-border bg-muted/20 p-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="min-w-0 text-sm text-muted-foreground">{{ validationSummary }}</p>
        <button
          type="button"
          class="flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          :disabled="folders.length === 0 || prescanLoading"
          @click="handlePrescan"
        >
          <RefreshCw :size="16" :class="prescanLoading ? 'animate-spin' : ''" />
          {{ prescanLoading ? 'Checking...' : prescanResult ? 'Check again' : 'Check folders' }}
        </button>
      </div>
    </div>
  </div>

  <FolderPickerModal v-if="pickerOpen" :selected-paths="folders" @select="addBrowsedFolders" @close="closePicker" />
</template>
