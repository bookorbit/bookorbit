<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Check,
  ChevronDown,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type {
  BookCommunityRating,
  BookDetail,
  BookMetadataLockField,
  CustomMetadataPrimitiveValue,
  MetadataProviderInfo,
  WriteResult,
} from '@bookorbit/types'
import { BOOK_FILE_WRITE_FIELD_LABELS, FORMAT_TO_GROUP, isValidSeriesIndex, parseSeriesIndex } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { metadataScoreColor } from '@/lib/metadata-score-color'
import ChipInput from '@/components/ui/ChipInput.vue'
import CoverEditorPanel from './CoverEditorPanel.vue'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'
import MetadataFieldLabel from './MetadataFieldLabel.vue'
import RichDescriptionEditor from './RichDescriptionEditor.vue'
import SeriesMembershipEditor from './SeriesMembershipEditor.vue'
import WriteAndRenameResultPanel from '../WriteAndRenameResultPanel.vue'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import { type EditableSeriesMembership, normalizeSeriesMemberships, useMetadataEditor } from '../../../composables/useMetadataEditor'
import { type MetadataRefreshPreview, useRefreshMetadata } from '../../../composables/useRefreshMetadata'
import { type FileMetadata, useFileMetadata } from '../../../composables/useFileMetadata'
import { useWriteAndRename } from '../../../composables/useWriteAndRename'
import { useMetadataLocks } from '../../../composables/useMetadataLocks'
import { useAuthorSearch } from '../../../composables/useAuthorSearch'
import { useNarratorSearch } from '../../../composables/useNarratorSearch'
import { useGenreSearch, useTagSearch } from '../../../composables/useTagSearch'
import { usePublisherSearch, useSeriesNameSearch, useLanguageSearch } from '../../../composables/useMetadataFieldSearch'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import { RATING_STARS, getRatingStarClass } from '@/features/book/lib/rating-stars'
import { buildFileMetadataPatch } from '@/features/book/lib/file-metadata-patch'
import { metadataRefreshAppliedMessage, metadataRefreshEmptyMessage } from '@/features/book/lib/metadata-refresh-feedback'
import { filterProviderIdFields, isProviderIdFieldAvailable, isProviderIdFormField } from '@/features/book/lib/provider-id-fields'
import { formatCommunityRatingLine } from '@/features/book/lib/community-rating'
import { formatList } from '@/i18n/formatters'
import MetadataSourceCard from './MetadataSourceCard.vue'

const AUTO_FILL_EMPTY_TOAST_DURATION_MS = 10_000

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{
  saved: [BookDetail]
  locksChanged: [BookMetadataLockField[]]
  coverChanged: ['extracted' | 'custom' | null]
  fileRenamed: []
}>()

const { t } = useI18n()

const DIRECT_PATCH_FIELDS = [
  'title',
  'subtitle',
  'description',
  'authors',
  'genres',
  'publisher',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'isbn10',
  'isbn13',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'librofmId',
  'koboId',
  'comicvineId',
  'ranobedbId',
  'lubimyczytacId',
  'aladinId',
  'mangabakaId',
  'mangabakaSeriesId',
] as const

const COMIC_FIELD_MAP = {
  issueNumber: 'comicIssueNumber',
  volumeName: 'comicVolumeName',
  storyArcs: 'comicStoryArcs',
  pencillers: 'comicPencillers',
  inkers: 'comicInkers',
  colorists: 'comicColorists',
  letterers: 'comicLetterers',
  coverArtists: 'comicCoverArtists',
  characters: 'comicCharacters',
  teams: 'comicTeams',
  locations: 'comicLocations',
} as const

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isPrimaryComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')
const fileWriteStatus = computed(() => props.book.fileWriteStatus ?? null)
const fileWriteWritableFormats = computed(() => fileWriteStatus.value?.writableFormats ?? [])
const fileWriteFieldLabels = computed(() => (fileWriteStatus.value?.writableFields ?? []).map((field) => BOOK_FILE_WRITE_FIELD_LABELS[field]))
const fileWriteFieldCountLabel = computed(() => t('book.detail.editMetadata.fieldCount', { count: fileWriteFieldLabels.value.length }))
const fileWriteTargetSummary = computed(() => {
  const formats = fileWriteWritableFormats.value
  if (formats.length === 0) return t('book.detail.editMetadata.bookFilesTarget')
  return t('book.detail.editMetadata.formatFilesTarget', { formats: formatWritableFormatList(formats) })
})
const fileWriteManualDisabledReasonLabel = computed(() => {
  if (!primaryFile.value) return t('book.detail.editMetadata.noPrimaryFile')
  switch (fileWriteStatus.value?.reason) {
    case 'no_primary_file':
      return t('book.detail.editMetadata.noPrimaryFile')
    case 'format_not_supported':
      return t('book.detail.editMetadata.formatNotSupported')
    case 'format_disabled':
      return t('book.detail.editMetadata.formatDisabled')
    case 'file_exceeds_size_limit':
      return t('book.detail.editMetadata.fileExceedsSizeLimit')
    default:
      return null
  }
})
const fileWriteManualTooltip = computed(() => {
  if (writingAndRenaming.value) return t('book.detail.editMetadata.writing')
  if (saving.value) return t('book.detail.editMetadata.saveInProgress')
  if (fileWriteManualDisabledReasonLabel.value) return fileWriteManualDisabledReasonLabel.value
  if (fileWriteStatus.value?.reason === 'library_disabled') {
    return t('book.detail.editMetadata.writeManualLibraryDisabled')
  }
  return t('book.detail.editMetadata.writeManualTooltip', { fields: fileWriteFieldCountLabel.value, target: fileWriteTargetSummary.value })
})
const comicSectionOpen = ref(true)

// One source for every text control in this form. Touch targets are 40px on phones and
// tighten to 32px from `sm` up, where the column layout starts and vertical space is scarce.
const FIELD_CONTROL_CLASS =
  'w-full h-10 sm:h-8 rounded-lg border border-input bg-background px-3 pr-11 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed'
const FIELD_CONTROL_MONO_CLASS = `${FIELD_CONTROL_CLASS} font-mono`

const { form, saving, error, isDirty, syncFromBook, reset, save } = useMetadataEditor()
const {
  lockedFields,
  updating: updatingLocks,
  error: lockError,
  areAllLocked,
  locksDirty,
  load: loadLocks,
  reset: resetLocks,
  markPersisted: markLocksPersisted,
  isLocked,
  isUpdating: isUpdatingLock,
  replace: replaceLocks,
  toggle,
  lockAll,
  unlockAll,
} = useMetadataLocks({ deferred: true })
const { search: searchAuthors } = useAuthorSearch()
const { search: searchNarrators } = useNarratorSearch()
const { search: searchGenres } = useGenreSearch()
const { search: searchTags } = useTagSearch()
const { search: searchPublisher } = usePublisherSearch()
const { search: searchSeriesName } = useSeriesNameSearch()
const { search: searchLanguage } = useLanguageSearch()
const searchComicMetadata = async (q: string): Promise<string[]> => (q.trim() ? [] : [])

const coverPanel = ref<InstanceType<typeof CoverEditorPanel> | null>(null)
const searchOpen = ref(false)
const availableMetadataProviders = ref<MetadataProviderInfo[] | null>(null)
const visibleProviderIdFields = computed(() => filterProviderIdFields(availableMetadataProviders.value))
let providerLoadToken = 0

