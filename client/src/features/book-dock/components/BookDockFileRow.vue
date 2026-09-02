<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, ArrowRight, Check, ChevronRight, Copy, Files, FolderPlus, PenLine, RotateCw, Trash2, Wand2 } from '@lucide/vue'
import type { BookDockFile } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import BookDockStatusBadge from './BookDockStatusBadge.vue'
import BookDockCoverPeek from './BookDockCoverPeek.vue'
import type { BookDockConflict } from '../composables/useBookDockConflicts'
import {
  confidenceBadgeClass,
  currentCoverUrl,
  displayAuthor,
  displayTitle,
  isReadyToFile,
  isTargetUnassigned,
  metadataDiff,
  metadataState,
  proposedCoverUrl,
  proposedTitle,
} from '../lib/file-display'

const props = defineProps<{
  file: BookDockFile
  selected: boolean
  expanded: boolean
  focused: boolean
  libraryName: string | null
  targetLabel: string
  conflict?: BookDockConflict
}>()

const emit = defineEmits<{
  select: [number, boolean]
  toggleExpand: [number]
  setDestination: [BookDockFile]
  file: [BookDockFile]
  applyFetched: [number]
  open: [BookDockFile]
  discard: [BookDockFile]
  retry: [BookDockFile]
}>()

const { t } = useI18n()

const title = computed(() => proposedTitle(props.file) ?? displayTitle(props.file))
const author = computed(() => displayAuthor(props.file))
const diff = computed(() => metadataDiff(props.file))
const filable = computed(() => isReadyToFile(props.file))
const unassigned = computed(() => isTargetUnassigned(props.file))
const newCover = computed(() => proposedCoverUrl(props.file))

const state = computed(() => metadataState(props.file))
const isApplied = computed(() => state.value === 'edited')
const isFetchedPending = computed(() => state.value === 'fetched')

const confidence = computed(() => props.file.confidence)
const hasScore = computed(() => confidence.value !== null && confidence.value !== undefined && confidence.value > 0)
const weakMatch = computed(() => hasScore.value && (confidence.value as number) < 85)
const noMatchYet = computed(() => props.file.status === 'ready' && !hasScore.value)
const canRefetch = computed(() => props.file.status === 'ready' || props.file.status === 'error')

const edgeClass = computed(() => {
  if (props.file.status === 'error' || props.conflict) return 'border-l-red-500/60'
  if (weakMatch.value) return 'border-l-amber-500/60'
  return 'border-l-transparent'
})

const conflictLabel = computed(() => {
  if (!props.conflict) return ''
  return t(`bookDock.layout.conflict.${props.conflict.status}`)
})

/** A unit's anchor row describes only its primary file, so the row must state the whole unit. */
const isUnit = computed(() => props.file.unitFiles.length > 1)

const unitSizeBytes = computed(() => {
  const sizes = props.file.unitFiles.map((file) => file.fileSize).filter((size): size is number => size != null)
  return sizes.length ? sizes.reduce((total, size) => total + size, 0) : null
})

const subtitle = computed(() => {
  const parts = [author.value || t('bookDock.layout.row.noAuthor')]
  const sizeBytes = isUnit.value ? unitSizeBytes.value : props.file.fileSize
  if (sizeBytes != null) parts.push(formatBytes(sizeBytes))
  if (props.file.format) parts.push(props.file.format.toUpperCase())
  return parts.join(' · ')
})

function unitFileDetail(file: BookDockFile['unitFiles'][number]): string {
  const parts = [t(`bookDock.layout.unit.role.${file.role}`)]
  if (file.fileSize != null) parts.push(formatBytes(file.fileSize))
  return parts.join(' · ')
}

function onSelect(event: MouseEvent) {
  emit('select', props.file.id, event.shiftKey)
}
function onToggleExpand() {
  emit('toggleExpand', props.file.id)
}
function onSetDestination() {
  emit('setDestination', props.file)
}
function onFile() {
  emit('file', props.file)
}
function onApplyFetched() {
  emit('applyFetched', props.file.id)
}
function onOpenDetails() {
  emit('open', props.file)
}
function onDiscard() {
  emit('discard', props.file)
}
function onRetry() {
  emit('retry', props.file)
}
</script>

