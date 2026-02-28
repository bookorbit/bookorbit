<script setup lang="ts">
import { BookOpen, FileText, Wand2, Pencil } from 'lucide-vue-next'
import type { StagingFile, StagingMetadata } from '@projectx/types'
import { formatBytes } from '@/lib/formatting'
import StagingStatusBadge from './StagingStatusBadge.vue'

withDefaults(
  defineProps<{
    items: StagingFile[]
    loading: boolean
    isSelected: (id: number) => boolean
    selectAll: boolean
    emptyMessage?: string
  }>(),
  {
    emptyMessage: 'Upload files or drop them in the staging folder',
  },
)

defineEmits<{
  select: [number]
  selectAll: []
  open: [StagingFile]
  applyFetched: [number]
}>()

function backendCoverUrl(file: StagingFile): string {
  return `/api/v1/staging/files/${file.id}/cover?v=${new Date(file.updatedAt).getTime()}`
}

function coverUrl(file: StagingFile): string {
  return backendCoverUrl(file)
}

function onCoverError(event: Event, file: StagingFile) {
  const img = event.target as HTMLImageElement
  const externalUrl = file.selectedMetadata?.coverUrl ?? file.fetchedMetadata?.coverUrl
  if (img.src.includes('/api/v1/staging/files/') && externalUrl) {
    img.src = externalUrl
  } else {
    img.style.display = 'none'
  }
}

function displayTitle(file: StagingFile): string {
  const meta = file.selectedMetadata ?? file.embeddedMetadata
  return meta?.title ?? file.fileName
}

function displayAuthor(file: StagingFile): string {
  const meta = file.selectedMetadata ?? file.embeddedMetadata
  return meta?.authors?.join(', ') ?? ''
}

function hasContent(m: StagingMetadata | null): boolean {
  if (!m) return false
  return Object.values(m).some((v) => v !== undefined && v !== null && v !== '')
}

type MetadataState = 'edited' | 'fetched' | 'embedded' | 'none'

function metadataState(file: StagingFile): MetadataState {
  if (hasContent(file.selectedMetadata)) return 'edited'
  if (hasContent(file.fetchedMetadata)) return 'fetched'
  if (hasContent(file.embeddedMetadata)) return 'embedded'
  return 'none'
}

function confidenceBadgeClass(file: StagingFile): string {
  const c = file.confidence
  if (c === null || c === undefined) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  if (c >= 80) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  if (c >= 50) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return 'bg-red-500/15 text-red-600 dark:text-red-400'
}
</script>

<template>
  <div class="rounded-xl border border-border bg-card overflow-hidden">
    <div v-if="loading && !items.length" class="divide-y divide-border">
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

    <div v-else-if="items.length === 0" class="py-16 flex flex-col items-center gap-3 text-muted-foreground">
      <div class="size-12 rounded-full bg-muted flex items-center justify-center">
        <FileText class="size-6" />
      </div>
      <p class="text-sm font-medium text-foreground">No staged files</p>
      <p class="text-xs">{{ emptyMessage }}</p>
    </div>

    <div v-else class="divide-y divide-border">
      <div class="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border">
        <input type="checkbox" :checked="selectAll" class="size-3.5 rounded border-input accent-primary" @change="$emit('selectAll')" />
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
        class="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-muted/50 transition-colors cursor-pointer"
        @click="$emit('open', file)"
      >
        <input
          type="checkbox"
          :checked="isSelected(file.id)"
          class="size-3.5 rounded border-input accent-primary shrink-0"
          @click.stop
          @change.stop="$emit('select', file.id)"
        />

        <div class="relative size-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          <img :src="coverUrl(file)" alt="" class="size-full object-cover" @load="($event.target as HTMLImageElement).style.display = ''" @error="onCoverError($event, file)" />
          <BookOpen class="size-4 text-muted-foreground absolute" />
        </div>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{{ displayTitle(file) }}</p>
          <div class="flex items-center gap-1.5 min-w-0">
            <p v-if="displayAuthor(file)" class="text-xs text-muted-foreground truncate">{{ displayAuthor(file) }}</p>
            <p v-else class="text-xs text-muted-foreground truncate">{{ file.fileName }}</p>
            <span
              v-if="metadataState(file) === 'fetched'"
              class="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-px text-[10px] font-medium"
            >
              <Wand2 class="size-2.5" />
              Fetched
            </span>
            <span
              v-else-if="metadataState(file) === 'edited'"
              class="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-px text-[10px] font-medium"
            >
              <Pencil class="size-2.5" />
              Edited
            </span>
          </div>
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
          <span v-else class="text-xs text-muted-foreground/40">-</span>
        </div>

        <div class="w-7 flex justify-center shrink-0">
          <button
            v-if="file.fetchedMetadata"
            class="flex items-center justify-center size-6 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
            title="Apply fetched metadata"
            @click.stop="$emit('applyFetched', file.id)"
          >
            <Wand2 class="size-3.5" />
          </button>
        </div>

        <div class="w-16 flex justify-center shrink-0">
          <StagingStatusBadge :status="file.status" />
        </div>
      </button>
    </div>
  </div>
</template>
