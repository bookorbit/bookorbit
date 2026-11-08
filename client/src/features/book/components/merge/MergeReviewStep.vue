<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2, RefreshCw } from '@lucide/vue'
import type { BookMergeField, BookMergeFieldPreview, BookMergeLibrarySettingChange, BookMergePreviewResponse } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import {
  MERGE_AUDIO_FIELDS,
  MERGE_SECTION_WARNINGS,
  accessLossWarning,
  mergeDestinationLibraryId,
  mergeSpansLibraries,
  mergeWarningMessage,
  splitMergeFiles,
  type BookMergePreviewChange,
} from '@/features/book/lib/book-merge'
import MergeFieldRow from './MergeFieldRow.vue'
import MergeFilesList from './MergeFilesList.vue'
import MergeReadingData from './MergeReadingData.vue'
import MergeReviewSection from './MergeReviewSection.vue'
import MergeVisibility from './MergeVisibility.vue'
import MergeWarnings from './MergeWarnings.vue'

const props = defineProps<{
  preview: BookMergePreviewResponse
  keeperId: number
  fieldOverrides: Partial<Record<BookMergeField, number>>
  includeTagIds: number[]
  includeGenreIds: number[]
  deleteIdenticalCopies: boolean
  /** The viewer holds the delete-books permission the "Remove identical copies" option needs. */
  canDeleteBooks: boolean
  bookLabels: Map<number, string>
  libraryNames: Map<number, string>
  /** The reviewer accepted that other readers lose access (`LIBRARY_ACCESS_NARROWS`). */
  acknowledgeAccessLoss: boolean
  staleChanges: BookMergePreviewChange[] | null
  updating: boolean
}>()

const emit = defineEmits<{
  'choose-field': [field: BookMergeField, bookId: number]
  'include-tag': [id: number, include: boolean]
  'include-genre': [id: number, include: boolean]
  'update:deleteIdenticalCopies': [value: boolean]
  'update:acknowledgeAccessLoss': [value: boolean]
}>()

const { t, te } = useI18n()
const accessTextId = `merge-access-${useId()}`
/** Stands in for the library name while formatting the header, so the name can be set in bold. */
const LIBRARY_MARK = '\uE010'

/** Only rows with a decision or a change in them: fields that differ, or a blank the merge fills. */
const reviewFields = computed(() => props.preview.fields.filter((field) => field.differs || field.defaultBookId !== props.keeperId))
const generalFields = computed(() => reviewFields.value.filter((field) => !MERGE_AUDIO_FIELDS.has(field.field)))
const audioFields = computed(() => reviewFields.value.filter((field) => MERGE_AUDIO_FIELDS.has(field.field)))

const detailsSummary = computed(() => t('book.merge.review.detailsCount', { count: reviewFields.value.length }))
const filesSummary = computed(() => t('book.merge.files.summary', { count: props.preview.files.length }))

const spansLibraries = computed(() => mergeSpansLibraries(props.preview))
const destinationLibraryId = computed(() => mergeDestinationLibraryId(props.preview))
const fileSplit = computed(() => splitMergeFiles(props.preview))
const listedFiles = computed(() => (fileSplit.value.groups ? fileSplit.value.groups.flatMap((group) => group.files) : props.preview.files))

function libraryName(libraryId: number | null): string {
  const id = libraryId ?? destinationLibraryId.value
  return (id !== null ? props.libraryNames.get(id) : undefined) ?? t('book.merge.crossLibrary.unknownLibrary')
}

/** "Merge 3 books into Frankenstein in Audiobooks": the destination library, in bold, cannot be missed. */
const crossLibraryHeader = computed(() => {
  if (!spansLibraries.value || destinationLibraryId.value === null) return null
  const library = libraryName(destinationLibraryId.value)
  const text = t('book.merge.crossLibrary.review.header', {
    count: props.preview.books.length,
    title: props.bookLabels.get(props.keeperId) ?? '',
    library: LIBRARY_MARK,
  })
  const parts = text.split(LIBRARY_MARK)
  if (parts.length !== 2) return { before: text.split(LIBRARY_MARK).join(library), library: null, after: '' }
  return { before: parts[0]!, library, after: parts[1]! }
})

const accessWarning = computed(() => accessLossWarning(props.preview))
const accessText = computed(() => (accessWarning.value ? mergeWarningMessage(accessWarning.value, libraryName) : null))
const accessAcknowledgeLabel = computed(() => {
  const warning = accessWarning.value
  if (!warning) return null
  const library = libraryName(warning.libraryId ?? null)
  if (warning.count == null) return t('book.merge.crossLibrary.access.acknowledgeSome', { library })
  return t('book.merge.crossLibrary.access.acknowledge', { count: warning.count, library })
})

const deviceLines = computed(() =>
  props.preview.warnings.filter((warning) => warning.code === 'KOBO_REMOVAL').map((warning) => mergeWarningMessage(warning, libraryName)),
)

