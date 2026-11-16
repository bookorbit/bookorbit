<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderSearch } from '@lucide/vue'
import type { LibraryDockAdminEntry, LibraryDockUnrecognisedFolder } from '@bookorbit/types'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { adoptLibraryDockFolder, updateLibraryDock } from '../api/book-dock.api'
import { libraryDockErrorMessage } from '../lib/library-dock-error'

const props = defineProps<{
  entry: LibraryDockAdminEntry
  /** A folder already in `_libraries` whose name matches this library; the dock takes it over. */
  matchingFolder: LibraryDockUnrecognisedFolder | null
}>()

const emit = defineEmits<{ done: []; cancel: [] }>()

const { t } = useI18n()

const folderName = ref('')
const targetFolderId = ref<number | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.entry,
  (entry) => {
    folderName.value = props.matchingFolder?.name ?? entry.suggestedFolderName ?? entry.libraryName
    targetFolderId.value = entry.folders[0]?.id ?? null
    error.value = null
  },
  { immediate: true },
)

const adopting = computed(() => props.matchingFolder !== null && folderName.value.trim() === props.matchingFolder.name)
const canTurnOn = computed(() => folderName.value.trim().length > 0 && targetFolderId.value !== null)

async function turnOn() {
  if (!canTurnOn.value || busy.value) return
  busy.value = true
  error.value = null
  const name = folderName.value.trim()
  let result = adopting.value
    ? await adoptLibraryDockFolder(name, props.entry.libraryId)
    : await updateLibraryDock(props.entry.libraryId, {
        enabled: true,
        folderName: name,
        ...(targetFolderId.value === null ? {} : { targetFolderId: targetFolderId.value }),
      })
  // An adopted folder files into the library's first folder until told otherwise.
  if (result.ok && adopting.value && targetFolderId.value !== null && result.data.dock?.targetFolderId !== targetFolderId.value) {
    result = await updateLibraryDock(props.entry.libraryId, { targetFolderId: targetFolderId.value })
  }
  busy.value = false
  if (!result.ok) {
    error.value = libraryDockErrorMessage(result.errorCode, t)
    return
  }
  emit('done')
}

function cancel() {
  emit('cancel')
}
</script>

<template>
  <ConfirmDialog
    :open="true"
    :title="t('settings.reader.bookDock.docks.turnOnTitle', { library: props.entry.libraryName })"
    :description="t('settings.reader.bookDock.docks.turnOnDescription', { library: props.entry.libraryName })"
    :confirm-label="t('bookDock.strip.turnOn')"
    :destructive="false"
    :busy="busy"
    :confirm-disabled="!canTurnOn"
    data-testid="library-dock-turn-on-dialog"
    @confirm="turnOn"
    @cancel="cancel"
  >
    <div class="mt-4 grid gap-4">
      <div v-if="props.matchingFolder" class="flex gap-2.5 rounded-lg border border-sky-500/35 bg-sky-500/7 p-3 text-[13px] text-foreground">
        <FolderSearch class="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <span>{{ t('settings.reader.bookDock.docks.turnOnExisting', { folder: props.matchingFolder.name }) }}</span>
      </div>
      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.folder') }}</span>
        <span class="flex h-9 items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
          <span class="flex h-full items-center border-e border-input bg-muted px-2.5 font-mono text-xs text-muted-foreground">_libraries/</span>
          <input
            v-model="folderName"
            data-testid="library-dock-turn-on-folder"
            spellcheck="false"
            maxlength="255"
            class="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-foreground outline-none"
          />
        </span>
        <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.folderCaseHint') }}</span>
      </label>
      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.filesInto') }}</span>
        <select v-model="targetFolderId" class="select-field w-full">
          <option v-for="folder in props.entry.folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
        </select>
      </label>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    </div>
  </ConfirmDialog>
</template>
