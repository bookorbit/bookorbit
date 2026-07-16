<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, FileCheck, HardDriveDownload, HardDriveUpload, Loader2, Lock, LockOpen, RefreshCw, Sparkles, Star, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type {
  BookCommunityRating,
  BookDetail,
  BookMetadataLockField,
  CustomMetadataPrimitiveValue,
  MetadataProviderInfo,
  WriteResult,
} from '@bookorbit/types'
import { BOOK_FILE_WRITE_FIELD_LABELS, FORMAT_TO_GROUP } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
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
const fileWriteEnabledForBook = computed(() => fileWriteStatus.value?.enabled === true)
const fileWriteWritableFormats = computed(() => fileWriteStatus.value?.writableFormats ?? [])
const fileWriteFormatLabels = computed(() => fileWriteWritableFormats.value.map((format) => format.toUpperCase()))
const fileWriteFieldLabels = computed(() => (fileWriteStatus.value?.writableFields ?? []).map((field) => BOOK_FILE_WRITE_FIELD_LABELS[field]))
const fileWriteFieldCountLabel = computed(() =>
  t('book.detail.editMetadata.fieldCount', { count: fileWriteFieldLabels.value.length }, fileWriteFieldLabels.value.length),
)
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

const { form, saving, error, isDirty, load, reset, save } = useMetadataEditor()
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
const providerIdsOpen = ref(true)
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