function settingText(change: BookMergeLibrarySettingChange): string | null {
  const library = libraryName(change.toLibraryId)
  if (change.setting === 'primaryFormat') {
    return change.format
      ? t('book.merge.crossLibrary.settings.primaryFormat', { library, format: change.format.toUpperCase() })
      : t('book.merge.crossLibrary.settings.primaryFormatChanges', { library })
  }
  const key = `book.merge.crossLibrary.settings.${change.setting}`
  // A setting a newer server reports but this bundle does not know is left out rather than guessed at.
  return te(key) ? t(key, { library }) : null
}

/** One line per destination setting that applies differently, plus custom fields it does not use. */
const settingLines = computed(() => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const change of props.preview.librarySettingChanges ?? []) {
    const key = `${change.setting}-${change.toLibraryId}-${change.format ?? ''}`
    const text = seen.has(key) ? null : settingText(change)
    seen.add(key)
    if (text) lines.push(text)
  }
  for (const warning of props.preview.warnings) {
    if (warning.code === 'CUSTOM_FIELDS_HIDDEN') lines.push(mergeWarningMessage(warning, libraryName))
  }
  return lines
})

/** Warnings with a section of their own are said there, not repeated in the list. */
const listedWarnings = computed(() => props.preview.warnings.filter((warning) => !MERGE_SECTION_WARNINGS.has(warning.code)))

const crossDeviceBytes = computed(() => props.preview.warnings.find((warning) => warning.code === 'CROSS_DEVICE_COPY')?.bytes ?? null)
const canRemoveIdentical = computed(() => props.preview.canRemoveIdenticalCopies && props.canDeleteBooks)
const resultTags = computed(() => props.preview.visibility.resultTags ?? [])
const resultGenres = computed(() => props.preview.visibility.resultGenres ?? [])
const hasVisibilityCandidates = computed(() => props.preview.visibility.tags.length + props.preview.visibility.genres.length > 0)

function changeLabel(change: BookMergePreviewChange): string {
  switch (change.kind) {
    case 'field':
      return t(`book.merge.fields.${change.field}`)
    case 'files':
      return t('book.merge.review.sections.files')
    case 'readingData':
      return t('book.merge.review.sections.readingData')
    case 'visibility':
      return t('book.merge.review.sections.visibility')
    case 'warnings':
      return t('book.merge.review.warnings')
    default:
      return t('book.merge.blocked.heading')
  }
}

const staleText = computed(() => {
  const changes = props.staleChanges
  if (!changes) return null
  if (changes.length === 0) return t('book.merge.stale.nothingVisible')
  return t('book.merge.stale.changed', { items: formatList(changes.map(changeLabel)) })
})

function chosenBookId(field: BookMergeFieldPreview): number {
  return props.fieldOverrides[field.field] ?? field.defaultBookId
}

function chooseField(field: BookMergeField, bookId: number): void {
  emit('choose-field', field, bookId)
}

function includeTag(id: number, include: boolean): void {
  emit('include-tag', id, include)
}

function includeGenre(id: number, include: boolean): void {
  emit('include-genre', id, include)
}

function updateDeleteIdentical(value: boolean): void {
  emit('update:deleteIdenticalCopies', value)
}

