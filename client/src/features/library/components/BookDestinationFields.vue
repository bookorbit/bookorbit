<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BookDestination } from '../composables/useBookDestination'

const props = defineProps<{
  destination: BookDestination
  libraryLabel: string
  folderLabel: string
  scoped?: boolean
}>()
const emit = defineEmits<{ change: [] }>()
const { t } = useI18n()

function parseId(event: Event): number | null {
  const id = Number((event.target as HTMLSelectElement).value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function onLibraryChange(event: Event): void {
  props.destination.selectLibrary(parseId(event))
  emit('change')
}

function onFolderChange(event: Event): void {
  props.destination.selectFolder(parseId(event))
  emit('change')
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="destination.error.value" class="text-sm text-destructive" role="alert">{{ t('library.destination.loadFailed') }}</p>
    <p v-else-if="!destination.available.value" class="text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="!destination.libraries.value.length" class="text-sm text-muted-foreground" role="status">
      {{ t('library.destination.noLibraries') }}
    </p>
    <template v-else>
      <label v-if="!scoped && (destination.libraries.value.length > 1 || !destination.selectedLibrary.value)" class="block">
        <span class="text-xs font-medium text-muted-foreground">{{ libraryLabel }}</span>
        <select
          class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          :value="destination.selectedLibrary.value ? destination.libraryId.value : ''"
          @change="onLibraryChange"
        >
          <option value="" disabled>{{ t('library.upload.selectLibrary') }}</option>
          <option v-for="library in destination.libraries.value" :key="library.id" :value="library.id">{{ library.name }}</option>
        </select>
      </label>
      <dl v-else-if="destination.selectedLibrary.value" class="space-y-1">
        <dt class="text-xs font-medium text-muted-foreground">{{ libraryLabel }}</dt>
        <dd class="text-sm text-foreground break-words">{{ destination.selectedLibrary.value.name }}</dd>
      </dl>
      <p v-else class="text-sm text-destructive" role="alert">{{ t('library.destination.unavailable') }}</p>

      <template v-if="destination.selectedLibrary.value">
        <p v-if="!destination.folders.value.length" class="text-sm text-muted-foreground" role="status">
          {{ t('library.destination.noFolders') }}
        </p>
        <label v-else-if="destination.folders.value.length > 1 || !destination.selectedFolder.value" class="block">
          <span class="text-xs font-medium text-muted-foreground">{{ folderLabel }}</span>
          <select
            class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            :value="destination.selectedFolder.value ? destination.folderId.value : ''"
            @change="onFolderChange"
          >
            <option value="" disabled>{{ t('library.destination.selectFolder') }}</option>
            <option v-for="folder in destination.folders.value" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select>
        </label>
        <dl v-else class="space-y-1">
          <dt class="text-xs font-medium text-muted-foreground">{{ folderLabel }}</dt>
          <dd class="text-sm text-foreground break-all">{{ destination.selectedFolder.value.path }}</dd>
        </dl>
      </template>
    </template>
  </div>
</template>