async function loadAvailableMetadataProviders(bookId: number) {
  const token = ++providerLoadToken
  availableMetadataProviders.value = null
  try {
    const res = await api(`/api/v1/metadata-fetch/providers?bookId=${bookId}`)
    if (!res.ok) return
    const providers = (await res.json()) as MetadataProviderInfo[]
    if (token === providerLoadToken) availableMetadataProviders.value = providers
  } catch {
    // non-fatal: keep all provider ID fields visible when provider availability cannot be loaded
  }
}

function setIntField(field: 'publishedYear' | 'pageCount' | 'durationSeconds', e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') {
    form[field] = null
    if (field === 'publishedYear') form.publishedDate = null
    return
  }
  const n = parseInt(val, 10)
  form[field] = isNaN(n) ? null : n
  if (field === 'publishedYear') form.publishedDate = null
}

function setPublishedDateField(e: Event) {
  const value = (e.target as HTMLInputElement).value
  form.publishedDate = value || null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    form.publishedYear = Number(value.slice(0, 4))
  }
}

function isTextLikeCustomField(type: string): boolean {
  return type === 'text' || type === 'url'
}

function setCustomMetadataValue(fieldId: number, value: CustomMetadataPrimitiveValue) {
  const field = form.customMetadata.find((item) => item.fieldId === fieldId)
  if (field) field.value = value
}

function setCustomNumberField(fieldId: number, e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') {
    setCustomMetadataValue(fieldId, null)
    return
  }
  const n = Number(val)
  setCustomMetadataValue(fieldId, Number.isFinite(n) ? n : null)
}

function setCustomTextField(fieldId: number, e: Event) {
  setCustomMetadataValue(fieldId, (e.target as HTMLInputElement).value)
}

function setCustomDateField(fieldId: number, e: Event) {
  const val = (e.target as HTMLInputElement).value
  setCustomMetadataValue(fieldId, val || null)
}

function setCustomBooleanField(fieldId: number, e: Event) {
  setCustomMetadataValue(fieldId, (e.target as HTMLInputElement).checked)
}

let watchedBookId: number | null = null
watch(
  () => props.book,
  (book) => {
    const switchedBook = watchedBookId !== book.id
    syncFromBook(book)
    if (switchedBook || (!saving.value && !locksDirty.value)) loadLocks(book)
    watchedBookId = book.id
  },
  { immediate: true },
)

watch(
  () => props.book.id,
  (bookId) => {
    void loadAvailableMetadataProviders(bookId)
  },
  { immediate: true },
)

// The server names the field it rejected ("amazonId must be shorter than..."), which is the only
// text that tells the user what to fix. It is untranslated, so it is preferred over the generic
// catalog message rather than replacing it.
const saveErrorMessage = computed(() => {
  const failure = error.value
  if (!failure) return null
  if (failure.detail) return failure.detail
  if (failure.status !== null) return t('book.detail.editMetadata.saveFailedWithStatus', { status: failure.status })
  return t('book.detail.editMetadata.saveFailed')
})

const combinedError = computed(() => lockError.value ?? saveErrorMessage.value)

// Fields whose emptiness the toolbar counts. Provider ids are deliberately excluded: most books
// legitimately have none, so counting them would report a gap on every healthy record.
const emptyFields = computed(() => {
  const checks: { label: string; filled: boolean }[] = [
    { label: t('book.detail.editMetadata.publisherLabel'), filled: Boolean(form.publisher?.trim()) },
    { label: t('book.detail.editMetadata.languageLabel'), filled: Boolean(form.language?.trim()) },
    { label: t('book.detail.editMetadata.yearLabel'), filled: form.publishedYear != null },
    { label: t('book.detail.editMetadata.pageCountLabel'), filled: form.pageCount != null },
    { label: t('book.detail.editMetadata.isbn13Label'), filled: Boolean(form.isbn13?.trim()) },
    { label: t('book.detail.editMetadata.isbn10Label'), filled: Boolean(form.isbn10?.trim()) },
    { label: t('book.detail.editMetadata.genresLabel'), filled: form.genres.length > 0 },
    { label: t('book.detail.editMetadata.tagsLabel'), filled: form.tags.length > 0 },
    { label: t('book.detail.editMetadata.descriptionLabel'), filled: Boolean(form.description?.trim()) },
  ]
  return checks.filter((check) => !check.filled).map((check) => check.label)
})
const emptyFieldsTitle = computed(() => t('book.detail.editMetadata.emptyFieldsTooltip', { fields: formatList(emptyFields.value) }))
const metadataScore = computed(() => props.book.metadataScore)
const metadataScoreColour = computed(() => (metadataScore.value == null ? null : metadataScoreColor(metadataScore.value)))

function controlClass(isEmpty: boolean, mono = false): string {
  const base = mono ? FIELD_CONTROL_MONO_CLASS : FIELD_CONTROL_CLASS
  // Shape, not colour: an unset field reads as a dashed outline in every theme and for
  // anyone who cannot separate the amber accent from the default border.
  return isEmpty ? `${base} border-dashed` : base
}

const filledProviderIdSummary = computed(() => {
  const filled = visibleProviderIdFields.value.filter((entry) => {
    const value = form[entry.field]
    return typeof value === 'string' && value.trim().length > 0
  }).length
  return `${filled}/${visibleProviderIdFields.value.length}`
})

const comicCreditFields = computed(
  () =>
    [
      { field: 'comicPencillers', label: t('book.detail.editMetadata.comicPencillersLabel') },
      { field: 'comicInkers', label: t('book.detail.editMetadata.comicInkersLabel') },
      { field: 'comicColorists', label: t('book.detail.editMetadata.comicColoristsLabel') },
      { field: 'comicLetterers', label: t('book.detail.editMetadata.comicLetterersLabel') },
      { field: 'comicTeams', label: t('book.detail.editMetadata.comicTeamsLabel') },
      { field: 'comicLocations', label: t('book.detail.editMetadata.comicLocationsLabel') },
    ] as const,
)

const comicWideFields = computed(
  () =>
    [
      { field: 'comicCoverArtists', label: t('book.detail.editMetadata.comicCoverArtistsLabel') },
      { field: 'comicCharacters', label: t('book.detail.editMetadata.comicCharactersLabel') },
    ] as const,
)

const hasLockedFields = computed(() => lockedFields.value.length > 0)
const hasPendingChanges = computed(() => isDirty.value || locksDirty.value)
const hasInvalidSeriesIndex = computed(() =>
  form.seriesMemberships.some((membership) => membership.seriesIndex !== null && !isValidSeriesIndex(membership.seriesIndex)),
)
const isSeriesLocked = computed(() => isLocked('seriesName') || isLocked('seriesIndex'))
const communityRatingLines = computed(() =>
  form.communityRatings.map((rating) => formatCommunityRatingLine(rating, availableMetadataProviders.value ?? [])),
)

async function submit() {
  if (submitDisabled.value) return
  if (coverPanel.value?.hasPending) {
    const ok = await coverPanel.value.confirm()
    if (ok) emit('coverChanged', 'custom')
  }
  const locksChanged = locksDirty.value
  const result = await save(props.book.id, lockedFields.value)
  if (result) {
    markLocksPersisted(result.book.lockedFields)
    emit('saved', result.book)
    if (locksChanged) emit('locksChanged', result.book.lockedFields)
    showSaveResultToast(result.write, result.libraryAutoWriteEnabled)
  }
}

function handleReset() {
  reset()
  resetLocks()
}

