<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderInput, Loader2 } from '@lucide/vue'
import { useLibraries } from '@/features/library/composables/useLibraries'

const props = defineProps<{
  open: boolean
  count: number
  currentLibraryId?: number | null
  moving?: boolean
}>()
const emit = defineEmits<{ confirm: [libraryId: number, folderId: number | undefined]; cancel: [] }>()

const { libraries, fetchLibraries } = useLibraries()

const selectedLibraryId = ref<number | null>(null)
const selectedFolderId = ref<number | null>(null)

const targetLibraries = computed(() => libraries.value.filter((library) => library.id !== props.currentLibraryId))
const selectedLibrary = computed(() => targetLibraries.value.find((library) => library.id === selectedLibraryId.value) ?? null)
const needsFolderChoice = computed(() => (selectedLibrary.value?.folders.length ?? 0) > 1)
const canConfirm = computed(() => {
  if (props.moving) return false
  if (!selectedLibrary.value) return false
  return !needsFolderChoice.value || selectedFolderId.value !== null
})

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60'

watch(
  () => props.open,
  (open) => {
    if (open) {
      void fetchLibraries()
      selectedLibraryId.value = null
      selectedFolderId.value = null
    }
  },
  { immediate: true },
)

watch(selectedLibraryId, () => {
  selectedFolderId.value = null
})

function onLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  selectedLibraryId.value = value ? Number(value) : null
}

function onFolderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  selectedFolderId.value = value ? Number(value) : null
}

function onConfirm() {
  if (!canConfirm.value || selectedLibraryId.value === null) return
  emit('confirm', selectedLibraryId.value, needsFolderChoice.value ? (selectedFolderId.value ?? undefined) : undefined)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('cancel')" />
      <div class="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-start gap-4 mb-5">
          <div class="shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <FolderInput class="text-primary" :size="18" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-foreground">Move {{ count }} book{{ count === 1 ? '' : 's' }} to library</h2>
            <p class="text-sm text-muted-foreground mt-1">
              Files are moved into the target library's folder. Reading progress, annotations, and collections stay with the books.
            </p>
          </div>
        </div>

        <div class="space-y-3 mb-5">
          <label class="block">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target library</span>
            <select data-testid="move-library-select" :value="selectedLibraryId ?? ''" :class="[SELECT_CLASS, 'mt-1']" @change="onLibraryChange">
              <option value="" disabled>Select a library…</option>
              <option v-for="library in targetLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
            </select>
          </label>

          <label v-if="needsFolderChoice" class="block">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Target folder</span>
            <select data-testid="move-folder-select" :value="selectedFolderId ?? ''" :class="[SELECT_CLASS, 'mt-1']" @change="onFolderChange">
              <option value="" disabled>Select a folder…</option>
              <option v-for="folder in selectedLibrary?.folders ?? []" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </select>
          </label>
        </div>

        <div class="flex justify-end gap-2">
          <button
            data-testid="move-cancel"
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="moving"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            data-testid="move-confirm"
            class="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            :disabled="!canConfirm"
            @click="onConfirm"
          >
            <Loader2 v-if="moving" class="animate-spin" :size="14" />
            Move
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
