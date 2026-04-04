<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { BookOpen, FileText, Wand2, Pencil, X, ArrowRight } from 'lucide-vue-next'
import type { BookBucketFile, BookBucketMetadata } from '@projectx/types'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
} from 'reka-ui'
import { formatBytes } from '@/lib/formatting'
import BookBucketStatusBadge from './BookBucketStatusBadge.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLibraries } from '@/features/library/composables/useLibraries'

const props = withDefaults(
  defineProps<{
    items: BookBucketFile[]
    loading: boolean
    initialized: boolean
    isSelected: (id: number) => boolean
    selectAll: boolean
    namePreviewByFileId?: Record<number, string>
    emptyMessage?: string
  }>(),
  {
    namePreviewByFileId: () => ({}),
    emptyMessage: 'Upload files or drop them in the Book Bucket folder',
  },
)

defineEmits<{
  select: [number]
  selectAll: []
  open: [BookBucketFile]
  applyFetched: [number]
}>()

function backendCoverUrl(file: BookBucketFile): string {
  return `/api/v1/book-bucket/files/${file.id}/cover?v=${new Date(file.updatedAt).getTime()}`
}

function selectedCoverUrl(file: BookBucketFile): string | null {
  const url = file.selectedMetadata?.coverUrl?.trim()
  return url ? url : null
}

function newCoverUrl(file: BookBucketFile): string | null {
  const selected = selectedCoverUrl(file)
  if (selected) return selected
  const fetched = file.fetchedMetadata?.coverUrl?.trim()
  return fetched ? fetched : null
}

function currentCoverUrl(file: BookBucketFile): string {
  return backendCoverUrl(file)
}

function onCurrentCoverError(event: Event) {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
}

function onFetchedCoverError(event: Event) {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
}

function currentCoverLightboxFallback(): null {
  return null
}

const coverLightbox = ref<{ src: string; fallback: string | null; title: string } | null>(null)

function openCoverLightbox(src: string, title: string, fallback: string | null = null) {
  coverLightbox.value = { src, fallback, title }
}

function closeCoverLightbox() {
  coverLightbox.value = null
}

function onLightboxOpenChange(open: boolean) {
  if (!open) closeCoverLightbox()
}

function onLightboxCoverError(event: Event) {
  const img = event.target as HTMLImageElement
  const fallback = coverLightbox.value?.fallback
  if (fallback) {
    const currentSrc = img.currentSrc || img.src
    const resolvedFallback = new URL(fallback, window.location.origin).href
    if (currentSrc !== resolvedFallback) {
      img.src = fallback
      return
    }
  }
  img.style.display = 'none'
}

function displayTitle(file: BookBucketFile): string {
  const meta = file.selectedMetadata ?? file.embeddedMetadata
  return meta?.title ?? file.fileName
}

function displayAuthor(file: BookBucketFile): string {
  const meta = file.selectedMetadata ?? file.embeddedMetadata
  return meta?.authors?.join(', ') ?? ''
}

function hasContent(m: BookBucketMetadata | null): boolean {
  if (!m) return false
  return Object.values(m).some((v) => v !== undefined && v !== null && v !== '')
}

type MetadataState = 'edited' | 'fetched' | 'embedded' | 'none'

function metadataState(file: BookBucketFile): MetadataState {
  if (hasContent(file.selectedMetadata)) return 'edited'
  if (hasContent(file.fetchedMetadata)) return 'fetched'
  if (hasContent(file.embeddedMetadata)) return 'embedded'
  return 'none'
}

function confidenceBadgeClass(file: BookBucketFile): string {
  const c = file.confidence
  if (c === null || c === undefined) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  if (c >= 80) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  if (c >= 50) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return 'bg-red-500/15 text-red-600 dark:text-red-400'
}

const { libraries, fetchLibraries } = useLibraries()

onMounted(() => {
  void fetchLibraries()
})

function statusBorderClass(file: BookBucketFile): string {
  switch (file.status) {
    case 'pending':
      return 'border-l-2 border-l-amber-500/50'
    case 'extracting':
    case 'fetching':
      return 'border-l-2 border-l-blue-500/50'
    case 'ready':
      return 'border-l-2 border-l-emerald-500/50'
    case 'error':
      return 'border-l-2 border-l-red-500/50'
    default:
      return 'border-l-2 border-l-transparent'
  }
}

function isTargetUnassigned(file: BookBucketFile): boolean {
  return file.targetLibraryId == null || file.targetFolderId == null
}