const hoverRating = ref<number | null>(null)
const displayRating = computed(() => hoverRating.value ?? form.rating)

function setRating(star: number) {
  form.rating = form.rating === star ? null : star
}

function clearRating() {
  form.rating = null
}

function handleDescriptionLockToggle() {
  void handleLockToggle('description')
}

function handleCloseSearch() {
  searchOpen.value = false
}

function setHoverRating(star: number) {
  hoverRating.value = star
}

function clearHoverRating() {
  hoverRating.value = null
}

function formatWritableFormatList(formats: string[]): string {
  const labels = formats.map((format) => format.toUpperCase())
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

function toggleComicSection() {
  comicSectionOpen.value = !comicSectionOpen.value
}

function trackLockedField(field: BookMetadataLockField, skippedFields: BookMetadataLockField[]) {
  if (!skippedFields.includes(field)) {
    skippedFields.push(field)
  }
}

const normalizeSeriesIndex = parseSeriesIndex

function setSeriesMemberships(memberships: EditableSeriesMembership[]) {
  form.seriesMemberships = memberships
  const primary = memberships.find((membership) => membership.seriesName.trim())
  form.seriesName = primary?.seriesName.trim() || null
  form.seriesIndex = primary?.seriesIndex ?? null
}

function handleSeriesMembershipsUpdate(memberships: EditableSeriesMembership[]) {
  setSeriesMemberships(memberships)
}

function applyPrimarySeriesPatch(field: 'seriesName' | 'seriesIndex', value: unknown, skippedFields: BookMetadataLockField[]): boolean {
  if (isSeriesLocked.value) {
    if (isLocked('seriesName')) trackLockedField('seriesName', skippedFields)
    if (isLocked('seriesIndex')) trackLockedField('seriesIndex', skippedFields)
    return false
  }

  const next = [...form.seriesMemberships]
  const primary = next[0] ?? { seriesName: form.seriesName ?? '', seriesIndex: form.seriesIndex ?? null, expectedBookCount: null }
  const patched =
    field === 'seriesName'
      ? { ...primary, seriesName: typeof value === 'string' ? value : value == null ? '' : String(value) }
      : { ...primary, seriesIndex: normalizeSeriesIndex(value) }

  if (next.length > 0) {
    next[0] = patched
  } else {
    next.push(patched)
  }
  setSeriesMemberships(next)
  return true
}

function applySeriesMembershipPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  if (formPatch.seriesMemberships === undefined) return 0
  if (isSeriesLocked.value) {
    if (isLocked('seriesName')) trackLockedField('seriesName', skippedFields)
    if (isLocked('seriesIndex')) trackLockedField('seriesIndex', skippedFields)
    return 0
  }

  // Providers do not report series length in this patch, so carry the current value across
  // rather than letting an applied suggestion silently clear a total someone entered.
  const totalsByName = new Map(form.seriesMemberships.map((m) => [m.seriesName.trim().toLowerCase(), m.expectedBookCount ?? null]))

  setSeriesMemberships(
    normalizeSeriesMemberships(
      (formPatch.seriesMemberships ?? []).map((membership) => ({
        seriesName: membership.seriesName,
        seriesIndex: normalizeSeriesIndex(membership.seriesIndex),
        expectedBookCount: totalsByName.get(membership.seriesName.trim().toLowerCase()) ?? null,
      })),
    ),
  )
  return 1
}

function normalizeCommunityRatingPatchItem(rating: NonNullable<MetadataPatch['communityRatings']>[number]): BookCommunityRating | null {
  if (!Number.isFinite(rating.rating) || rating.rating < 0 || rating.rating > 5) return null
  const ratingCount =
    typeof rating.ratingCount === 'number' && Number.isInteger(rating.ratingCount) && rating.ratingCount >= 0 ? rating.ratingCount : null
  return {
    provider: rating.provider,
    rating: rating.rating,
    ratingCount,
    updatedAt: null,
  }
}

function applyCommunityRatingPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  if (formPatch.communityRatings === undefined) return 0
  if (isLocked('communityRating')) {
    trackLockedField('communityRating', skippedFields)
    return 0
  }

  const byProvider = new Map(form.communityRatings.map((rating) => [rating.provider, rating]))
  let updated = 0
  for (const patchRating of formPatch.communityRatings) {
    const normalized = normalizeCommunityRatingPatchItem(patchRating)
    if (!normalized) continue
    byProvider.set(normalized.provider, normalized)
    updated++
  }
  form.communityRatings = [...byProvider.values()]
  return updated > 0 ? 1 : 0
}

function applyDirectPatchField(field: (typeof DIRECT_PATCH_FIELDS)[number], value: unknown, skippedFields: BookMetadataLockField[]): boolean {
  if (value === undefined) return false
  if (isProviderIdFormField(field) && !isProviderIdFieldAvailable(field, availableMetadataProviders.value)) return false
  if (field === 'seriesName' || field === 'seriesIndex') {
    return applyPrimarySeriesPatch(field, value, skippedFields)
  }
  if (isLocked(field)) {
    trackLockedField(field, skippedFields)
    return false
  }
  form[field] = value as never
  return true
}

function applyPublishedPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  if (formPatch.publishedDate === undefined && formPatch.publishedYear === undefined) return 0
  if (isLocked('publishedYear')) {
    trackLockedField('publishedYear', skippedFields)
    return 0
  }
  if (formPatch.publishedDate !== undefined) form.publishedDate = formPatch.publishedDate
  if (formPatch.publishedYear !== undefined) form.publishedYear = formPatch.publishedYear
  return 1
}

function applyComicPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  if (!formPatch.comicMetadata) return 0
  let updated = 0
  for (const [comicKey, formKey] of Object.entries(COMIC_FIELD_MAP) as [
    keyof typeof COMIC_FIELD_MAP,
    (typeof COMIC_FIELD_MAP)[keyof typeof COMIC_FIELD_MAP],
  ][]) {
    const value = formPatch.comicMetadata[comicKey]
    if (value === undefined) continue
    if (isLocked(formKey)) {
      trackLockedField(formKey, skippedFields)
      continue
    }
    form[formKey] = value as never
    updated++
  }
  return updated
}

function applyAudioPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  let updated = 0
  if (formPatch.narrators !== undefined) {
    if (isLocked('narrators')) {
      trackLockedField('narrators', skippedFields)
    } else {
      form.narrators = formPatch.narrators
      updated++
    }
  }
  if (formPatch.durationSeconds !== undefined) {
    if (isLocked('durationSeconds')) {
      trackLockedField('durationSeconds', skippedFields)
    } else {
      form.durationSeconds = formPatch.durationSeconds
      updated++
    }
  }
  if (formPatch.abridged !== undefined) {
    if (isLocked('abridged')) {
      trackLockedField('abridged', skippedFields)
    } else {
      form.abridged = formPatch.abridged
      updated++
    }
  }
  return updated
}

function applyCustomMetadataPatch(formPatch: MetadataPatch): number {
  if (!formPatch.customMetadata) return 0
  let updated = 0
  for (const value of formPatch.customMetadata) {
    const field = form.customMetadata.find((item) => item.fieldId === value.fieldId)
    if (!field) continue
    field.value = value.value
    updated++
  }
  return updated
}

