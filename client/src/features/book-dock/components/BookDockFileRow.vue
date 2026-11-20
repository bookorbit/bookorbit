<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  FilePlus,
  Files,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderX,
  Info,
  Loader2,
  Lock,
  PenLine,
  RotateCw,
  Trash2,
  Wand2,
} from '@lucide/vue'
import type { BookDockFile } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { keepBookDockDuplicate } from '../api/book-dock.api'
import { HOLD_TONE_CLASS, holdChipText, holdStyle } from '../lib/hold-reason'
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
  /** Dock managers may file what waits for a manager and resolve duplicates for anyone. */
  canManage?: boolean
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
  /** "Keep both" cleared the duplicate hold; the list should reload the file. */
  changed: []
}>()

const { t } = useI18n()

const title = computed(() => proposedTitle(props.file) ?? displayTitle(props.file))
const author = computed(() => displayAuthor(props.file))
const diff = computed(() => metadataDiff(props.file))
const hold = computed(() => props.file.holdReason ?? null)
const holdTone = computed(() => (hold.value ? HOLD_TONE_CLASS[holdStyle(hold.value).tone] : null))
const holdIcon = computed(() => (hold.value ? holdStyle(hold.value).icon : null))
const holdText = computed(() => holdChipText(props.file, t))
const isDuplicate = computed(() => hold.value === 'duplicate')
const waitsForManager = computed(() => hold.value === 'waiting_for_manager' && !props.canManage)

/** Holds that "File" cannot get past; each has its own action instead. */
const BLOCKING_HOLDS = new Set(['duplicate', 'not_allowed_in_library', 'unsupported_layout', 'no_destination', 'no_folder'])
const filable = computed(() => isReadyToFile(props.file) && !waitsForManager.value && !(hold.value && BLOCKING_HOLDS.has(hold.value)))
const unassigned = computed(() => isTargetUnassigned(props.file))

/** The destination button names what is wrong with the destination when a hold is about it. */
const destination = computed(() => {
  const working = props.file.status !== 'ready' && props.file.status !== 'error'
  if (hold.value === 'no_destination') return { label: t('bookDock.layout.row.setDestination'), icon: CircleAlert, class: HOLD_TONE_CLASS.sky.action }
  if (hold.value === 'no_folder') return { label: t('bookDock.hold.action.chooseFolder'), icon: FolderOpen, class: HOLD_TONE_CLASS.sky.action }
  if (hold.value === 'not_allowed_in_library' || hold.value === 'unsupported_layout') {
    return { label: t('bookDock.hold.action.moveTo'), icon: FolderInput, class: HOLD_TONE_CLASS.violet.action }
  }
  if (unassigned.value) {
    return working
      ? null
      : {
          label: t('bookDock.layout.row.setDestination'),
          icon: AlertCircle,
          class: 'border-dashed border-amber-500/55 bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300',
        }
  }
  return {
    label: props.libraryName ?? t('bookDock.fileList.unknownLibrary'),
    icon: FolderPlus,
    class: 'border-border bg-muted/55 text-foreground hover:border-primary/40',
  }
})

const alsoIn = computed(() => (props.file.alsoIn?.length ? t('bookDock.layout.row.alsoIn', { libraries: formatList(props.file.alsoIn) }) : ''))
const formerLibrary = computed(() =>
  props.file.formerLibraryName ? t('bookDock.layout.row.fromDeletedLibrary', { library: props.file.formerLibraryName }) : '',
)

const keepingBoth = ref(false)
const keepBothFailed = ref(false)
const existingBookId = computed(() => props.file.holdDetail?.bookId ?? null)
const newCover = computed(() => proposedCoverUrl(props.file))

const state = computed(() => metadataState(props.file))
const isApplied = computed(() => state.value === 'edited')
const isFetchedPending = computed(() => state.value === 'fetched')

const confidence = computed(() => props.file.confidence)
// The server scores only fetched results, so 0% is a fetched result that disagrees, not a missing one.
const hasScore = computed(() => confidence.value !== null && confidence.value !== undefined)
const weakMatch = computed(() => hasScore.value && (confidence.value as number) < 85)
const noMatchYet = computed(() => props.file.status === 'ready' && !hasScore.value)
const canRefetch = computed(() => props.file.status === 'ready' || props.file.status === 'error')