watch(
  () => props.book,
  (book) => {
    load(book)
    loadLocks(book)
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

const combinedError = computed(() => lockError.value ?? error.value)
const hasLockedFields = computed(() => lockedFields.value.length > 0)
const hasPendingChanges = computed(() => isDirty.value || locksDirty.value)
const isSeriesLocked = computed(() => isLocked('seriesName') || isLocked('seriesIndex'))
const communityRatingLines = computed(() =>
  form.communityRatings.map((rating) => formatCommunityRatingLine(rating, availableMetadataProviders.value ?? [])),
)

async function submit() {
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

function normalizeSeriesIndex(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

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
  const primary = next[0] ?? { seriesName: form.seriesName ?? '', seriesIndex: form.seriesIndex ?? null }
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

  setSeriesMemberships(
    normalizeSeriesMemberships(
      (formPatch.seriesMemberships ?? []).map((membership) => ({
        seriesName: membership.seriesName,
        seriesIndex: normalizeSeriesIndex(membership.seriesIndex),
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
  const skippedPart = t('book.detail.editMetadata.skippedLockedFields', { count: skippedFields.length }, skippedFields.length)
  const updatedPart = t('book.detail.editMetadata.updatedFields', { count: updatedCount }, updatedCount)
  toast.info(t('book.detail.editMetadata.applyResult', { skipped: skippedPart, updated: updatedPart }))
}

function handleApply({ formPatch, coverUrl }: { formPatch: MetadataPatch; coverUrl?: string }) {
  const { skippedFields, updatedCount } = applyPatchToForm(formPatch, coverUrl)
  showApplyResult(skippedFields, updatedCount)
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
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function pluralizeField(count: number): string {
  return t('book.detail.editMetadata.fieldCount', { count }, count)
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
    comicMetadata: preview.comicMetadata,
    narrators: preview.audioMetadata?.narrators,
    durationSeconds: preview.audioMetadata?.durationSeconds ?? undefined,
    abridged: preview.audioMetadata?.abridged ?? undefined,
  }
}

async function autoFill() {
  const result = await previewRefresh(props.book.id)
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
  const meta = await loadFromFile(props.book.id)
  if (!meta) {
    toast.error(t('book.detail.editMetadata.loadFromFileFailed'))
    return
  }
  const count = applyFileMetadataToForm(meta)
  toast.info(count > 0 ? t('book.detail.editMetadata.loadedFieldsFromFile', { count }, count) : t('book.detail.editMetadata.noMetadataInFile'))
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
  await lockAll(props.book.id)
}

async function handleUnlockAll() {
  await unlockAll(props.book.id)
}

function handleCoverChanged(source: 'extracted' | 'custom' | null) {
  emit('coverChanged', source)
}
</script>

<template>
  <div class="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start">
    <!-- Left: Cover panel -->
    <div class="w-full pb-3 border-b border-border lg:border-b-0 lg:pb-0 lg:w-48 lg:shrink-0 lg:sticky lg:top-0.5">
      <CoverEditorPanel
        ref="coverPanel"
        :book="props.book"
        :locked="isLocked('cover')"
        @cover-changed="handleCoverChanged"
        @toggle-lock="handleCoverLockToggle"
      />
    </div>

    <!-- Right: Form -->
    <div class="flex-1 min-w-0 space-y-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:space-y-3.5 lg:pb-0">
      <!-- Action bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-h-8">
        <p v-if="combinedError" class="text-sm text-destructive">{{ combinedError }}</p>
        <span v-else class="hidden sm:inline" />
        <div
          class="flex items-center justify-start gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 py-0.5"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="loadingFromFile || !primaryFile"
                @click="handleLoadFromFile"
              >
                <Loader2 v-if="loadingFromFile" class="size-3.5 animate-spin" />
                <HardDriveUpload v-else class="size-3.5" />
                <span class="hidden sm:inline">{{ t('book.detail.editMetadata.loadFromFile') }}</span>
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
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="writingAndRenaming || saving || fileWriteManualDisabledReasonLabel !== null"
                :aria-label="t('book.detail.editMetadata.writeAndRename')"
                @click="handleWriteAndRename"
              >
                <Loader2 v-if="writingAndRenaming" class="size-3.5 animate-spin" />
                <HardDriveDownload v-else class="size-3.5" />
                <span class="sm:hidden">{{ t('book.detail.editMetadata.writeAndRenameShort') }}</span>
                <span class="hidden sm:inline">{{ t('book.detail.editMetadata.writeAndRename') }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ fileWriteManualTooltip }}</TooltipContent>
          </Tooltip>

          <div class="flex-none w-px h-4 bg-border mx-0.5" />

          <button
            class="flex-none search-online-btn flex items-center gap-1.5 h-8 px-3 sm:px-3.5 rounded-lg text-primary-foreground text-sm font-medium transition-all"
            @click="searchOpen = true"
          >
            <Sparkles class="size-3.5" />
            <span class="hidden sm:inline">{{ t('common.search') }}</span>
          </button>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none auto-fill-btn flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                :disabled="autoFilling || areAllLocked"
                @click="autoFill"
              >
                <Loader2 v-if="autoFilling" class="size-3.5 animate-spin" />
                <RefreshCw v-else class="size-3.5" />
                <span class="hidden sm:inline">{{ t('book.detail.editMetadata.autoFill') }}</span>
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

          <div class="flex-none w-px h-4 bg-border mx-0.5" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="updatingLocks || areAllLocked"
                @click="handleLockAll"
              >
                <Lock class="size-3.5" />
                <span class="hidden sm:inline">{{ t('book.detail.editMetadata.lockAll') }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('book.detail.editMetadata.lockAllTooltip') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="updatingLocks || !hasLockedFields"
                @click="handleUnlockAll"
              >
                <LockOpen class="size-3.5" />
                <span class="hidden sm:inline">{{ t('book.detail.editMetadata.unlockAll') }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('book.detail.editMetadata.unlockAllTooltip') }}</TooltipContent>
          </Tooltip>

          <div class="flex-none w-px h-4 bg-border mx-0.5" />

          <button
            class="flex items-center justify-center h-8 px-2.5 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
            :title="t('common.cancel')"
            :aria-label="t('common.cancel')"
            :disabled="!hasPendingChanges || saving || writingAndRenaming"
            @click="handleReset"
          >
            <X class="size-3.5" />
          </button>
          <button
            class="inline-grid grid-cols-1 grid-rows-1 items-center justify-items-center h-8 px-2.5 sm:px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            :disabled="!hasPendingChanges || saving || writingAndRenaming"
            @click="submit"
          >
            <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: saving }">
              <Check class="size-3.5" />
              <span class="hidden sm:inline">{{ t('common.save') }}</span>
            </span>
            <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: !saving }">
              <Loader2 class="size-3.5 animate-spin" />
              <span class="hidden sm:inline">{{ t('book.detail.editMetadata.saving') }}</span>
            </span>
          </button>
          <Popover v-if="fileWriteEnabledForBook">
            <PopoverTrigger as-child>
              <button
                type="button"
                class="flex-none inline-flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                :aria-label="t('book.detail.editMetadata.fileWriteBackDetails')"
              >
                <FileCheck class="size-3.5 text-primary" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)] p-3">
              <div class="space-y-3">
                <div class="flex items-start gap-2.5">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileCheck class="size-4" />
                  </span>
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-sm font-semibold text-foreground">{{ t('book.detail.editMetadata.fileWriteBack') }}</p>
                      <span class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        {{ t('book.detail.editMetadata.enabled') }}
                      </span>
                    </div>
                    <p class="text-xs leading-5 text-muted-foreground">
                      {{ t('book.detail.editMetadata.saveWritesMetadata', { target: fileWriteTargetSummary }) }}
                    </p>
                  </div>
                </div>

                <div class="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
                  <div class="flex items-start justify-between gap-3">
                    <span class="shrink-0 text-muted-foreground">{{ t('book.detail.editMetadata.formats') }}</span>
                    <div v-if="fileWriteFormatLabels.length > 0" class="flex min-w-0 flex-wrap justify-end gap-1">
                      <span
                        v-for="format in fileWriteFormatLabels"
                        :key="format"
                        class="rounded-md border border-border bg-background px-1.5 py-0.5 font-medium text-foreground"
                      >
                        {{ format }}
                      </span>
                    </div>
                    <span v-else class="text-right font-medium text-foreground">{{ t('book.detail.editMetadata.bookFiles') }}</span>
                  </div>
                  <div class="space-y-1.5 border-t border-border/70 pt-2">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-muted-foreground">{{ t('book.detail.editMetadata.supportedFields') }}</span>
                      <span class="font-medium text-foreground">{{ fileWriteFieldCountLabel }}</span>
                    </div>
                    <div v-if="fileWriteFieldLabels.length > 0" class="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1">
                      <span
                        v-for="field in fileWriteFieldLabels"
                        :key="field"
                        class="rounded-md border border-border bg-background px-1.5 py-0.5 font-medium text-foreground"
                      >
                        {{ field }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <!-- Write & rename result panel -->
      <WriteAndRenameResultPanel
        v-if="writeAndRenameResult || writeAndRenameError"
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

      <!-- Title + Subtitle -->
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <MetadataFieldLabel
          class="sm:col-span-3"
          :label="t('book.detail.editMetadata.titleLabel')"
          field="title"
          :locked="isLocked('title')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.title"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('title')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          :label="t('book.detail.editMetadata.subtitleLabel')"
          field="subtitle"
          :locked="isLocked('subtitle')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.subtitle"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('subtitle')"
          />
        </MetadataFieldLabel>
      </div>

      <!-- Authors | Narrators (audio only) -->
      <div class="grid gap-3" :class="isPrimaryAudio ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'">
        <MetadataFieldLabel
          :label="t('book.detail.editMetadata.authorsLabel')"
          field="authors"
          :locked="isLocked('authors')"
          :is-updating="isUpdatingLock"
          multiline
          @toggle="handleLockToggle"
        >
          <ChipInput v-model="form.authors" :search-fn="searchAuthors" :disabled="isLocked('authors')" control-class="pr-12" />
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
          <ChipInput v-model="form.narrators" :search-fn="searchNarrators" :disabled="isLocked('narrators')" control-class="pr-12" />
        </MetadataFieldLabel>
      </div>

      <!-- Genres -->
      <MetadataFieldLabel
        :label="t('book.detail.editMetadata.genresLabel')"
        field="genres"
        :locked="isLocked('genres')"
        :is-updating="isUpdatingLock"
        multiline
        @toggle="handleLockToggle"
      >
        <ChipInput v-model="form.genres" :search-fn="searchGenres" :disabled="isLocked('genres')" control-class="pr-12" />
      </MetadataFieldLabel>

      <!-- Tags | Rating -->
      <div class="flex flex-col sm:flex-row items-start gap-3">
        <MetadataFieldLabel
          class="w-full sm:flex-1"
          :label="t('book.detail.editMetadata.tagsLabel')"
          field="tags"
          :locked="isLocked('tags')"
          :is-updating="isUpdatingLock"
          multiline
          @toggle="handleLockToggle"
        >
          <ChipInput v-model="form.tags" :search-fn="searchTags" :disabled="isLocked('tags')" control-class="pr-12" />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="w-full sm:w-auto sm:shrink-0"
          :label="t('book.detail.editMetadata.ratingLabel')"
          field="rating"
          :locked="isLocked('rating')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <div
            class="flex h-10 items-center gap-0.5 rounded-lg border border-input bg-background px-2 py-2 pr-12"
            :class="isLocked('rating') ? 'opacity-50 cursor-not-allowed' : ''"
            @mouseleave="hoverRating = null"
          >
            <Tooltip v-for="star in RATING_STARS" :key="star">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="p-1.5 sm:p-0.5 transition-colors disabled:opacity-50"
                  :disabled="isLocked('rating')"
                  @mouseenter="hoverRating = star"
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
              class="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="isLocked('rating')"
              @click="clearRating"
            >
              {{ t('book.detail.editMetadata.clear') }}
            </button>
          </div>
        </MetadataFieldLabel>
      </div>

      <MetadataFieldLabel
        :label="t('book.detail.editMetadata.communityRatingsLabel')"
        field="communityRating"
        :locked="isLocked('communityRating')"
        :is-updating="isUpdatingLock"
        multiline
        @toggle="handleLockToggle"
      >
        <div class="min-h-10 rounded-lg border border-input bg-background px-3 py-2 pr-12 text-sm">
          <div v-if="communityRatingLines.length" class="flex flex-wrap gap-1.5">
            <span
              v-for="line in communityRatingLines"
              :key="line"
              class="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground"
            >
              <Star class="size-3 text-primary" />
              {{ line }}
            </span>
          </div>
          <span v-else class="text-sm text-muted-foreground">{{ t('book.detail.editMetadata.noProviderRatings') }}</span>
        </div>
      </MetadataFieldLabel>

      <!-- Series | Publisher -->
      <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] gap-3">
        <MetadataFieldLabel
          :label="t('book.detail.editMetadata.seriesLabel')"
          field="seriesName"
          :locked="isSeriesLocked"
          :is-updating="isUpdatingLock"
          multiline
          @toggle="handleSeriesLockToggle"
        >
          <SeriesMembershipEditor
            class="pr-10"
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
            :class="'w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed'"
          />
        </MetadataFieldLabel>
      </div>

      <!-- Language | Published Date | Year | Page Count | ISBN-13 | ISBN-10 | Duration (audio) | Abridged (audio) -->
      <div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
        <MetadataFieldLabel
          class="col-span-2 sm:w-32 sm:shrink-0"
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
            :class="'w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed'"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-40 sm:shrink-0"
          :label="t('bookDock.field.publishedDate')"
          field="publishedYear"
          :locked="isLocked('publishedYear')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            :value="form.publishedDate ?? ''"
            type="date"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('publishedYear')"
            @input="setPublishedDateField"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-28 sm:shrink-0"
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
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('publishedYear')"
            @input="setIntField('publishedYear', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-28 sm:shrink-0"
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
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('pageCount')"
            @input="setIntField('pageCount', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:flex-1 sm:min-w-22.5"
          :label="t('book.detail.editMetadata.isbn13Label')"
          field="isbn13"
          :locked="isLocked('isbn13')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.isbn13"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            maxlength="13"
            :disabled="isLocked('isbn13')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:flex-1 sm:min-w-21.25"
          :label="t('book.detail.editMetadata.isbn10Label')"
          field="isbn10"
          :locked="isLocked('isbn10')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.isbn10"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            maxlength="10"
            :disabled="isLocked('isbn10')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          v-if="isPrimaryAudio"
          class="sm:w-30 sm:shrink-0"
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
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('durationSeconds')"
            @input="setIntField('durationSeconds', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          v-if="isPrimaryAudio"
          class="sm:w-20 sm:shrink-0"
          :label="t('book.detail.editMetadata.abridgedLabel')"
          field="abridged"
          :locked="isLocked('abridged')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <div
            class="flex h-8 items-center rounded-lg border border-input bg-background px-3 pr-12"
            :class="isLocked('abridged') ? 'opacity-50 cursor-not-allowed' : ''"
          >
            <input
              id="abridged-check"
              v-model="form.abridged"
              type="checkbox"
              class="h-4 w-4 rounded border-input accent-primary"
              :aria-label="t('book.detail.editMetadata.abridgedLabel')"
              :disabled="isLocked('abridged')"
            />
          </div>
        </MetadataFieldLabel>
      </div>

      <!-- Provider IDs -->
      <div v-if="visibleProviderIdFields.length > 0" class="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
          @click="providerIdsOpen = !providerIdsOpen"
        >
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('book.detail.editMetadata.providerIds') }}</span>
          <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="providerIdsOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="providerIdsOpen" class="p-3">
          <div class="grid grid-cols-2 sm:flex sm:gap-3 sm:overflow-x-auto gap-2 p-px">
            <div v-for="{ field, label } in visibleProviderIdFields" :key="field" class="min-w-0 sm:min-w-30 sm:flex-1">
              <MetadataFieldLabel :label="label" :field="field" :locked="isLocked(field)" :is-updating="isUpdatingLock" @toggle="handleLockToggle">
                <input
                  v-model="form[field]"
                  class="w-full h-8 rounded-md border border-input bg-background px-2.5 pr-12 text-xs font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="isLocked(field)"
                />
              </MetadataFieldLabel>
            </div>
          </div>
        </div>
      </div>

      <!-- Comic Details (CBX books only) -->
      <div v-if="isPrimaryComic" class="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
          @click="toggleComicSection"
        >
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('book.detail.editMetadata.comicDetails') }}</span>
          <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="comicSectionOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="comicSectionOpen" class="p-3 space-y-3">
          <!-- Issue Number | Volume -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicIssueNumberLabel')"
              field="comicIssueNumber"
              :locked="isLocked('comicIssueNumber')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <input
                v-model="form.comicIssueNumber"
                class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLocked('comicIssueNumber')"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicVolumeLabel')"
              field="comicVolumeName"
              :locked="isLocked('comicVolumeName')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <input
                v-model="form.comicVolumeName"
                class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-12 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLocked('comicVolumeName')"
              />
            </MetadataFieldLabel>
          </div>
          <!-- Story Arcs -->
          <MetadataFieldLabel
            :label="t('book.detail.editMetadata.comicStoryArcsLabel')"
            field="comicStoryArcs"
            :locked="isLocked('comicStoryArcs')"
            :is-updating="isUpdatingLock"
            multiline
            @toggle="handleLockToggle"
          >
            <ChipInput v-model="form.comicStoryArcs" :search-fn="searchComicMetadata" :disabled="isLocked('comicStoryArcs')" control-class="pr-12" />
          </MetadataFieldLabel>
          <!-- Pencillers | Inkers -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicPencillersLabel')"
              field="comicPencillers"
              :locked="isLocked('comicPencillers')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicPencillers"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicPencillers')"
                control-class="pr-12"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicInkersLabel')"
              field="comicInkers"
              :locked="isLocked('comicInkers')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput v-model="form.comicInkers" :search-fn="searchComicMetadata" :disabled="isLocked('comicInkers')" control-class="pr-12" />
            </MetadataFieldLabel>
          </div>
          <!-- Colorists | Letterers -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicColoristsLabel')"
              field="comicColorists"
              :locked="isLocked('comicColorists')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicColorists"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicColorists')"
                control-class="pr-12"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicLetterersLabel')"
              field="comicLetterers"
              :locked="isLocked('comicLetterers')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicLetterers"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicLetterers')"
                control-class="pr-12"
              />
            </MetadataFieldLabel>
          </div>
          <!-- Cover Artists -->
          <MetadataFieldLabel
            :label="t('book.detail.editMetadata.comicCoverArtistsLabel')"
            field="comicCoverArtists"
            :locked="isLocked('comicCoverArtists')"
            :is-updating="isUpdatingLock"
            multiline
            @toggle="handleLockToggle"
          >
            <ChipInput
              v-model="form.comicCoverArtists"
              :search-fn="searchComicMetadata"
              :disabled="isLocked('comicCoverArtists')"
              control-class="pr-12"
            />
          </MetadataFieldLabel>
          <!-- Characters | Teams -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicCharactersLabel')"
              field="comicCharacters"
              :locked="isLocked('comicCharacters')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicCharacters"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicCharacters')"
                control-class="pr-12"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              :label="t('book.detail.editMetadata.comicTeamsLabel')"
              field="comicTeams"
              :locked="isLocked('comicTeams')"
              :is-updating="isUpdatingLock"
              multiline
              @toggle="handleLockToggle"
            >
              <ChipInput v-model="form.comicTeams" :search-fn="searchComicMetadata" :disabled="isLocked('comicTeams')" control-class="pr-12" />
            </MetadataFieldLabel>
          </div>
          <!-- Locations -->
          <MetadataFieldLabel
            :label="t('book.detail.editMetadata.comicLocationsLabel')"
            field="comicLocations"
            :locked="isLocked('comicLocations')"
            :is-updating="isUpdatingLock"
            multiline
            @toggle="handleLockToggle"
          >
            <ChipInput v-model="form.comicLocations" :search-fn="searchComicMetadata" :disabled="isLocked('comicLocations')" control-class="pr-12" />
          </MetadataFieldLabel>
        </div>
      </div>

      <div v-if="form.customMetadata.length > 0" class="rounded-lg border border-border overflow-hidden">
        <div class="px-3 py-2 bg-muted/40">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('book.detail.editMetadata.customMetadata') }}</span>
        </div>
        <div class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
          <label v-for="field in form.customMetadata" :key="field.fieldId" class="space-y-1">
            <span class="text-xs font-medium text-muted-foreground">{{ field.label }}</span>
            <input
              v-if="isTextLikeCustomField(field.type)"
              :value="typeof field.value === 'string' ? field.value : ''"
              :type="field.type === 'url' ? 'url' : 'text'"
              class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
              @input="setCustomTextField(field.fieldId, $event)"
            />
            <input
              v-else-if="field.type === 'number'"
              :value="typeof field.value === 'number' ? field.value : ''"
              type="number"
              class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
              @input="setCustomNumberField(field.fieldId, $event)"
            />
            <input
              v-else-if="field.type === 'date'"
              :value="typeof field.value === 'string' ? field.value : ''"
              type="date"
              class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
              @input="setCustomDateField(field.fieldId, $event)"
            />
            <div v-else class="flex h-8 items-center rounded-lg border border-input bg-background px-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-input accent-primary"
                :checked="field.value === true"
                :aria-label="field.label"
                @change="setCustomBooleanField(field.fieldId, $event)"
              />
            </div>
          </label>
        </div>
      </div>

      <!-- Description -->
      <MetadataFieldLabel
        :label="t('book.detail.editMetadata.descriptionLabel')"
        field="description"
        :locked="isLocked('description')"
        :is-updating="isUpdatingLock"
        multiline
        @toggle="handleLockToggle"
      >
        <RichDescriptionEditor v-model="form.description" :disabled="isLocked('description')" />
      </MetadataFieldLabel>

      <!-- Mobile: sticky Save/Cancel bar -->
      <div
        class="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-6 lg:hidden"
      >
        <button
          class="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
          :disabled="!hasPendingChanges || saving || writingAndRenaming"
          @click="handleReset"
        >
          <X class="size-3.5" />
          {{ t('common.cancel') }}
        </button>
        <button
          class="inline-grid grid-cols-1 grid-rows-1 flex-1 items-center justify-items-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          :disabled="!hasPendingChanges || saving || writingAndRenaming"
          @click="submit"
        >
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: saving }">
            <Check class="size-3.5" />
            Save
          </span>
          <span class="col-start-1 row-start-1 flex items-center gap-1.5" :class="{ invisible: !saving }">
            <Loader2 class="size-3.5 animate-spin" />
            Saving...
          </span>
        </button>
      </div>
    </div>
  </div>

  <MetadataSearchDrawer v-if="searchOpen" :book="props.book" :locked-fields="lockedFields" @close="searchOpen = false" @apply="handleApply" />
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