function applyPatchToForm(formPatch: MetadataPatch, coverUrl: string | undefined): { skippedFields: BookMetadataLockField[]; updatedCount: number } {
  const skippedFields: BookMetadataLockField[] = []
  let updatedCount = 0
  const hasSeriesMembershipPatch = formPatch.seriesMemberships !== undefined
  updatedCount += applySeriesMembershipPatch(formPatch, skippedFields)
  updatedCount += applyCommunityRatingPatch(formPatch, skippedFields)
  updatedCount += applyPublishedPatch(formPatch, skippedFields)
  for (const field of DIRECT_PATCH_FIELDS) {
    if (hasSeriesMembershipPatch && (field === 'seriesName' || field === 'seriesIndex')) continue
    if (applyDirectPatchField(field, formPatch[field], skippedFields)) updatedCount++
  }
  updatedCount += applyComicPatch(formPatch, skippedFields)
  updatedCount += applyAudioPatch(formPatch, skippedFields)
  updatedCount += applyCustomMetadataPatch(formPatch)

  if (coverUrl) {
    if (isLocked('cover')) {
      trackLockedField('cover', skippedFields)
    } else {
      coverPanel.value?.setUrl(coverUrl)
      updatedCount++
    }
  }

  return { skippedFields, updatedCount }
}

function showApplyResult(skippedFields: BookMetadataLockField[], updatedCount: number) {
  if (skippedFields.length === 0) return
  const skippedPart = t('book.detail.editMetadata.skippedLockedFields', { count: skippedFields.length })
  const updatedPart = t('book.detail.editMetadata.updatedFields', { count: updatedCount })
  toast.info(t('book.detail.editMetadata.applyResult', { skipped: skippedPart, updated: updatedPart }))
}

function handleApply({ formPatch, coverUrl }: { formPatch: MetadataPatch; coverUrl?: string }) {
  if (formDisabled.value) return
  const { skippedFields, updatedCount } = applyPatchToForm(formPatch, coverUrl)
  showApplyResult(skippedFields, updatedCount)
}

function handleOpenSearch() {
  if (formDisabled.value) return
  searchOpen.value = true
}

const { refreshing: autoFilling, previewRefresh } = useRefreshMetadata()
const { loading: loadingFromFile, loadFromFile } = useFileMetadata()
const {
  loading: writingAndRenaming,
  result: writeAndRenameResult,
  error: writeAndRenameError,
  writeAndRename,
  dismiss: dismissWriteAndRenameResult,
} = useWriteAndRename()
const coverMutationPending = computed(() => Boolean(coverPanel.value?.busy))
const formMutationPending = computed(() => autoFilling.value || loadingFromFile.value || coverMutationPending.value)
const formDisabled = computed(() => saving.value || writingAndRenaming.value || formMutationPending.value)
const submitDisabled = computed(() => formDisabled.value || !hasPendingChanges.value || hasInvalidSeriesIndex.value)
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function pluralizeField(count: number): string {
  return t('book.detail.editMetadata.fieldCount', { count })
}

function truncateReason(reason: string | null | undefined): string {
  if (!reason) return ''
  return reason.length > 140 ? `${reason.slice(0, 137)}...` : reason
}

function showWriteResultToast(result: Pick<WriteResult, 'status' | 'fieldsWritten' | 'reason'>): void {
  if (result.status === 'success') {
    toast.success(t('book.detail.editMetadata.wroteFieldsToFile', { fields: pluralizeField(result.fieldsWritten.length) }))
    return
  }

  const reason = truncateReason(result.reason)
  if (result.status === 'failed') {
    toast.error(reason ? t('book.detail.editMetadata.fileWriteFailedReason', { reason }) : t('book.detail.editMetadata.fileWriteFailed'))
    return
  }

  toast.info(reason ? t('book.detail.editMetadata.fileWriteSkippedReason', { reason }) : t('book.detail.editMetadata.fileWriteSkipped'))
}

function showSaveResultToast(write: WriteResult | null, libraryAutoWriteEnabled: boolean): void {
  if (!write || (!libraryAutoWriteEnabled && write.status === 'skipped')) {
    toast.success(t('book.detail.editMetadata.metadataSaved'))
    return
  }

  if (write.status === 'success') {
    toast.success(t('book.detail.editMetadata.metadataWrittenToFile'))
    return
  }

  const reason = truncateReason(write.reason)
  if (write.status === 'failed') {
    toast.error(reason ? t('book.detail.editMetadata.savedButWriteFailedReason', { reason }) : t('book.detail.editMetadata.savedButWriteFailed'))
    return
  }

  toast.info(reason ? t('book.detail.editMetadata.savedWriteSkippedReason', { reason }) : t('book.detail.editMetadata.savedWriteSkipped'))
}

function buildPreviewPatch(preview: MetadataRefreshPreview): MetadataPatch {
  return {
    title: preview.title,
    subtitle: preview.subtitle,
    description: preview.description,
    authors: preview.authors,
    genres: preview.genres,
    publisher: preview.publisher,
    publishedDate: preview.publishedDate,
    publishedYear: preview.publishedYear,
    language: preview.language,
    pageCount: preview.pageCount,
    communityRatings: preview.communityRatings,
    seriesName: preview.seriesName,
    seriesIndex: preview.seriesIndex,
    seriesMemberships: preview.seriesMemberships,
    googleBooksId: preview.googleBooksId,
    goodreadsId: preview.goodreadsId,
    amazonId: preview.amazonId,
    hardcoverId: preview.hardcoverId,
    hardcoverEditionId: preview.hardcoverEditionId,
    openLibraryId: preview.openLibraryId,
    itunesId: preview.itunesId,
    audibleId: preview.audibleId,
    librofmId: preview.librofmId,
    koboId: preview.koboId,
    comicvineId: preview.comicvineId,
    ranobedbId: preview.ranobedbId,
    lubimyczytacId: preview.lubimyczytacId,
    aladinId: preview.aladinId,
    mangabakaId: preview.mangabakaId,
    mangabakaSeriesId: preview.mangabakaSeriesId,
    comicMetadata: preview.comicMetadata,
    narrators: preview.audioMetadata?.narrators,
    durationSeconds: preview.audioMetadata?.durationSeconds ?? undefined,
    abridged: preview.audioMetadata?.abridged ?? undefined,
  }
}

async function autoFill() {
  if (formDisabled.value) return
  const result = await previewRefresh(props.book.id)
  if (formDisabled.value) return
  if (!result) {
    toast.error('Auto-fill failed')
    return
  }

  const preview = result.metadata
  if (Object.keys(preview).length === 0) {
    toast.info(metadataRefreshEmptyMessage(result.diagnostics, props.book), { closeButton: true, duration: AUTO_FILL_EMPTY_TOAST_DURATION_MS })
    return
  }

  const { skippedFields, updatedCount } = applyPatchToForm(buildPreviewPatch(preview), preview.coverUrl)
  if (skippedFields.length > 0) {
    showApplyResult(skippedFields, updatedCount)
    return
  }
  toast.success(metadataRefreshAppliedMessage(result.diagnostics, updatedCount), {
    closeButton: result.diagnostics.enabledUnreferencedProviders.length > 0,
    duration: result.diagnostics.enabledUnreferencedProviders.length > 0 ? AUTO_FILL_EMPTY_TOAST_DURATION_MS : undefined,
  })
}

function applyFileMetadataToForm(meta: FileMetadata): number {
  const { updatedCount } = applyPatchToForm(buildFileMetadataPatch(meta), undefined)
  return updatedCount
}