<template>
  <div
    class="book-dock-row border-b border-border last:border-b-0"
    :data-selected="props.selected ? '1' : '0'"
    :data-expanded="props.expanded ? '1' : '0'"
    :data-focused="props.focused ? '1' : '0'"
  >
    <div
      class="row-line flex w-full items-center gap-3 border-l-2 px-3 py-2.5 transition-colors hover:bg-muted/45"
      :class="[edgeClass, props.selected ? 'bg-primary/8' : '', props.focused ? 'bg-muted/60' : '']"
    >
      <input
        type="checkbox"
        class="size-4 shrink-0 cursor-pointer accent-primary"
        :checked="props.selected"
        :aria-label="t('bookDock.layout.row.select', { title })"
        @click="onSelect"
      />

      <BookDockCoverPeek :title="title" :current-url="currentCoverUrl(props.file)" :proposed-url="newCover" :applied="isApplied" />

      <button
        type="button"
        class="row-open min-w-0 flex-1 bg-transparent text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :aria-expanded="props.expanded"
        @click="onToggleExpand"
      >
        <span class="block truncate text-[13px] font-medium tracking-tight text-foreground">{{ title }}</span>
        <span class="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{{ subtitle }}</span>
        <span class="mt-0.5 block truncate text-[10.5px]" :class="unassigned ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">
          {{ props.targetLabel }}
        </span>
      </button>

      <span class="row-meta flex shrink-0 items-center gap-1.5">
        <!-- The row's own name is the primary file's, so without this a 31-track audiobook reads
             as a single mp3 until someone expands it. -->
        <span
          v-if="isUnit"
          class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
        >
          <Files class="size-2.5" aria-hidden="true" />
          {{ t('bookDock.layout.unit.fileCount', { count: props.file.unitFiles.length }) }}
        </span>

        <!-- Known before finalize rather than discovered during it. -->
        <span
          v-if="props.conflict"
          class="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-600 dark:text-red-400"
          :title="props.conflict.message ?? conflictLabel"
        >
          <Copy class="size-2.5" aria-hidden="true" />
          {{ conflictLabel }}
        </span>

        <BookDockStatusBadge v-if="props.file.status !== 'ready'" :status="props.file.status" />

        <span
          v-if="hasScore"
          class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
          :class="confidenceBadgeClass(props.file.confidence)"
        >
          {{ t('bookDock.layout.row.match', { percent: props.file.confidence }) }}
        </span>
        <span v-else-if="noMatchYet" class="text-[10.5px] font-medium text-muted-foreground">{{ t('bookDock.layout.row.noMatch') }}</span>

        <span
          v-if="isApplied"
          class="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400"
        >
          <Check class="size-2.5" aria-hidden="true" />
          {{ t('bookDock.layout.row.applied') }}
        </span>

        <button
          v-if="isFetchedPending"
          type="button"
          data-testid="book-dock-row-apply"
          class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-amber-500/12 px-2 text-[10.5px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-amber-300"
          @click="onApplyFetched"
        >
          <Wand2 class="size-3" aria-hidden="true" />
          {{ t('bookDock.apply') }}
        </button>

        <button
          type="button"
          class="inline-flex h-7 max-w-[11rem] items-center gap-1.5 rounded-lg border px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            unassigned
              ? 'border-dashed border-amber-500/55 bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300'
              : 'border-border bg-muted/55 text-foreground hover:border-primary/40'
          "
          @click="onSetDestination"
        >
          <AlertCircle v-if="unassigned" class="size-3 shrink-0" aria-hidden="true" />
          <FolderPlus v-else class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{{
            unassigned ? t('bookDock.layout.row.setDestination') : (props.libraryName ?? t('bookDock.fileList.unknownLibrary'))
          }}</span>
        </button>
      </span>

      <span class="flex shrink-0 items-center gap-1">
        <!-- Always visible. These were hover-revealed, which left an unexplained gap
             in the row and made the actions undiscoverable. -->
        <span class="row-quick flex gap-0.5">
          <button
            type="button"
            data-testid="book-dock-row-edit"
            class="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :title="t('bookDock.layout.row.editDetails')"
            :aria-label="t('bookDock.layout.row.editDetails')"
            @click="onOpenDetails"
          >
            <PenLine class="size-3.5" />
          </button>
          <button
            type="button"
            data-testid="book-dock-row-retry"
            class="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            :title="t('bookDock.layout.row.refetch')"
            :aria-label="t('bookDock.layout.row.refetch')"
            :disabled="!canRefetch"
            @click="onRetry"
          >
            <RotateCw class="size-3.5" />
          </button>
          <button
            type="button"
            data-testid="book-dock-row-discard"
            class="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/12 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:text-red-400"
            :title="t('bookDock.discard')"
            :aria-label="t('bookDock.discard')"
            @click="onDiscard"
          >
            <Trash2 class="size-3.5" />
          </button>
        </span>

        <button
          v-if="filable"
          type="button"
          class="row-file inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          @click="onFile"
        >
          <Check class="size-3" aria-hidden="true" />
          {{ t('bookDock.layout.row.file') }}
        </button>

        <button
          type="button"
          class="row-toggle grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          tabindex="-1"
          aria-hidden="true"
          @click="onToggleExpand"
        >
          <ChevronRight class="row-caret size-4 transition-transform" />
        </button>
      </span>
    </div>

    <div v-if="props.expanded" class="border-t border-border bg-muted/25 px-3 py-2.5 sm:pl-[3.4rem]">
      <!-- Read-only on purpose: a unit is filed whole, so "finalize track 7 of 31" is not a
           thing the interface should let anyone express. -->
      <div v-if="isUnit" class="mb-2.5 rounded-lg border border-border bg-card p-3">
        <p class="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {{ t('bookDock.layout.unit.filesHeading', { count: props.file.unitFiles.length }) }}
        </p>
        <ol class="grid gap-1">
          <li
            v-for="(unitFile, unitFileIndex) in props.file.unitFiles"
            :key="`${unitFileIndex}:${unitFile.fileName}`"
            class="flex min-w-0 items-baseline gap-2 text-xs"
          >
            <span class="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{{ unitFileIndex + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-foreground">{{ unitFile.fileName }}</span>
            <span class="shrink-0 text-muted-foreground">{{ unitFileDetail(unitFile) }}</span>
          </li>
        </ol>
      </div>

      <div class="rounded-lg border border-border bg-card p-3">
        <div class="mb-2 flex items-center gap-2">
          <p class="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            {{ t('bookDock.layout.row.proposedChanges') }}
          </p>
          <span class="h-px flex-1 bg-border" />
          <span v-if="diff.length" class="text-[10px] tabular-nums text-muted-foreground">
            {{ t('bookDock.layout.row.changedFields', { count: diff.length }) }}
          </span>
        </div>

        <dl v-if="diff.length" class="grid gap-1.5">
          <div v-for="entry in diff" :key="entry.key" class="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-3 text-xs">
            <dt class="truncate text-[9.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{{ entry.key }}</dt>
            <dd class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <template v-if="entry.from">
                <span class="text-muted-foreground line-through decoration-1">{{ entry.from }}</span>
                <ArrowRight class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="font-medium text-foreground">{{ entry.to }}</span>
              </template>
              <span v-else class="font-medium text-emerald-600 dark:text-emerald-400">+ {{ entry.to }}</span>
            </dd>
          </div>
        </dl>

        <p v-else-if="props.file.errorMessage" class="text-xs text-red-600 dark:text-red-400">{{ props.file.errorMessage }}</p>
        <p v-else class="text-xs text-muted-foreground">{{ t('bookDock.layout.row.noChanges') }}</p>

        <!-- Searching providers and editing every field already live in the detail
             sheet, so the expansion points at it instead of shipping a lesser copy. -->
        <div class="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
          <span class="text-[10.5px] text-muted-foreground">{{ t('bookDock.layout.row.needMore') }}</span>
          <button
            type="button"
            data-testid="book-dock-row-open-details"
            class="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            @click="onOpenDetails"
          >
            <PenLine class="size-3" aria-hidden="true" />
            {{ t('bookDock.layout.row.editDetails') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-dock-row[data-expanded='1'] .row-caret {
  transform: rotate(90deg);
  color: var(--foreground);
}

@media (prefers-reduced-motion: reduce) {
  .row-caret {
    transition: none;
  }
}

/*
 * One codepath for both widths. The list declares the container, so the row reflows
 * on its own measured width rather than the viewport's.
 */
@container (max-width: 540px) {
  .row-line {
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }

  .row-meta {
    order: 3;
    flex-basis: 100%;
    min-width: 0;
    padding-inline-start: 1.75rem;
  }

  .row-file {
    display: none;
  }
}
</style>
