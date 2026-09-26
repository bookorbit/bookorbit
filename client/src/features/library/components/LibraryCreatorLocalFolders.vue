<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FolderHeart, FolderPlus, Plus, Trash2 } from '@lucide/vue'
import { useLibraryFolderSelection } from '../composables/useLibraryFolderSelection'
import FolderPickerModal from './FolderPickerModal.vue'

const { t } = useI18n()

const props = defineProps<{
  localFolders: string[]
}>()

const emit = defineEmits<{
  'update:localFolders': [value: string[]]
  'update:pickerOpen': [value: boolean]
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
  folders: () => props.localFolders,
  updateFolders: (folders) => emit('update:localFolders', folders),
  updatePickerOpen: (open) => emit('update:pickerOpen', open),
})
</script>

<template>
  <section class="space-y-3 px-6 pb-6" aria-labelledby="local-folders-title">
    <div class="flex items-center gap-2">
      <h4 id="local-folders-title" class="text-sm font-semibold text-foreground">{{ t('library.creator.folders.local.title') }}</h4>
      <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {{ localFolders.length > 0 ? localFolders.length : t('library.creator.folders.local.optional') }}
      </span>
    </div>
    <p class="text-sm text-muted-foreground">{{ t('library.creator.folders.local.description') }}</p>

    <button
      v-if="localFolders.length === 0"
      type="button"
      class="flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/15 px-5 py-3 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
      @click="openPicker"
    >
      <span class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FolderHeart :size="19" />
      </span>
      <span>
        <span class="block text-sm font-semibold text-foreground">{{ t('library.creator.folders.local.addTitle') }}</span>
        <span class="mt-1 block text-sm text-muted-foreground">{{ t('library.creator.folders.local.addDescription') }}</span>
      </span>
    </button>

    <template v-else>
      <div class="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
        <div v-for="folder in localFolders" :key="folder" class="flex min-h-12 items-center gap-2.5 px-3 py-2">
          <FolderHeart :size="16" class="shrink-0 text-primary" />
          <p class="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground" :title="folder">{{ folder }}</p>
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :aria-label="t('library.creator.folders.local.remove', { folder })"
            @click="removeFolder(folder)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
      <button
        type="button"
        class="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        @click="openPicker"
      >
        <Plus :size="16" />
        {{ t('library.creator.folders.local.add') }}
      </button>
    </template>

    <div>
      <button
        type="button"
        class="flex h-9 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        :aria-expanded="manualEntryOpen"
        @click="toggleManualEntry"
      >
        <FolderPlus :size="16" />
        {{ t('library.creator.folders.manualEntry') }}
      </button>

      <form v-if="manualEntryOpen" class="mt-2 rounded-lg border border-border bg-muted/20 p-3" @submit.prevent="addManualFolder">
        <label for="manual-local-folder-path" class="mb-2 block text-sm font-medium text-foreground">
          {{ t('library.creator.folders.absolutePath') }}
        </label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            id="manual-local-folder-path"
            v-model="manualPath"
            type="text"
            placeholder="/path/to/existing/podcasts"
            class="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
      </form>
    </div>
  </section>

  <FolderPickerModal v-if="pickerOpen" :selected-paths="localFolders" @select="addBrowsedFolders" @close="closePicker" />
</template>
