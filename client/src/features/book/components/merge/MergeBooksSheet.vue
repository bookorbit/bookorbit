<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Combine, Loader2 } from '@lucide/vue'
import { BOOK_MERGE_MAX_BOOKS, Permission, type BookCard, type BookMergeField, type BookMergedEvent } from '@bookorbit/types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useBookMerge } from '@/features/book/composables/useBookMerge'
import { mergeBookLabels, mergedSourceIds, mergeLibraryNames } from '@/features/book/lib/book-merge'
import type { LinkSeedBook } from '@/features/book/lib/book-link'
import MergeBlockers from './MergeBlockers.vue'
import MergeBookPicker from './MergeBookPicker.vue'
import MergeKeeperStep from './MergeKeeperStep.vue'
import MergeProgress from './MergeProgress.vue'
import MergeReviewStep from './MergeReviewStep.vue'

type Stage = 'pick' | 'keeper' | 'review'
type View = Stage | 'progress' | 'result'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The books to merge, in display order. From the detail page this is just the open book. */
    bookIds: number[]
    /** The book to keep when the caller knows it; otherwise the keeper rule suggests one. */
    keeperId?: number | null
    /** Starts with a search of this library for the books to merge with (the detail page entry point). */
    pickerLibraryId?: number | null
  }>(),
  { keeperId: null, pickerLibraryId: null },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  merged: [event: BookMergedEvent]
  /**
   * A blocker suggested Link instead: the host opens Link for these books, the kept book first, and
   * may name them from `books` when it has no card of its own for them.
   */
  'link-instead': [bookIds: number[], books: LinkSeedBook[]]
}>()

const { t } = useI18n()
const router = useRouter()
const { hasPermission } = usePermissions()
const { libraries } = useLibraries()
const merge = useBookMerge()

const stage = ref<Stage>('keeper')
/** Kept here rather than in the picker, so going back shows exactly the books Next sends. */
const pickedBooks = ref<BookCard[]>([])
const pickedIds = computed(() => pickedBooks.value.map((book) => book.id))
const stepHeading = ref<HTMLElement | null>(null)
const stepBody = ref<HTMLElement | null>(null)

const preview = merge.preview
const view = computed<View>(() => {
  if (merge.job.value) return merge.jobFinished.value ? 'result' : 'progress'
  return stage.value
})

const stepTitle = computed(() => {
  switch (view.value) {
    case 'pick':
      return t('book.merge.steps.pick')
    case 'review':
      return t('book.merge.steps.review')
    case 'progress':
      return t('book.merge.steps.progress')
    case 'result':
      return t('book.merge.steps.result')
    default:
      return t('book.merge.steps.keeper')
  }
})

const bookLabels = computed(() =>
  mergeBookLabels(preview.value?.books ?? [], t('book.untitled'), (title, detail) => t('book.merge.bookLabel', { title, detail })),
)
const libraryNames = computed(() => mergeLibraryNames(preview.value?.books ?? [], libraries.value))
const keptTitle = computed(() => (merge.keeperId.value !== null ? (bookLabels.value.get(merge.keeperId.value) ?? '') : ''))
const blockers = computed(() => (merge.previewCurrent.value ? (preview.value?.blockers ?? []) : []))
const blocked = computed(() => blockers.value.length > 0)
const canDeleteBooks = computed(() => hasPermission(Permission.LibraryDeleteBooks))
const confirmLabel = computed(() => t('book.merge.confirm', { count: merge.bookIds.value.length }))
const pickerExcluded = computed(() => props.bookIds)
const pickerMax = computed(() => Math.max(0, BOOK_MERGE_MAX_BOOKS - props.bookIds.length))
const canContinueFromKeeper = computed(() => preview.value !== null && merge.keeperId.value !== null)
const hasMergedSources = computed(() => merge.job.value !== null && mergedSourceIds(merge.job.value).length > 0)
/** Set by the partial notice: the next open shows this job's result instead of starting over. */
let reopenJobId: number | null = null

watch(
  () => props.open,
  (open) => {
    if (open) begin()
    // A closed review stops asking for previews; a running merge keeps being followed, and a
    // finished one is kept until the next open so its notice can still bring the result back.
    else if (!merge.jobActive.value && !merge.jobFinished.value) merge.reset()
  },
  { immediate: true },
)

// After the out-in transition, not on the view change: until then the heading ref still names the
// step that is leaving, and the shared scroll position belongs to it.
function handleStepEntered(): void {
  stepBody.value?.scrollTo({ top: 0 })
  stepHeading.value?.focus({ preventScroll: true })
}

watch(merge.jobFinished, (finished) => {
  if (finished) handleJobFinished()
})

