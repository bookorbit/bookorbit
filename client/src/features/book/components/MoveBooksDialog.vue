<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderInput, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { useLibraries } from '@/features/library/composables/useLibraries'

const props = defineProps<{
  open: boolean
  count: number
  currentLibraryId?: number | null
  moving?: boolean
}>()
const emit = defineEmits<{ confirm: [libraryId: number, folderId: number | undefined]; cancel: [] }>()

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()

const selectedLibraryId = ref<number | null>(null)
const selectedFolderId = ref<number | null>(null)

// Libraries without folders cannot receive files; confirming one is a
// guaranteed 400 out of the target folder resolution.
const targetLibraries = computed(() => libraries.value.filter((library) => library.id !== props.currentLibraryId && library.folders.length > 0))
const selectedLibrary = computed(() => targetLibraries.value.find((library) => library.id === selectedLibraryId.value) ?? null)
const needsFolderChoice = computed(() => (selectedLibrary.value?.folders.length ?? 0) > 1)
const canConfirm = computed(() => {
  if (props.moving) return false
  if (!selectedLibrary.value) return false
  return !needsFolderChoice.value || selectedFolderId.value !== null
})

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

function handleOpenChange(open: boolean) {
  if (!open && !props.moving) emit('cancel')
}

function onLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  selectedLibraryId.value = value ? Number(value) : null
}

function onFolderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  selectedFolderId.value = value ? Number(value) : null
}

function onCancel() {
  if (props.moving) return
  emit('cancel')
}

function onConfirm() {
  if (!canConfirm.value || selectedLibraryId.value === null) return
  emit('confirm', selectedLibraryId.value, needsFolderChoice.value ? (selectedFolderId.value ?? undefined) : undefined)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-4">
          <div class="shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <FolderInput class="text-primary" :size="18" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-base font-semibold text-foreground">{{ t('book.moveDialog.title', { count }) }}</DialogTitle>
            <DialogDescription class="text-sm text-muted-foreground mt-1">
              {{ t('book.moveDialog.description') }}
            </DialogDescription>
          </div>
        </div>

        <div class="space-y-3 mt-5">
          <label class="block">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{{ t('book.moveDialog.targetLibrary') }}</span>
            <select data-testid="move-library-select" :value="selectedLibraryId ?? ''" class="select-field w-full mt-1" @change="onLibraryChange">
              <option value="" disabled>{{ t('book.moveDialog.selectLibrary') }}</option>
              <option v-for="library in targetLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
            </select>
          </label>

          <label v-if="needsFolderChoice" class="block">
            <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{{ t('book.moveDialog.targetFolder') }}</span>
            <select data-testid="move-folder-select" :value="selectedFolderId ?? ''" class="select-field w-full mt-1" @change="onFolderChange">
              <option value="" disabled>{{ t('book.moveDialog.selectFolder') }}</option>
              <option v-for="folder in selectedLibrary?.folders ?? []" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </select>
          </label>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <Button data-testid="move-cancel" variant="outline" :disabled="moving" @click="onCancel">
            {{ t('common.cancel') }}
          </Button>
          <Button data-testid="move-confirm" :disabled="!canConfirm" @click="onConfirm">
            <Loader2 v-if="moving" class="animate-spin" :size="16" aria-hidden="true" />
            {{ t('book.moveDialog.move') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
