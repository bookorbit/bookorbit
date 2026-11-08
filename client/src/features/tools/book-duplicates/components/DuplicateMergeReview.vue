<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import type { BookDuplicateGroup, BookMergeField } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import MergeBlockers from '@/features/book/components/merge/MergeBlockers.vue'
import MergeProgress from '@/features/book/components/merge/MergeProgress.vue'
import MergeReviewStep from '@/features/book/components/merge/MergeReviewStep.vue'
import { useBookMerge, type BookMergeJobState } from '@/features/book/composables/useBookMerge'
import { mergeBookLabels, mergeLibraryNames } from '@/features/book/lib/book-merge'
import { useLibraries } from '@/features/library/composables/useLibraries'

/**
 * Merge mode of the duplicate review: the full merge review (details, files, reading data) for
 * one group, with the group's keeper as the book that is kept.
 */
const props = defineProps<{
  group: BookDuplicateGroup
  keeperId: number
  canDeleteBooks: boolean
}>()

const emit = defineEmits<{
  cancel: []
  finished: [job: BookMergeJobState]
  'link-instead': []
}>()

const { t } = useI18n()
const { libraries } = useLibraries()
const merge = useBookMerge()

const preview = merge.preview
const bookLabels = computed(() =>
  mergeBookLabels(preview.value?.books ?? [], t('book.untitled'), (title, detail) => t('book.merge.bookLabel', { title, detail })),
)
const libraryNames = computed(() => mergeLibraryNames(preview.value?.books ?? [], libraries.value))
const blockers = computed(() => (merge.previewCurrent.value ? (preview.value?.blockers ?? []) : []))
const blocked = computed(() => blockers.value.length > 0)
const confirmLabel = computed(() => t('book.merge.confirm', { count: merge.bookIds.value.length }))

onMounted(begin)

watch(
  () => [props.group.id, props.keeperId] as const,
  () => begin(),
)

watch(merge.jobFinished, (finished) => {
  if (finished && merge.job.value) emit('finished', merge.job.value)
})

function begin(): void {
  if (merge.jobActive.value) return
  void merge.start(
    props.group.books.map((book) => book.id),
    { keeperId: props.keeperId },
  )
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

function setAcknowledgeAccessLoss(value: boolean): void {
  merge.setAcknowledgeAccessLoss(value)
}

function handleCancel(): void {
  emit('cancel')
}

function handleLinkInstead(): void {
  emit('link-instead')
}

async function handleConfirm(): Promise<void> {
  await merge.execute()
}
</script>

<template>
  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" data-testid="duplicate-merge-review">
    <MergeProgress v-if="merge.job.value" :job="merge.job.value" :book-labels="bookLabels" :unreachable="merge.jobUnreachable.value" />
    <template v-else>
      <p v-if="merge.previewError.value" class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
        {{ merge.previewError.value }}
      </p>
      <p v-else-if="!preview" class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('book.merge.loading') }}
      </p>
      <MergeReviewStep
        v-if="preview && merge.keeperId.value !== null"
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
  </div>

  <div class="space-y-2 border-t border-border px-5 py-3">
    <p v-if="merge.executeError.value" class="text-sm text-destructive" role="alert">{{ merge.executeError.value }}</p>
    <MergeBlockers
      v-if="!merge.job.value && blocked"
      :blockers="blockers"
      :book-labels="bookLabels"
      :library-names="libraryNames"
      :preview="preview"
      can-link
      @link-instead="handleLinkInstead"
    />
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" :disabled="merge.jobActive.value" @click="handleCancel">{{
        t(merge.job.value ? 'common.close' : 'common.cancel')
      }}</Button>
      <Button v-if="!merge.job.value && !blocked" :disabled="!merge.canExecute.value" data-testid="duplicate-merge-confirm" @click="handleConfirm">
        <Loader2 v-if="merge.inFlight.value" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ merge.inFlight.value ? t('book.merge.confirming') : confirmLabel }}
      </Button>
    </div>
  </div>
</template>