function begin(): void {
  // A merge still running keeps its progress on screen; reopening never restarts it (F6).
  if (merge.jobActive.value) return
  const showingResult = reopenJobId !== null && merge.jobFinished.value && merge.job.value?.jobId === reopenJobId
  reopenJobId = null
  if (showingResult) return
  pickedBooks.value = []
  if (props.pickerLibraryId !== null && props.bookIds.length < 2) {
    merge.reset()
    stage.value = 'pick'
    return
  }
  stage.value = 'keeper'
  void merge.start(props.bookIds, { keeperId: props.keeperId })
}

function handleJobFinished(): void {
  const job = merge.job.value
  if (!job) return
  const merged = mergedSourceIds(job)
  const crossLibrary = job.sourceLibraryIds.length > 1
  if (merged.length > 0) {
    emit('merged', {
      libraryId: job.libraryId ?? 0,
      targetBookId: job.targetBookId,
      sourceBookIds: merged,
      ...(crossLibrary ? { sourceLibraryIds: job.sourceLibraryIds } : {}),
    })
  }
  const targetBookId = job.targetBookId
  if (job.status === 'done' && merged.length === job.sourceBookIds.length) {
    const library = job.libraryId !== null ? libraryNames.value.get(job.libraryId) : undefined
    const message =
      crossLibrary && library
        ? t('book.merge.crossLibrary.toast.success', { title: keptTitle.value, library })
        : t('book.merge.toast.success', { count: merged.length, title: keptTitle.value })
    toast.success(message, { action: { label: t('book.merge.result.openBook'), onClick: () => openBook(targetBookId) } })
    close()
    return
  }
  if (merged.length > 0) {
    const jobId = job.jobId
    toast.warning(t('book.merge.toast.partial', { merged: merged.length, total: job.sourceBookIds.length }), {
      action: { label: t('book.merge.toast.showResult'), onClick: () => reopenResult(jobId) },
    })
  } else toast.error(t('book.merge.toast.failed'))
}

/** The partial notice's action. With the sheet already open the result is on screen. */
function reopenResult(jobId: number): void {
  if (props.open || !merge.jobFinished.value || merge.job.value?.jobId !== jobId) return
  reopenJobId = jobId
  emit('update:open', true)
}

function openBook(bookId: number): void {
  void router.push({ name: 'book-detail', params: { bookId } })
}

function openKeptBook(): void {
  const job = merge.job.value
  if (!job) return
  openBook(job.targetBookId)
  close()
}

function close(): void {
  emit('update:open', false)
}

function handleOpenChange(open: boolean): void {
  emit('update:open', open)
}

function handlePickedChange(books: BookCard[]): void {
  pickedBooks.value = books
}

function continueFromPicker(): void {
  if (pickedIds.value.length === 0) return
  stage.value = 'keeper'
  void merge.start([...props.bookIds, ...pickedIds.value], { keeperId: props.keeperId })
}

function backToPicker(): void {
  stage.value = 'pick'
}

function continueToReview(): void {
  if (!canContinueFromKeeper.value) return
  stage.value = 'review'
}

function backToKeeper(): void {
  stage.value = 'keeper'
}

/** Link gets the same books with the kept one first, so it becomes the main book and nothing is picked again. */
function linkInstead(): void {
  const keeper = merge.keeperId.value
  const ids = keeper !== null ? [keeper, ...merge.bookIds.value.filter((id) => id !== keeper)] : [...merge.bookIds.value]
  const summaries = new Map((preview.value?.books ?? []).map((book) => [book.id, book]))
  const books = ids.flatMap((id): LinkSeedBook[] => {
    const book = summaries.get(id)
    return book ? [{ id, title: book.title, libraryId: book.libraryId, formats: book.formats }] : []
  })
  emit('update:open', false)
  emit('link-instead', ids, books)
}

function chooseDestination(): void {
  stage.value = 'keeper'
}

function setAcknowledgeAccessLoss(value: boolean): void {
  merge.setAcknowledgeAccessLoss(value)
}

function selectKeeper(bookId: number): void {
  merge.setKeeper(bookId)
}

function selectDestination(bookId: number): void {
  merge.setDestination(bookId)
}

function chooseField(field: BookMergeField, bookId: number): void {
  merge.setFieldChoice(field, bookId)
}

function includeTag(id: number, include: boolean): void {
  merge.setIncludeTag(id, include)
}

function includeGenre(id: number, include: boolean): void {
  merge.setIncludeGenre(id, include)
}

function setDeleteIdentical(value: boolean): void {
  merge.setDeleteIdenticalCopies(value)
}

