<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PackageOpen, Upload } from '@lucide/vue'
import type { BookDockFile } from '@bookorbit/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import BookDockFileRow from './BookDockFileRow.vue'
import type { BookDockConflict } from '../composables/useBookDockConflicts'

const props = withDefaults(
  defineProps<{
    items: BookDockFile[]
    loading: boolean
    initialized: boolean
    isSelected: (id: number) => boolean
    conflicts?: Record<number, BookDockConflict>
    namePreviewByFileId?: Record<number, string>
    emptyMessage?: string
  }>(),
  { conflicts: () => ({}), namePreviewByFileId: () => ({}), emptyMessage: undefined },
)

const emit = defineEmits<{
  select: [number, boolean]
  setDestination: [BookDockFile]
  file: [BookDockFile]
  applyFetched: [number]
  open: [BookDockFile]
  discard: [BookDockFile]
  retry: [BookDockFile]
  upload: []
  keyboardActive: [boolean]
}>()

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()

/** Only one row expands at a time, so the resting list is never ragged. */
const expandedId = ref<number | null>(null)
const focusedIndex = ref(-1)
const listEl = ref<HTMLElement | null>(null)

onMounted(() => {
  void fetchLibraries()
})

watch(
  () => props.items.map((file) => file.id).join(','),
  () => {
    focusedIndex.value = -1
  },
)

/** Shown only once keyboard navigation is actually in use, never on hover. */
watch(focusedIndex, (index) => {
  emit('keyboardActive', index >= 0)
})

const libraryNameById = computed(() => new Map(libraries.value.map((library) => [library.id, library.name])))

function libraryNameFor(file: BookDockFile): string | null {
  if (file.targetLibraryId == null) return null
  return libraryNameById.value.get(file.targetLibraryId) ?? null
}

/**
 * Where the file lands, relative to its library root. The name the pattern resolves
 * to already carries any sub-folders, so the folder's absolute path is never joined
 * on: it adds nothing the user can act on and puts the server's filesystem layout
 * on screen.
 */
function targetLabelFor(file: BookDockFile): string {
  const library = file.targetLibraryId != null ? libraries.value.find((entry) => entry.id === file.targetLibraryId) : null
  const folder = file.targetFolderId != null ? library?.folders.find((entry) => entry.id === file.targetFolderId) : null
  const libraryLabel = library?.name ?? (file.targetLibraryId != null ? t('bookDock.fileList.unknownLibrary') : t('bookDock.fileList.unassigned'))
  const relativePath = props.namePreviewByFileId[file.id] ?? file.fileName

  if (library && folder?.path) return t('bookDock.fileList.targetPath', { library: libraryLabel, path: relativePath })
  if (file.targetLibraryId == null || file.targetFolderId == null) return t('bookDock.fileList.targetUnassigned')
  return t('bookDock.fileList.targetUnknownPath', { library: libraryLabel })
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function moveFocus(delta: number) {
  if (!props.items.length) return
  const next = focusedIndex.value < 0 ? 0 : focusedIndex.value + delta
  focusedIndex.value = Math.max(0, Math.min(props.items.length - 1, next))
  const rows = listEl.value?.querySelectorAll<HTMLElement>('.book-dock-row')
  rows?.[focusedIndex.value]?.scrollIntoView({ block: 'nearest' })
}

/**
 * Typing in the inline editors must never be swallowed by the list shortcuts, so
 * keystrokes originating in a field are left alone.
 */
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  const current = props.items[focusedIndex.value]
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault()
      moveFocus(1)
      break
    case 'k':
    case 'ArrowUp':
      event.preventDefault()
      moveFocus(-1)
      break
    case ' ':
      if (!current) return
      event.preventDefault()
      emit('select', current.id, event.shiftKey)
      break
    case 'Enter':
      if (!current) return
      event.preventDefault()
      toggleExpand(current.id)
      break
    case 'Escape':
      if (expandedId.value === null) return
      event.preventDefault()
      expandedId.value = null
      break
    default:
  }
}

function onSelect(id: number, shiftKey: boolean) {
  emit('select', id, shiftKey)
}
function onSetDestination(file: BookDockFile) {
  emit('setDestination', file)
}
function onFile(file: BookDockFile) {
  emit('file', file)
}
function onApplyFetched(id: number) {
  emit('applyFetched', id)
}
function onOpen(file: BookDockFile) {
  emit('open', file)
}
function onDiscard(file: BookDockFile) {
  emit('discard', file)
}
function onRetry(file: BookDockFile) {
  emit('retry', file)
}
function onUpload() {
  emit('upload')
}
</script>

<template>
  <!-- The container query lives here: rows reflow on the list's width, not the viewport's. -->
  <div ref="listEl" class="book-dock-list" tabindex="-1" @keydown="onKeydown">
    <div v-if="!props.initialized && props.loading && !props.items.length" data-test="book-dock-loading-skeleton" class="divide-y divide-border">
      <div v-for="n in 6" :key="n" class="flex animate-pulse items-center gap-3 px-3 py-2.5">
        <div class="size-4 rounded-xs bg-muted" />
        <div class="h-[57px] w-[38px] shrink-0 rounded-xs bg-muted" />
        <div class="flex-1 space-y-1.5">
          <div class="h-3 w-3/5 rounded-xs bg-muted" />
          <div class="h-2.5 w-2/5 rounded-xs bg-muted" />
        </div>
        <div class="h-7 w-24 rounded-lg bg-muted" />
      </div>
    </div>

    <div v-else-if="props.items.length === 0" data-test="book-dock-empty-state" class="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div class="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PackageOpen class="size-6" aria-hidden="true" />
      </div>
      <p class="text-sm font-medium text-foreground">{{ t('bookDock.fileList.emptyTitle') }}</p>
      <p class="max-w-md text-xs text-muted-foreground">{{ props.emptyMessage ?? t('bookDock.fileList.emptyMessageDefault') }}</p>
      <button
        type="button"
        data-testid="book-dock-empty-upload"
        class="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        @click="onUpload"
      >
        <Upload class="size-3.5" aria-hidden="true" />
        {{ t('bookDock.uploadAction') }}
      </button>
      <p class="text-[11px] text-muted-foreground">{{ t('bookDock.layout.empty.dropHint') }}</p>
    </div>

    <template v-else>
      <BookDockFileRow
        v-for="(file, index) in props.items"
        :key="file.id"
        :file="file"
        :selected="props.isSelected(file.id)"
        :expanded="expandedId === file.id"
        :focused="focusedIndex === index"
        :library-name="libraryNameFor(file)"
        :target-label="targetLabelFor(file)"
        :conflict="props.conflicts[file.id]"
        @select="onSelect"
        @toggle-expand="toggleExpand"
        @set-destination="onSetDestination"
        @file="onFile"
        @apply-fetched="onApplyFetched"
        @open="onOpen"
        @discard="onDiscard"
        @retry="onRetry"
      />
    </template>
  </div>
</template>

<style scoped>
.book-dock-list {
  container-type: inline-size;
}

.book-dock-list:focus {
  outline: none;
}
</style>