function handleAcknowledgeAccessLoss(event: Event): void {
  emit('update:acknowledgeAccessLoss', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="crossLibraryHeader" class="text-sm text-foreground" data-testid="merge-review-header">
      {{ crossLibraryHeader.before
      }}<strong v-if="crossLibraryHeader.library" class="font-semibold" dir="auto">{{ crossLibraryHeader.library }}</strong
      >{{ crossLibraryHeader.after }}
    </p>
    <p v-else class="text-sm text-muted-foreground">{{ t('book.merge.review.keeping', { title: bookLabels.get(keeperId) ?? '' }) }}</p>

    <div
      v-if="staleText"
      class="flex items-start gap-2 rounded-md bg-info/10 px-3 py-2 text-sm text-foreground"
      role="status"
      data-testid="merge-stale"
    >
      <RefreshCw :size="14" class="mt-0.5 shrink-0 text-info" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block font-medium">{{ t('book.merge.stale.heading') }}</span>
        <span class="block">{{ staleText }}</span>
      </span>
    </div>

    <p v-if="updating" class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ t('book.merge.review.updating') }}
    </p>

    <MergeReviewSection :title="t('book.merge.review.sections.details')" :summary="detailsSummary">
      <p v-if="reviewFields.length === 0" class="text-sm text-muted-foreground">{{ t('book.merge.review.detailsEmpty') }}</p>
      <MergeFieldRow
        v-for="field in generalFields"
        :key="field.field"
        :field="field"
        :chosen-book-id="chosenBookId(field)"
        :keeper-id="keeperId"
        :book-labels="bookLabels"
        @choose="chooseField(field.field, $event)"
      />
      <template v-if="audioFields.length > 0">
        <p class="pt-1 text-xs font-semibold tracking-wide text-foreground uppercase">{{ t('book.merge.review.audiobook') }}</p>
        <MergeFieldRow
          v-for="field in audioFields"
          :key="field.field"
          :field="field"
          :chosen-book-id="chosenBookId(field)"
          :keeper-id="keeperId"
          :book-labels="bookLabels"
          @choose="chooseField(field.field, $event)"
        />
      </template>
      <dl v-if="resultTags.length > 0 || resultGenres.length > 0" class="space-y-1 pt-1 text-sm" data-testid="merge-result-taxonomy">
        <div v-if="resultGenres.length > 0">
          <dt class="text-xs font-semibold text-foreground">{{ t('book.merge.review.resultGenres') }}</dt>
          <dd class="text-muted-foreground">{{ formatList(resultGenres) }}</dd>
        </div>
        <div v-if="resultTags.length > 0">
          <dt class="text-xs font-semibold text-foreground">{{ t('book.merge.review.resultTags') }}</dt>
          <dd class="text-muted-foreground">{{ formatList(resultTags) }}</dd>
        </div>
      </dl>
    </MergeReviewSection>

    <MergeReviewSection :title="t('book.merge.review.sections.files')" :summary="filesSummary" :default-open="preview.files.length <= 12">
      <MergeFilesList
        :files="listedFiles"
        :groups="fileSplit.groups"
        :library-names="libraryNames"
        :book-labels="bookLabels"
        :cross-device-bytes="crossDeviceBytes"
        :can-remove-identical-copies="canRemoveIdentical"
        :delete-identical-copies="deleteIdenticalCopies"
        @update:delete-identical-copies="updateDeleteIdentical"
      />
    </MergeReviewSection>

    <MergeReviewSection
      v-for="left in fileSplit.leftBehind"
      :key="left.libraryId"
      :title="t('book.merge.crossLibrary.leftBehind.heading', { library: libraryName(left.libraryId) })"
      :summary="t('book.merge.files.summary', { count: left.files.length })"
      data-testid="merge-left-behind"
    >
      <p class="text-sm text-muted-foreground">{{ t('book.merge.crossLibrary.leftBehind.untracked') }}</p>
      <ul class="space-y-1">
        <li v-for="file in left.files" :key="file.fileId" class="font-mono text-[0.7rem] break-all text-foreground" dir="auto">
          {{ file.fromRelPath }}
        </li>
      </ul>
    </MergeReviewSection>

    <MergeReviewSection :title="t('book.merge.review.sections.readingData')">
      <MergeReadingData :user-data="preview.userData" />
    </MergeReviewSection>

    <div v-if="accessWarning" class="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5" data-testid="merge-access-callout">
      <p :id="accessTextId" class="flex items-start gap-2 text-sm text-foreground">
        <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ accessText }}</span>
      </p>
      <label class="flex cursor-pointer items-start gap-2.5 ps-6">
        <input
          type="checkbox"
          class="mt-0.5 shrink-0 accent-primary"
          data-testid="merge-acknowledge-access-loss"
          :checked="acknowledgeAccessLoss"
          :aria-describedby="accessTextId"
          @change="handleAcknowledgeAccessLoss"
        />
        <span class="text-sm font-medium text-foreground">{{ accessAcknowledgeLabel }}</span>
      </label>
    </div>

    <MergeReviewSection v-if="hasVisibilityCandidates" :title="t('book.merge.review.sections.visibility')">
      <MergeVisibility
        :visibility="preview.visibility"
        :include-tag-ids="includeTagIds"
        :include-genre-ids="includeGenreIds"
        @include-tag="includeTag"
        @include-genre="includeGenre"
      />
    </MergeReviewSection>

    <section v-if="deviceLines.length > 0" class="space-y-1.5" data-testid="merge-devices">
      <h4 class="text-sm font-semibold text-foreground">{{ t('book.merge.crossLibrary.devices.heading') }}</h4>
      <p v-for="line in deviceLines" :key="line" class="text-sm text-foreground">{{ line }}</p>
    </section>

    <section v-if="settingLines.length > 0" class="space-y-1.5" data-testid="merge-library-settings">
      <h4 class="text-sm font-semibold text-foreground">{{ t('book.merge.crossLibrary.settings.heading') }}</h4>
      <ul class="list-disc space-y-1 ps-5 text-sm text-foreground">
        <li v-for="line in settingLines" :key="line">{{ line }}</li>
      </ul>
    </section>

    <section v-if="listedWarnings.length > 0" class="space-y-2">
      <h4 class="text-sm font-semibold text-foreground">{{ t('book.merge.review.warnings') }}</h4>
      <MergeWarnings
        :warnings="listedWarnings"
        :book-labels="bookLabels"
        :library-names="libraryNames"
        :destination-library-id="destinationLibraryId"
      />
    </section>
  </div>
</template>