async function handleLoadFromFile() {
  if (formDisabled.value) return
  const meta = await loadFromFile(props.book.id)
  if (formDisabled.value) return
  if (!meta) {
    toast.error(t('book.detail.editMetadata.loadFromFileFailed'))
    return
  }
  const count = applyFileMetadataToForm(meta)
  toast.info(count > 0 ? t('book.detail.editMetadata.loadedFieldsFromFile', { count }) : t('book.detail.editMetadata.noMetadataInFile'))
}

async function handleWriteAndRename() {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
  const res = await writeAndRename(props.book.id)
  if (!res) return
  showWriteResultToast(res.write)

  if (res.rename.status === 'success') emit('fileRenamed')

  const isFullSuccess =
    res.write.status === 'success' && (res.rename.status === 'success' || (res.rename.status === 'skipped' && res.rename.reason === 'path unchanged'))
  const hasWarning = !res.libraryAutoWriteEnabled || !res.libraryAutoRenameEnabled

  if (isFullSuccess && !hasWarning) {
    dismissTimer = setTimeout(() => {
      dismissWriteAndRenameResult()
      dismissTimer = null
    }, 4000)
  }
}

onBeforeUnmount(() => {
  if (dismissTimer !== null) clearTimeout(dismissTimer)
})

async function handleLockToggle(field: BookMetadataLockField) {
  if (formDisabled.value) return
  await toggle(props.book.id, field)
}

async function handleSeriesLockToggle() {
  const seriesFields: BookMetadataLockField[] = ['seriesName', 'seriesIndex']
  const next = isSeriesLocked.value
    ? lockedFields.value.filter((field) => !seriesFields.includes(field))
    : [...new Set([...lockedFields.value, ...seriesFields])]
  await replaceLocks(props.book.id, next, 'seriesName')
}

function handleCoverLockToggle() {
  handleLockToggle('cover')
}

async function handleLockAll() {
  if (formDisabled.value) return
  await lockAll(props.book.id)
}

async function handleUnlockAll() {
  if (formDisabled.value) return
  await unlockAll(props.book.id)
}

function handleCoverChanged(source: 'extracted' | 'custom' | null) {
  emit('coverChanged', source)
}
</script>