async function confirmMerge(): Promise<void> {
  await merge.execute()
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      class="h-[100dvh] max-h-[100dvh] gap-0 p-0 sm:inset-x-0 sm:mx-auto sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-t-lg"
      data-testid="merge-books-sheet"
    >
      <SheetHeader class="border-b border-border pe-12">
        <SheetTitle class="flex items-center gap-2">
          <Combine :size="16" aria-hidden="true" />
          {{ t('book.merge.title') }}
        </SheetTitle>
        <SheetDescription>{{ t('book.merge.description') }}</SheetDescription>
      </SheetHeader>

      <div ref="stepBody" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Transition
          mode="out-in"
          enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-100 motion-reduce:transition-none"
          leave-to-class="opacity-0"
          @after-enter="handleStepEntered"
        >
          <div :key="view" class="space-y-3">
            <h3
              ref="stepHeading"
              tabindex="-1"
              class="text-base font-semibold text-foreground focus-visible:outline-none"
              data-testid="merge-step-heading"
            >
              {{ stepTitle }}
            </h3>

            <MergeBookPicker
              v-if="view === 'pick' && pickerLibraryId !== null"
              :library-id="pickerLibraryId"
              :exclude-ids="pickerExcluded"
              :model-value="pickedBooks"
              :max="pickerMax"
              @update:model-value="handlePickedChange"
            />

            <template v-else-if="view === 'keeper' || view === 'review'">
              <p v-if="merge.previewError.value" class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {{ merge.previewError.value }}
              </p>
              <p v-else-if="!preview" class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {{ t('book.merge.loading') }}
              </p>
              <template v-if="preview && merge.keeperId.value !== null">
                <MergeKeeperStep
                  v-if="view === 'keeper'"
                  :preview="preview"
                  :keeper-id="merge.keeperId.value"
                  :book-labels="bookLabels"
                  :library-names="libraryNames"
                  @select-keeper="selectKeeper"
                  @select-destination="selectDestination"
                />
                <MergeReviewStep
                  v-else
                  :preview="preview"
                  :keeper-id="merge.keeperId.value"
                  :field-overrides="merge.fieldOverrides.value"
                  :include-tag-ids="merge.includeTagIds.value"
                  :include-genre-ids="merge.includeGenreIds.value"
                  :delete-identical-copies="merge.deleteIdenticalCopies.value"
                  :can-delete-books="canDeleteBooks"
                  :book-labels="bookLabels"
                  :library-names="libraryNames"
                  :acknowledge-access-loss="merge.accessLossAcknowledged.value"
                  :stale-changes="merge.staleChanges.value"
                  :updating="merge.previewLoading.value"
                  @choose-field="chooseField"
                  @include-tag="includeTag"
                  @include-genre="includeGenre"
                  @update:delete-identical-copies="setDeleteIdentical"
                  @update:acknowledge-access-loss="setAcknowledgeAccessLoss"
                />
              </template>
            </template>

            <MergeProgress v-else-if="merge.job.value" :job="merge.job.value" :book-labels="bookLabels" :unreachable="merge.jobUnreachable.value" />
          </div>
        </Transition>
      </div>

      <div class="space-y-2 border-t border-border bg-background px-4 py-3">
        <p v-if="merge.executeError.value && view === 'review'" class="text-sm text-destructive" role="alert" data-testid="merge-execute-error">
          {{ merge.executeError.value }}
        </p>
        <MergeBlockers
          v-if="(view === 'keeper' || view === 'review') && blocked"
          :blockers="blockers"
          :book-labels="bookLabels"
          :library-names="libraryNames"
          :preview="preview"
          can-link
          can-choose-destination
          @choose-keeper="backToKeeper"
          @choose-destination="chooseDestination"
          @link-instead="linkInstead"
        />

        <div class="flex flex-wrap items-center justify-end gap-2">
          <template v-if="view === 'pick'">
            <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
            <Button :disabled="pickedIds.length === 0" data-testid="merge-picker-continue" @click="continueFromPicker">{{ t('common.next') }}</Button>
          </template>

          <template v-else-if="view === 'keeper'">
            <Button v-if="pickerLibraryId !== null" variant="ghost" class="me-auto" @click="backToPicker">{{ t('common.back') }}</Button>
            <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
            <Button :disabled="!canContinueFromKeeper" data-testid="merge-continue" @click="continueToReview">{{ t('book.merge.continue') }}</Button>
          </template>

          <template v-else-if="view === 'review'">
            <Button variant="ghost" class="me-auto" @click="backToKeeper">{{ t('common.back') }}</Button>
            <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
            <Button v-if="!blocked" :disabled="!merge.canExecute.value" data-testid="merge-confirm" @click="confirmMerge">
              <Loader2 v-if="merge.inFlight.value" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {{ merge.inFlight.value ? t('book.merge.confirming') : confirmLabel }}
            </Button>
          </template>

          <template v-else-if="view === 'progress'">
            <Button variant="outline" @click="close">{{ t('common.close') }}</Button>
          </template>

          <template v-else>
            <Button variant="ghost" @click="close">{{ t('common.close') }}</Button>
            <Button v-if="hasMergedSources" @click="openKeptBook">{{ t('book.merge.result.openBook') }}</Button>
          </template>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