function joinTargetPath(folderPath: string, fileName: string): string {
  const base = folderPath.replace(/[\\/]+$/, '')
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base}${separator}${fileName}`
}

function targetSummary(file: BookBucketFile): string {
  const lib = file.targetLibraryId != null ? libraries.value.find((l) => l.id === file.targetLibraryId) : null
  const folder = file.targetFolderId != null ? lib?.folders.find((f) => f.id === file.targetFolderId) : null
  const libLabel = lib?.name ?? (file.targetLibraryId != null ? 'Unknown library' : 'Unassigned')
  const previewName = props.namePreviewByFileId?.[file.id] ?? file.fileName

  if (lib && folder?.path) {
    return `Target: ${libLabel} · ${joinTargetPath(folder.path, previewName)}`
  }

  if (file.targetLibraryId == null || file.targetFolderId == null) {
    return 'Target: Unassigned'
  }

  return `Target: ${libLabel} · Unknown destination path`
}
</script>

<template>
  <div class="rounded-xl border border-border bg-card overflow-hidden">
    <div v-if="!initialized && loading && !items.length" data-test="book-bucket-loading-skeleton" class="divide-y divide-border">
      <div v-for="n in 5" :key="n" class="flex items-center gap-3 px-4 py-3 animate-pulse">
        <div class="size-4 rounded bg-muted" />
        <div class="size-10 rounded-lg bg-muted shrink-0" />
        <div class="flex-1 space-y-1.5">
          <div class="h-3 bg-muted rounded w-3/4" />
          <div class="h-2.5 bg-muted rounded w-1/2" />
        </div>
        <div class="h-5 w-12 bg-muted rounded-full" />
      </div>
    </div>

    <div v-else-if="items.length === 0" data-test="book-bucket-empty-state" class="py-16 flex flex-col items-center gap-3 text-muted-foreground">
      <div class="size-12 rounded-full bg-muted flex items-center justify-center">
        <FileText class="size-6" />
      </div>
      <p class="text-sm font-medium text-foreground">No files in Book Bucket</p>
      <p class="text-xs">{{ emptyMessage }}</p>
    </div>

    <div v-else class="divide-y divide-border">
      <div class="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border">
        <input type="checkbox" :checked="selectAll" class="size-3.5 rounded border-input accent-primary" @change="$emit('selectAll')" />
        <span class="text-xs font-medium text-muted-foreground w-12 text-center shrink-0">Current</span>
        <span class="text-xs font-medium text-muted-foreground w-12 text-center shrink-0">New</span>
        <span class="text-xs font-medium text-muted-foreground flex-1">File</span>
        <span class="text-xs font-medium text-muted-foreground w-16 text-right hidden sm:block">Size</span>
        <span class="text-xs font-medium text-muted-foreground w-12 text-center hidden sm:block">Format</span>
        <span class="text-xs font-medium text-muted-foreground w-14 text-center hidden sm:block">Match</span>
        <span class="text-xs font-medium text-muted-foreground w-7 text-center hidden sm:block">Apply</span>
        <span class="text-xs font-medium text-muted-foreground w-16 text-center">Status</span>
      </div>

      <button
        v-for="file in items"
        :key="file.id"
        class="group flex items-stretch gap-3 px-4 w-full text-left hover:bg-muted/70 transition-colors cursor-pointer"
        :class="statusBorderClass(file)"
        @click="$emit('open', file)"
      >
        <input
          type="checkbox"
          :checked="isSelected(file.id)"
          class="size-3.5 rounded border-input accent-primary shrink-0 self-center"
          @click.stop
          @change.stop="$emit('select', file.id)"
        />

        <HoverCardRoot :open-delay="250" :close-delay="100">
          <HoverCardTrigger as-child>
            <div class="flex items-center gap-1 self-center py-1.5">
              <div class="w-12 shrink-0 flex justify-center">
                <div
                  class="relative w-8 h-12 rounded-md bg-muted flex items-center justify-center overflow-hidden cursor-zoom-in ring-1 ring-border"
                  @click.stop="openCoverLightbox(currentCoverUrl(file), `${displayTitle(file)} current cover`, currentCoverLightboxFallback())"
                >
                  <img
                    :src="currentCoverUrl(file)"
                    alt=""
                    class="size-full object-cover"
                    @load="($event.target as HTMLImageElement).style.display = ''"
                    @error="onCurrentCoverError"
                  />
                  <BookOpen class="size-4 text-muted-foreground absolute" />
                </div>
              </div>

              <div class="w-12 shrink-0 flex justify-center">
                <div
                  v-if="newCoverUrl(file)"
                  class="relative w-8 h-12 rounded-md bg-amber-500/5 border border-amber-500/30 flex items-center justify-center overflow-hidden cursor-zoom-in"
                  @click.stop="openCoverLightbox(newCoverUrl(file)!, `${displayTitle(file)} new cover`)"
                >
                  <img
                    :src="newCoverUrl(file)!"
                    alt=""
                    class="size-full object-cover"
                    @load="($event.target as HTMLImageElement).style.display = ''"
                    @error="onFetchedCoverError"
                  />
                  <span
                    v-if="metadataState(file) === 'edited'"
                    class="absolute bottom-0.5 right-0.5 flex items-center justify-center size-3.5 rounded-full bg-emerald-500 text-white"
                  >
                    <Pencil class="size-2" />
                  </span>
                  <span v-else class="absolute bottom-0.5 right-0.5 flex items-center justify-center size-3.5 rounded-full bg-amber-500 text-white">
                    <Wand2 class="size-2" />
                  </span>
                </div>
                <div v-else class="relative w-8 h-12 rounded-md border border-dashed border-border/70 bg-muted/30 flex items-center justify-center">
                  <span
                    v-if="metadataState(file) === 'fetched'"
                    class="flex items-center justify-center size-3.5 rounded-full bg-amber-500 text-white"
                  >
                    <Wand2 class="size-2" />
                  </span>
                  <span
                    v-else-if="metadataState(file) === 'edited'"
                    class="flex items-center justify-center size-3.5 rounded-full bg-emerald-500 text-white"
                  >
                    <Pencil class="size-2" />
                  </span>
                </div>
              </div>
            </div>
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent side="top" align="start" :side-offset="8" class="z-50 rounded-xl border border-border bg-popover p-3 shadow-xl">
              <div class="flex items-center gap-3">
                <div class="flex flex-col items-center gap-1.5">
                  <div class="relative w-36 h-54 rounded-lg bg-muted overflow-hidden ring-1 ring-border flex items-center justify-center">
                    <img :src="currentCoverUrl(file)" alt="" class="size-full object-cover" @error="onCurrentCoverError" />
                    <BookOpen class="size-5 text-muted-foreground absolute" />
                  </div>
                  <span class="text-[10px] font-medium text-muted-foreground">Current</span>
                </div>
                <template v-if="newCoverUrl(file)">
                  <ArrowRight class="size-4 text-muted-foreground shrink-0" />
                  <div class="flex flex-col items-center gap-1.5">
                    <div
                      class="relative w-36 h-54 rounded-lg bg-amber-500/5 border border-amber-500/30 overflow-hidden flex items-center justify-center"
                    >
                      <img :src="newCoverUrl(file)!" alt="" class="size-full object-cover" @error="onFetchedCoverError" />
                    </div>
                    <span class="text-[10px] font-medium text-amber-600 dark:text-amber-400">New</span>
                  </div>
                </template>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCardRoot>

        <div class="flex-1 flex items-center gap-3 py-2 min-w-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ displayTitle(file) }}</p>
            <div class="flex items-center gap-1.5 min-w-0">
              <p v-if="displayAuthor(file)" class="text-xs text-muted-foreground truncate">{{ displayAuthor(file) }}</p>
              <p v-else class="text-xs text-muted-foreground truncate">{{ file.fileName }}</p>
            </div>
            <p class="mt-0.5 text-[11px] truncate" :class="isTargetUnassigned(file) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">
              {{ targetSummary(file) }}
            </p>
          </div>

          <span class="text-xs text-muted-foreground w-16 text-right shrink-0 hidden sm:block tabular-nums">
            {{ formatBytes(file.fileSize) }}
          </span>

          <span class="text-xs text-muted-foreground w-12 text-center shrink-0 uppercase hidden sm:block">
            {{ file.format ?? '-' }}
          </span>

          <div class="w-14 flex justify-center shrink-0 hidden sm:flex">
            <span
              v-if="file.confidence !== null && file.confidence !== undefined"
              class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              :class="confidenceBadgeClass(file)"
            >
              {{ file.confidence }}%
            </span>
            <span v-else class="text-xs text-muted-foreground/60">-</span>
          </div>

          <div class="w-7 flex justify-center shrink-0">
            <Tooltip v-if="file.fetchedMetadata">
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center size-6 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
                  @click.stop="$emit('applyFetched', file.id)"
                >
                  <Wand2 class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Apply fetched metadata</TooltipContent>
            </Tooltip>
          </div>

          <div class="w-16 flex justify-center shrink-0">
            <BookBucketStatusBadge :status="file.status" />
          </div>
        </div>
      </button>
    </div>

    <DialogRoot :open="!!coverLightbox" @update:open="onLightboxOpenChange">
      <DialogPortal>
        <DialogOverlay
          class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogTitle class="sr-only">{{ coverLightbox?.title ?? 'Cover preview' }}</DialogTitle>
          <DialogDescription class="sr-only">Enlarged cover image preview dialog.</DialogDescription>
          <img
            v-if="coverLightbox"
            :src="coverLightbox.src"
            :alt="coverLightbox.title"
            class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain"
            @error="onLightboxCoverError"
          />
          <DialogClose
            class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X class="size-4" />
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