const edgeClass = computed(() => {
  if (props.file.status === 'error' || props.conflict) return 'border-l-red-500/60'
  if (holdTone.value && hold.value !== 'waiting_for_manager') return holdTone.value.edge
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
async function onKeepBoth() {
  if (keepingBoth.value) return
  keepingBoth.value = true
  keepBothFailed.value = false
  const result = await keepBookDockDuplicate(props.file.id)
  keepingBoth.value = false
  if (result.ok) emit('changed')
  else keepBothFailed.value = true
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
        <span
          class="mt-0.5 flex min-w-0 items-center gap-2 text-[10.5px]"
          :class="unassigned ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
        >
          <span class="truncate">{{ props.targetLabel }}</span>
          <span
            v-if="alsoIn"
            data-testid="book-dock-row-also-in"
            class="inline-flex shrink-0 items-center gap-[3px] font-semibold text-sky-600 dark:text-sky-400"
          >
            <Info class="size-2.5" aria-hidden="true" />
            {{ alsoIn }}
          </span>
          <span
            v-if="formerLibrary"
            data-testid="book-dock-row-former-library"
            class="inline-flex shrink-0 items-center gap-[3px] font-semibold text-muted-foreground"
          >
            <FolderX class="size-2.5" aria-hidden="true" />
            {{ formerLibrary }}
          </span>
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

        <span
          v-if="hold && holdTone"
          data-testid="book-dock-row-hold"
          class="inline-flex shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
          :class="holdTone.chip"
          :title="waitsForManager ? t('bookDock.hold.managerHint') : holdText"
        >
          <component :is="holdIcon" class="size-2.5" aria-hidden="true" />
          {{ holdText }}
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
          v-if="hasScore && hold !== 'low_confidence'"
          class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
          :data-narrow-hidden="hold ? '1' : undefined"
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
          v-if="destination"
          type="button"
          data-testid="book-dock-row-destination"
          class="inline-flex h-7 max-w-[11rem] items-center gap-1.5 rounded-lg border px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="destination.class"
          @click="onSetDestination"
        >
          <component :is="destination.icon" class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ destination.label }}</span>
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
          v-if="isDuplicate"
          type="button"
          data-testid="book-dock-row-resolve"
          class="row-file inline-flex h-7 items-center gap-1.5 rounded-lg bg-red-500/15 px-2.5 text-[11.5px] font-medium text-red-700 transition-colors hover:bg-red-500/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-red-300"
          :aria-expanded="props.expanded"
          @click="onToggleExpand"
        >
          <Copy class="size-3" aria-hidden="true" />
          {{ t('bookDock.hold.action.resolve') }}
        </button>

        <span
          v-else-if="waitsForManager"
          data-testid="book-dock-row-locked"
          class="inline-grid size-7 place-items-center text-muted-foreground"
          :title="t('bookDock.hold.managerHint')"
        >
          <Lock class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ t('bookDock.hold.managerHint') }}</span>
        </span>

        <button
          v-else-if="filable"
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

      <div
        v-if="isDuplicate"
        role="group"
        data-testid="book-dock-row-duplicate"
        :aria-label="holdText"
        class="grid gap-3 rounded-[10px] border border-red-500/35 bg-card p-3"
      >
        <div class="flex items-center gap-2">
          <p class="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{{ holdText }}</p>
          <span class="h-px flex-1 bg-border" />
          <RouterLink
            v-if="existingBookId"
            :to="{ name: 'book-detail', params: { bookId: existingBookId } }"
            class="inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {{ t('bookDock.hold.duplicate.openExisting') }}
            <ExternalLink class="size-3" aria-hidden="true" />
          </RouterLink>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="book-dock-row-add-format"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            @click="onFile"
          >
            <FilePlus class="size-3.5" aria-hidden="true" />
            {{ t('bookDock.hold.duplicate.addAsFormat') }}
          </button>
          <button
            v-if="props.canManage"
            type="button"
            data-testid="book-dock-row-keep-both"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            :disabled="keepingBoth"
            @click="onKeepBoth"
          >
            <Loader2 v-if="keepingBoth" class="size-3.5 animate-spin" aria-hidden="true" />
            <Files v-else class="size-3.5" aria-hidden="true" />
            {{ t('bookDock.hold.duplicate.keepBoth') }}
          </button>
          <button
            type="button"
            data-testid="book-dock-row-duplicate-discard"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-red-400"
            @click="onDiscard"
          >
            <Trash2 class="size-3.5" aria-hidden="true" />
            {{ t('bookDock.discard') }}
          </button>
          <p class="basis-full text-[11px] text-muted-foreground">
            {{ props.canManage ? t('bookDock.hold.duplicate.hint') : t('bookDock.hold.duplicate.hintMember') }}
          </p>
          <p v-if="keepBothFailed" role="alert" class="basis-full text-[11px] text-red-600 dark:text-red-400">
            {{ t('bookDock.hold.duplicate.keepBothFailed') }}
          </p>
        </div>
      </div>

      <div v-else class="rounded-lg border border-border bg-card p-3">
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

  .row-meta {
    flex-wrap: wrap;
  }

  .row-file,
  [data-narrow-hidden='1'] {
    display: none;
  }
}
</style>