<template>
  <!-- The pane width depends on the sidebar, not the viewport, so every breakpoint below is a
       container query on this element. `edit` sizes the page; `catalog` sizes the identifier list. -->
  <div class="@container/edit flex min-h-full min-w-0 flex-col">
    <div class="flex flex-1 flex-col gap-3">
      <!-- Command strip -->
      <div class="flex flex-none items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-0.5 sm:mx-0 sm:px-0 @3xl/edit:overflow-visible">
        <div
          v-if="metadataScore !== null"
          class="flex h-9 flex-none items-center gap-2 rounded-lg border border-border bg-card px-2.5 sm:h-8"
          :title="t('book.detail.editMetadata.scoreTooltip', { score: metadataScore })"
        >
          <span class="text-[10px] font-bold tracking-[0.11em] text-muted-foreground uppercase">{{ t('book.detail.editMetadata.score') }}</span>
          <span class="text-sm font-bold tabular-nums" :style="{ color: metadataScoreColour ?? undefined }">{{ metadataScore }}</span>
          <span class="h-1 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span class="block h-full rounded-full" :style="{ width: `${metadataScore}%`, backgroundColor: metadataScoreColour ?? undefined }" />
          </span>
        </div>

        <button
          v-if="emptyFields.length > 0"
          type="button"
          class="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-500/15 sm:h-8 dark:text-amber-400"
          :title="emptyFieldsTitle"
          @click="handleOpenSearch"
        >
          <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{{ emptyFields.length }}</span>
          <span class="hidden @3xl/edit:inline">{{ t('book.detail.editMetadata.emptyFields', { count: emptyFields.length }) }}</span>
        </button>

        <div class="flex-1" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-sm transition-colors hover:bg-muted disabled:opacity-40 sm:h-8 sm:px-3"
              :disabled="formDisabled || loadingFromFile || !primaryFile"
              :aria-label="t('book.detail.editMetadata.loadFromFile')"
              @click="handleLoadFromFile"
            >
              <Loader2 v-if="loadingFromFile" class="size-3.5 animate-spin" aria-hidden="true" />
              <HardDriveUpload v-else class="size-3.5" aria-hidden="true" />
              <span class="hidden @3xl/edit:inline">{{ t('book.detail.editMetadata.loadFromFile') }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{
            loadingFromFile
              ? t('common.loading')
              : !primaryFile
                ? t('book.detail.editMetadata.noPrimaryFile')
                : t('book.detail.editMetadata.loadFromFileTooltip')
          }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-sm transition-colors hover:bg-muted disabled:opacity-40 sm:h-8 sm:px-3"
              :disabled="writingAndRenaming || saving || fileWriteManualDisabledReasonLabel !== null"
              :aria-label="t('book.detail.editMetadata.writeAndRename')"
              @click="handleWriteAndRename"
            >
              <Loader2 v-if="writingAndRenaming" class="size-3.5 animate-spin" aria-hidden="true" />
              <HardDriveDownload v-else class="size-3.5" aria-hidden="true" />
              <span class="hidden @3xl/edit:inline">{{ t('book.detail.editMetadata.writeAndRename') }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ fileWriteManualTooltip }}</TooltipContent>
        </Tooltip>

        <div class="mx-0.5 h-4 w-px flex-none bg-border" aria-hidden="true" />

        <button
          class="search-online-btn flex h-9 flex-none items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary-foreground transition-all sm:h-8"
          :disabled="formDisabled"
          :aria-label="t('common.search')"
          @click="handleOpenSearch"
        >
          <Sparkles class="size-3.5" aria-hidden="true" />
          <span class="hidden @3xl/edit:inline">{{ t('common.search') }}</span>
        </button>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="auto-fill-btn flex h-9 flex-none items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-all disabled:opacity-40 sm:h-8 sm:px-3"
              :disabled="formDisabled || autoFilling || areAllLocked"
              :aria-label="t('book.detail.editMetadata.autoFill')"
              @click="autoFill"
            >
              <Loader2 v-if="autoFilling" class="size-3.5 animate-spin" aria-hidden="true" />
              <RefreshCw v-else class="size-3.5" aria-hidden="true" />
              <span class="hidden @3xl/edit:inline">{{ t('book.detail.editMetadata.autoFill') }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{
            autoFilling
              ? t('book.detail.editMetadata.fetchingMetadata')
              : areAllLocked
                ? t('book.detail.editMetadata.allFieldsLocked')
                : t('book.detail.editMetadata.autoFillTooltip')
          }}</TooltipContent>
        </Tooltip>

        <div class="mx-0.5 h-4 w-px flex-none bg-border" aria-hidden="true" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex size-9 flex-none items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-muted disabled:opacity-40 sm:size-8"
              :disabled="formDisabled || updatingLocks || areAllLocked"
              :aria-label="t('book.detail.editMetadata.lockAll')"
              @click="handleLockAll"
            >
              <Lock class="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.editMetadata.lockAllTooltip') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex size-9 flex-none items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-muted disabled:opacity-40 sm:size-8"
              :disabled="formDisabled || updatingLocks || !hasLockedFields"
              :aria-label="t('book.detail.editMetadata.unlockAll')"
              @click="handleUnlockAll"
            >
              <LockOpen class="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.editMetadata.unlockAllTooltip') }}</TooltipContent>
        </Tooltip>

        <div class="mx-0.5 hidden h-4 w-px flex-none bg-border lg:block" aria-hidden="true" />

        <button
          class="hidden size-9 flex-none items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-muted disabled:opacity-40 sm:size-8 lg:flex"
          :title="t('common.cancel')"
          :aria-label="t('common.cancel')"
          :disabled="submitDisabled"
          @click="handleReset"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
        <button
          class="hidden h-9 flex-none grid-cols-1 grid-rows-1 items-center justify-items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 sm:h-8 lg:inline-grid"
          :disabled="submitDisabled"
          @click="submit"
        >
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: saving }">
            <Check class="size-3.5" aria-hidden="true" />
            {{ t('common.save') }}
          </span>
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: !saving }">
            <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
            {{ t('book.detail.editMetadata.saving') }}
          </span>
        </button>
      </div>

      <p v-if="combinedError" role="alert" class="flex-none text-sm text-destructive">{{ combinedError }}</p>

      <WriteAndRenameResultPanel
        v-if="writeAndRenameResult || writeAndRenameError"
        class="flex-none"
        :result="
          writeAndRenameResult ?? {
            write: { status: 'failed', fieldsWritten: [], durationMs: 0, reason: writeAndRenameError ?? 'Unknown error' },
            rename: { status: 'skipped', durationMs: 0, reason: 'not attempted' },
            libraryAutoWriteEnabled: true,
            libraryAutoRenameEnabled: true,
          }
        "
        @dismiss="dismissWriteAndRenameResult"
      />

      <!-- Columns. 1 up on phones, 2 from @xl, 3 from @3xl, 4 (and a fixed-height, non-scrolling
           page) from @5xl. Only the @5xl layout promises the whole record without page scroll. -->
      <div
        class="grid grid-cols-1 gap-3 @5xl/edit:flex-1 @xl/edit:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] @3xl/edit:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1.1fr)] @5xl/edit:grid-cols-[12.75rem_minmax(0,1.3fr)_minmax(0,0.88fr)_minmax(0,1.25fr)]"
      >
        <fieldset :disabled="formDisabled" class="contents">
          <!-- Artwork and source -->
          <div class="flex flex-col gap-2.5">
            <CoverEditorPanel
              ref="coverPanel"
              :book="props.book"
              :locked="isLocked('cover')"
              :disabled="formDisabled"
              @cover-changed="handleCoverChanged"
              @toggle-lock="handleCoverLockToggle"
            />
            <MetadataSourceCard :book="props.book" class="hidden @5xl/edit:flex @5xl/edit:flex-1" />
          </div>

          <!-- Identity -->
          <section class="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            <header class="flex h-7 flex-none items-center border-b border-border px-2.5">
              <h3 class="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('book.detail.editMetadata.identityCard') }}
              </h3>
            </header>
            <div class="flex flex-1 flex-col gap-2.5 p-2.5">
              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.titleLabel')"
                field="title"
                :locked="isLocked('title')"
                :is-updating="isUpdatingLock"
                @toggle="handleLockToggle"
              >
                <input v-model="form.title" :class="FIELD_CONTROL_CLASS" :disabled="isLocked('title')" />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.subtitleLabel')"
                field="subtitle"
                :locked="isLocked('subtitle')"
                :is-updating="isUpdatingLock"
                @toggle="handleLockToggle"
              >
                <input v-model="form.subtitle" :class="FIELD_CONTROL_CLASS" :disabled="isLocked('subtitle')" />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.authorsLabel')"
                field="authors"
                :locked="isLocked('authors')"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleLockToggle"
              >
                <ChipInput v-model="form.authors" :search-fn="searchAuthors" :disabled="isLocked('authors')" control-class="pr-11" />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                v-if="isPrimaryAudio"
                :label="t('book.detail.editMetadata.narratorsLabel')"
                field="narrators"
                :locked="isLocked('narrators')"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleLockToggle"
              >
                <ChipInput v-model="form.narrators" :search-fn="searchNarrators" :disabled="isLocked('narrators')" control-class="pr-11" />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.seriesLabel')"
                field="seriesName"
                :locked="isSeriesLocked"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleSeriesLockToggle"
              >
                <SeriesMembershipEditor
                  class="pr-9"
                  :model-value="form.seriesMemberships"
                  :search-fn="searchSeriesName"
                  :disabled="isSeriesLocked"
                  @update:model-value="handleSeriesMembershipsUpdate"
                />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.publisherLabel')"
                field="publisher"
                :locked="isLocked('publisher')"
                :is-updating="isUpdatingLock"
                @toggle="handleLockToggle"
              >
                <InputWithSuggestions
                  v-model="form.publisher"
                  :search-fn="searchPublisher"
                  :disabled="isLocked('publisher')"
                  :class="FIELD_CONTROL_CLASS"
                />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.genresLabel')"
                field="genres"
                :locked="isLocked('genres')"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleLockToggle"
              >
                <ChipInput v-model="form.genres" :search-fn="searchGenres" :disabled="isLocked('genres')" control-class="pr-11" />
              </MetadataFieldLabel>

              <MetadataFieldLabel
                :label="t('book.detail.editMetadata.tagsLabel')"
                field="tags"
                :locked="isLocked('tags')"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleLockToggle"
              >
                <ChipInput v-model="form.tags" :search-fn="searchTags" :disabled="isLocked('tags')" control-class="pr-11" />
              </MetadataFieldLabel>

              <div v-if="form.customMetadata.length > 0" class="grid grid-cols-1 gap-2.5 border-t border-border pt-2.5 @sm/edit:grid-cols-2">
                <label v-for="field in form.customMetadata" :key="field.fieldId" class="space-y-1">
                  <span class="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{ field.label }}</span>
                  <input
                    v-if="isTextLikeCustomField(field.type)"
                    :value="typeof field.value === 'string' ? field.value : ''"
                    :type="field.type === 'url' ? 'url' : 'text'"
                    class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-shadow outline-none focus:ring-1 focus:ring-ring sm:h-8"
                    @input="setCustomTextField(field.fieldId, $event)"
                  />
                  <input
                    v-else-if="field.type === 'number'"
                    :value="typeof field.value === 'number' ? field.value : ''"
                    type="number"
                    class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-shadow outline-none focus:ring-1 focus:ring-ring sm:h-8"
                    @input="setCustomNumberField(field.fieldId, $event)"
                  />
                  <input
                    v-else-if="field.type === 'date'"
                    :value="typeof field.value === 'string' ? field.value : ''"
                    type="date"
                    class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-shadow outline-none focus:ring-1 focus:ring-ring sm:h-8"
                    @input="setCustomDateField(field.fieldId, $event)"
                  />
                  <span v-else class="flex h-10 items-center rounded-lg border border-input bg-background px-3 sm:h-8">
                    <input
                      type="checkbox"
                      class="size-4 rounded border-input accent-primary"
                      :checked="field.value === true"
                      :aria-label="field.label"
                      @change="setCustomBooleanField(field.fieldId, $event)"
                    />
                  </span>
                </label>
              </div>
            </div>
          </section>

          <!-- Catalog -->
          <section
            class="@container/catalog flex flex-col overflow-hidden rounded-xl border border-border bg-card @xl/edit:col-span-2 @3xl/edit:col-span-1"
          >
            <header class="flex h-7 flex-none items-center border-b border-border px-2.5">
              <h3 class="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('book.detail.editMetadata.catalogCard') }}
              </h3>
            </header>
            <div class="flex flex-1 flex-col gap-2.5 p-2.5">
              <div class="grid grid-cols-2 gap-2.5">
                <MetadataFieldLabel
                  class="col-span-2"
                  :label="t('book.detail.editMetadata.languageLabel')"
                  field="language"
                  :locked="isLocked('language')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <InputWithSuggestions
                    v-model="form.language"
                    :search-fn="searchLanguage"
                    :disabled="isLocked('language')"
                    :maxlength="10"
                    :class="controlClass(!form.language)"
                  />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  class="col-span-2"
                  :label="t('bookDock.field.publishedDate')"
                  field="publishedYear"
                  :locked="isLocked('publishedYear')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input
                    :value="form.publishedDate ?? ''"
                    type="date"
                    :class="controlClass(!form.publishedDate)"
                    :disabled="isLocked('publishedYear')"
                    @input="setPublishedDateField"
                  />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  :label="t('book.detail.editMetadata.yearLabel')"
                  field="publishedYear"
                  :locked="isLocked('publishedYear')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input
                    :value="form.publishedYear ?? ''"
                    type="number"
                    min="1"
                    max="2100"
                    :class="controlClass(form.publishedYear == null)"
                    :disabled="isLocked('publishedYear')"
                    @input="setIntField('publishedYear', $event)"
                  />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  :label="t('book.detail.editMetadata.pageCountLabel')"
                  field="pageCount"
                  :locked="isLocked('pageCount')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input
                    :value="form.pageCount ?? ''"
                    type="number"
                    min="1"
                    :class="controlClass(form.pageCount == null)"
                    :disabled="isLocked('pageCount')"
                    @input="setIntField('pageCount', $event)"
                  />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  class="col-span-2"
                  :label="t('book.detail.editMetadata.isbn13Label')"
                  field="isbn13"
                  :locked="isLocked('isbn13')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input v-model="form.isbn13" maxlength="13" :class="controlClass(!form.isbn13, true)" :disabled="isLocked('isbn13')" />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  class="col-span-2"
                  :label="t('book.detail.editMetadata.isbn10Label')"
                  field="isbn10"
                  :locked="isLocked('isbn10')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input v-model="form.isbn10" maxlength="10" :class="controlClass(!form.isbn10, true)" :disabled="isLocked('isbn10')" />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  v-if="isPrimaryAudio"
                  :label="t('book.detail.editMetadata.durationLabel')"
                  field="durationSeconds"
                  :locked="isLocked('durationSeconds')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <input
                    :value="form.durationSeconds ?? ''"
                    type="number"
                    min="1"
                    :class="controlClass(form.durationSeconds == null)"
                    :disabled="isLocked('durationSeconds')"
                    @input="setIntField('durationSeconds', $event)"
                  />
                </MetadataFieldLabel>

                <MetadataFieldLabel
                  v-if="isPrimaryAudio"
                  :label="t('book.detail.editMetadata.abridgedLabel')"
                  field="abridged"
                  :locked="isLocked('abridged')"
                  :is-updating="isUpdatingLock"
                  @toggle="handleLockToggle"
                >
                  <span
                    class="flex h-10 items-center rounded-lg border border-input bg-background px-3 pr-11 sm:h-8"
                    :class="isLocked('abridged') ? 'cursor-not-allowed opacity-50' : ''"
                  >
                    <input
                      v-model="form.abridged"
                      type="checkbox"
                      class="size-4 rounded border-input accent-primary"
                      :aria-label="t('book.detail.editMetadata.abridgedLabel')"
                      :disabled="isLocked('abridged')"
                    />
                  </span>
                </MetadataFieldLabel>
              </div>

              <MetadataFieldLabel
                class="col-span-2"
                :label="t('book.detail.editMetadata.ratingLabel')"
                field="rating"
                :locked="isLocked('rating')"
                :is-updating="isUpdatingLock"
                @toggle="handleLockToggle"
              >
                <div
                  class="flex h-10 items-center gap-0.5 rounded-lg border border-input bg-background px-2 pr-11 sm:h-8"
                  :class="isLocked('rating') ? 'cursor-not-allowed opacity-50' : ''"
                  @mouseleave="clearHoverRating"
                >
                  <Tooltip v-for="star in RATING_STARS" :key="star">
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="p-1 transition-colors disabled:opacity-50 sm:p-0.5"
                        :disabled="isLocked('rating')"
                        :aria-label="t('book.detail.editMetadata.rateStar', { star })"
                        @mouseenter="setHoverRating(star)"
                        @click="setRating(star)"
                      >
                        <Star class="size-5 sm:size-4" :class="getRatingStarClass(star, displayRating)" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('book.detail.editMetadata.rateStar', { star }) }}</TooltipContent>
                  </Tooltip>
                  <button
                    v-if="form.rating"
                    type="button"
                    class="ml-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    :disabled="isLocked('rating')"
                    @click="clearRating"
                  >
                    {{ t('book.detail.editMetadata.clear') }}
                  </button>
                </div>
              </MetadataFieldLabel>

              <div v-if="visibleProviderIdFields.length > 0" class="col-span-2 flex flex-col gap-1 border-t border-border pt-2.5">
                <div class="flex items-center gap-2">
                  <h4 class="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
                    {{ t('book.detail.editMetadata.providerIds') }}
                  </h4>
                  <span class="text-[10px] font-semibold text-muted-foreground">{{ filledProviderIdSummary }}</span>
                </div>
                <div class="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-x-4">
                  <div v-for="{ field, label } in visibleProviderIdFields" :key="field" class="flex items-center gap-2 border-b border-border/60">
                    <label
                      :for="`provider-id-${field}`"
                      class="w-[5.25rem] shrink-0 truncate text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                      :title="label"
                    >
                      {{ label }}
                    </label>
                    <input
                      :id="`provider-id-${field}`"
                      v-model="form[field]"
                      class="h-8 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 font-mono text-xs transition-shadow outline-none hover:border-input focus:border-input focus:bg-background focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-7"
                      :disabled="isLocked(field)"
                    />
                    <button
                      type="button"
                      class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-not-allowed"
                      :class="
                        isLocked(field)
                          ? 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/25'
                          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                      "
                      :aria-label="
                        isLocked(field)
                          ? t('book.detail.editMetadata.unlockField', { field: label })
                          : t('book.detail.editMetadata.lockField', { field: label })
                      "
                      :disabled="isUpdatingLock(field)"
                      @click="handleLockToggle(field)"
                    >
                      <Loader2 v-if="isUpdatingLock(field)" class="size-3 animate-spin" aria-hidden="true" />
                      <Lock v-else-if="isLocked(field)" class="size-3" aria-hidden="true" />
                      <LockOpen v-else class="size-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              <MetadataFieldLabel
                class="col-span-2"
                :label="t('book.detail.editMetadata.communityRatingsLabel')"
                field="communityRating"
                :locked="isLocked('communityRating')"
                :is-updating="isUpdatingLock"
                multiline
                @toggle="handleLockToggle"
              >
                <div class="min-h-10 rounded-lg border border-input bg-background px-3 py-2 pr-11 text-sm sm:min-h-8">
                  <div v-if="communityRatingLines.length" class="flex flex-wrap gap-1.5">
                    <span
                      v-for="line in communityRatingLines"
                      :key="line"
                      class="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground"
                    >
                      <Star class="size-3 text-primary" aria-hidden="true" />
                      {{ line }}
                    </span>
                  </div>
                  <span v-else class="text-sm text-muted-foreground">{{ t('book.detail.editMetadata.noProviderRatings') }}</span>
                </div>
              </MetadataFieldLabel>
            </div>
          </section>

          <!-- Description, plus the comic sheet when the primary file is a comic -->
          <div class="flex flex-col gap-2.5 @xl/edit:col-span-2 @3xl/edit:col-span-3 @5xl/edit:col-span-1 @5xl/edit:self-stretch">
            <section class="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
              <header class="flex h-7 flex-none items-center gap-2 border-b border-border px-2.5">
                <h3 class="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  {{ t('book.detail.editMetadata.descriptionLabel') }}
                </h3>
                <button
                  type="button"
                  class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded border transition-colors disabled:cursor-not-allowed"
                  :class="
                    isLocked('description')
                      ? 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/25'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                  "
                  :aria-label="
                    isLocked('description')
                      ? t('book.detail.editMetadata.unlockField', { field: t('book.detail.editMetadata.descriptionLabel') })
                      : t('book.detail.editMetadata.lockField', { field: t('book.detail.editMetadata.descriptionLabel') })
                  "
                  :disabled="isUpdatingLock('description')"
                  @click="handleDescriptionLockToggle"
                >
                  <Loader2 v-if="isUpdatingLock('description')" class="size-3.5 animate-spin" aria-hidden="true" />
                  <Lock v-else-if="isLocked('description')" class="size-3.5" aria-hidden="true" />
                  <LockOpen v-else class="size-3.5" aria-hidden="true" />
                </button>
              </header>
              <div class="flex flex-1 flex-col p-2.5">
                <RichDescriptionEditor v-model="form.description" class="min-h-72 flex-1" :disabled="isLocked('description') || formDisabled" />
              </div>
            </section>

            <!-- Identifiers. Compact label-over-value rows: the whole provider list fits open,
                 so there is no accordion hiding ids that a lookup has already filled in. -->

            <section v-if="isPrimaryComic" class="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                class="flex h-7 flex-none items-center justify-between gap-2 border-b border-border bg-muted/30 px-2.5 transition-colors hover:bg-muted/60"
                :aria-expanded="comicSectionOpen"
                @click="toggleComicSection"
              >
                <span class="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  {{ t('book.detail.editMetadata.comicDetails') }}
                </span>
                <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="comicSectionOpen ? 'rotate-180' : ''" />
              </button>
              <div v-if="comicSectionOpen" class="flex flex-1 flex-col gap-2.5 p-2.5">
                <div class="grid grid-cols-1 gap-2.5 @sm/edit:grid-cols-2">
                  <MetadataFieldLabel
                    :label="t('book.detail.editMetadata.comicIssueNumberLabel')"
                    field="comicIssueNumber"
                    :locked="isLocked('comicIssueNumber')"
                    :is-updating="isUpdatingLock"
                    @toggle="handleLockToggle"
                  >
                    <input v-model="form.comicIssueNumber" :class="FIELD_CONTROL_CLASS" :disabled="isLocked('comicIssueNumber')" />
                  </MetadataFieldLabel>
                  <MetadataFieldLabel
                    :label="t('book.detail.editMetadata.comicVolumeLabel')"
                    field="comicVolumeName"
                    :locked="isLocked('comicVolumeName')"
                    :is-updating="isUpdatingLock"
                    @toggle="handleLockToggle"
                  >
                    <input v-model="form.comicVolumeName" :class="FIELD_CONTROL_CLASS" :disabled="isLocked('comicVolumeName')" />
                  </MetadataFieldLabel>
                </div>

                <MetadataFieldLabel
                  :label="t('book.detail.editMetadata.comicStoryArcsLabel')"
                  field="comicStoryArcs"
                  :locked="isLocked('comicStoryArcs')"
                  :is-updating="isUpdatingLock"
                  multiline
                  @toggle="handleLockToggle"
                >
                  <ChipInput
                    v-model="form.comicStoryArcs"
                    :search-fn="searchComicMetadata"
                    :disabled="isLocked('comicStoryArcs')"
                    control-class="pr-11"
                  />
                </MetadataFieldLabel>

                <div class="grid grid-cols-1 gap-2.5 @sm/edit:grid-cols-2">
                  <MetadataFieldLabel
                    v-for="creditField in comicCreditFields"
                    :key="creditField.field"
                    :label="creditField.label"
                    :field="creditField.field"
                    :locked="isLocked(creditField.field)"
                    :is-updating="isUpdatingLock"
                    multiline
                    @toggle="handleLockToggle"
                  >
                    <ChipInput
                      v-model="form[creditField.field]"
                      :search-fn="searchComicMetadata"
                      :disabled="isLocked(creditField.field)"
                      control-class="pr-11"
                    />
                  </MetadataFieldLabel>
                </div>

                <MetadataFieldLabel
                  v-for="wideField in comicWideFields"
                  :key="wideField.field"
                  :label="wideField.label"
                  :field="wideField.field"
                  :locked="isLocked(wideField.field)"
                  :is-updating="isUpdatingLock"
                  multiline
                  @toggle="handleLockToggle"
                >
                  <ChipInput
                    v-model="form[wideField.field]"
                    :search-fn="searchComicMetadata"
                    :disabled="isLocked(wideField.field)"
                    control-class="pr-11"
                  />
                </MetadataFieldLabel>
              </div>
            </section>

            <MetadataSourceCard :book="props.book" class="@5xl/edit:hidden" />
          </div>
        </fieldset>
      </div>

      <!-- Phone and tablet: the toolbar's save pair is hidden above, so it lives here instead -->
      <div
        class="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-6 lg:hidden"
      >
        <button
          class="flex h-11 items-center gap-1.5 rounded-lg border border-input bg-background px-4 text-sm transition-colors hover:bg-muted disabled:opacity-40"
          :disabled="submitDisabled"
          @click="handleReset"
        >
          <X class="size-3.5" aria-hidden="true" />
          {{ t('common.cancel') }}
        </button>
        <button
          class="inline-grid h-11 flex-1 grid-cols-1 grid-rows-1 items-center justify-items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          :disabled="submitDisabled"
          @click="submit"
        >
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: saving }">
            <Check class="size-3.5" aria-hidden="true" />
            {{ t('common.save') }}
          </span>
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: !saving }">
            <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
            {{ t('book.detail.editMetadata.saving') }}
          </span>
        </button>
      </div>
    </div>
  </div>

  <MetadataSearchDrawer v-if="searchOpen" :book="props.book" :locked-fields="lockedFields" @close="handleCloseSearch" @apply="handleApply" />
</template>

<style scoped>
.auto-fill-btn {
  background: linear-gradient(to right, oklch(0.75 0.16 75), oklch(0.72 0.18 55));
  color: oklch(0.2 0.04 75);
  box-shadow: 0 2px 8px oklch(0.72 0.18 55 / 0.35);
}
.auto-fill-btn:hover {
  filter: brightness(1.08);
  box-shadow: 0 2px 12px oklch(0.72 0.18 55 / 0.5);
}
.auto-fill-btn:disabled {
  filter: none;
}
.search-online-btn {
  background: linear-gradient(to right, var(--primary), color-mix(in oklch, var(--primary) 65%, oklch(0.7 0.25 280)));
  box-shadow: 0 2px 10px color-mix(in oklch, var(--primary) 45%, transparent);
}
.search-online-btn:hover {
  filter: brightness(1.1);
  box-shadow: 0 2px 14px color-mix(in oklch, var(--primary) 60%, transparent);
}
</style>
