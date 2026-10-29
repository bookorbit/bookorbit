<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderPlus } from '@lucide/vue'
import { leafName } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import type { TreeRow } from '../../composables/folder-picker/useFolderPickerTree'
import PickerKbd from './PickerKbd.vue'

const props = defineProps<{ row: TreeRow }>()

const { t } = useI18n()
const picker = useFolderPickerContext()
const input = ref<HTMLInputElement | null>(null)
const { name, error, busy } = picker.newFolder

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    void picker.submitNewFolder()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    picker.cancelNewFolder()
  }
}

function onCreate() {
  void picker.submitNewFolder()
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="flex items-center gap-1.5 rounded-md bg-primary/8 py-1 pe-2 ps-1.5" :class="picker.phone.value ? 'h-11' : 'h-8'">
    <span
      v-for="level in row.depth"
      :key="level"
      class="relative w-[18px] shrink-0 self-stretch before:absolute before:inset-y-0 before:start-[8px] before:w-px before:bg-border"
      aria-hidden="true"
    />
    <span class="size-5 shrink-0" />
    <FolderPlus :size="15" class="shrink-0 text-primary" aria-hidden="true" />
    <input
      id="folder-picker-new-folder"
      ref="input"
      v-model="name"
      autocomplete="off"
      class="h-6 min-w-0 flex-1 rounded-[5px] border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      :placeholder="t('library.folderBrowser.newFolder.placeholder', { name: leafName(props.row.path) })"
      :aria-label="t('library.folderBrowser.newFolder.inputLabel')"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? 'folder-picker-new-folder-error' : undefined"
      :disabled="busy"
      @keydown="onKeydown"
    />
    <span
      v-if="error"
      id="folder-picker-new-folder-error"
      class="max-w-[45%] shrink-0 truncate text-[11px] text-destructive"
      role="alert"
      :title="error"
      >{{ error }}</span
    >
    <button
      v-else-if="picker.phone.value"
      type="button"
      class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
      :disabled="busy"
      @click="onCreate"
    >
      {{ t('library.folderBrowser.newFolder.create') }}
    </button>
    <i18n-t v-else keypath="library.folderBrowser.newFolder.hint" tag="span" scope="global" class="shrink-0 text-[11px] text-muted-foreground">
      <template #enter><PickerKbd>↵</PickerKbd></template>
      <template #escape
        ><PickerKbd>{{ t('library.folderBrowser.keys.escape') }}</PickerKbd></template
      >
    </i18n-t>
  </div>
</template>
