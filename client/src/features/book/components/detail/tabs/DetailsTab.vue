<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { formatBytes as formatFileSize } from '@/lib/formatting'
import { useRouter } from 'vue-router'
import {
  BookOpen,
  Check,
  ChevronDown,
  Eye,
  Library,
  Headphones,
  Lock,
  MoreVertical,
  Pencil,
  RotateCcw,
  Send,
  Star,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from '@lucide/vue'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { providerIconPath, providerIconPathSafe } from '@/features/book/lib/provider-icons'
import { libroFmAudiobookUrl, lubimyczytacBookUrl } from '@/features/book/lib/provider-links'
import { getProviderColor, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import type { BookDetail, BookKoboState, CustomMetadataBookValue, ReadStatus, UserBookStatus } from '@bookorbit/types'
import { STATUS_OPTIONS, STATUS_ICONS, STATUS_COLORS, useBookStatus } from '@/features/book/composables/useBookStatus'
import BookDownloadButton from '@/features/book/components/BookDownloadButton.vue'
import DiscoverRow from '@/features/book/components/detail/DiscoverRow.vue'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
import { useMetadataLocks } from '@/features/book/composables/useMetadataLocks'
import { usePersonalNote, PERSONAL_NOTE_MAX_LENGTH } from '@/features/book/composables/usePersonalNote'
import { useResetReadingState } from '@/features/book/composables/useResetReadingState'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import ResetReadingStateDialog from '@/features/book/components/ResetReadingStateDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import MetadataScoreBadge from '@/features/metadata-score/components/MetadataScoreBadge.vue'
import MetadataScoreBreakdown from '@/features/metadata-score/components/MetadataScoreBreakdown.vue'
import { useMetadataScoreWeights } from '@/features/metadata-score/composables/useMetadataScoreWeights'
import { useSafeHtml } from '@/features/book/composables/useSafeHtml'
import { useKoreaderBookProgress } from '@/features/koreader/composables/useKoreaderBookProgress'
import { RATING_STARS, getRatingStarClass } from '@/features/book/lib/rating-stars'
import { formatCommunityRatingValue } from '@/features/book/lib/community-rating'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import HardcoverBookSyncGridItem from '@/features/hardcover/components/HardcoverBookSyncGridItem.vue'
import StorygraphBookSyncGridItem from '@/features/storygraph/components/StorygraphBookSyncGridItem.vue'

type FileProgress = {
  percentage: number
  cfi: string | null
  pageNumber: number | null
  updatedAt: string | null
}

type FileProgressRow = FileProgress & {
  fileId: number
}

type CollectionMembership = {
  id: number
  name: string
  syncToKobo: boolean
  memberCount?: number
}

type ProviderLink = {
  key: string
  label: string
  url: string
  iconUrl: string
  fallback: string
}

type SeriesDisplayLink = {
  key: string
  seriesId: number | null
  label: string
}

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ saved: [BookDetail] }>()
const { t } = useI18n()
const router = useRouter()

const addToCollectionOpen = ref(false)
const scoreBreakdownOpen = ref(false)
const mobileScoreBreakdownOpen = ref(false)
const moreMenuOpen = ref(false)
const mobileMoreMenuOpen = ref(false)
const readMenuOpen = ref(false)
const mobileReadMenuOpen = ref(false)
const showSendDialog = ref(false)
const showPersonalReview = ref(false)

function togglePersonalReview() {
  showPersonalReview.value = !showPersonalReview.value
}

const { weights: scoreWeights, fetchWeights } = useMetadataScoreWeights()
const { bookProgress: koreaderBookProgress, fetchBookProgress: fetchKoreaderProgress } = useKoreaderBookProgress()

onMounted(() => {
  void fetchWeights()
})

const {
  pendingId: deleteBookId,
  deleting: deletingBook,
  promptDelete,
  cancelDelete,
  confirmDelete,
} = useDeleteBook(() => {
  router.back()
})

const coverLoaded = ref(false)
const coverFailed = ref(false)
const coverImageRatio = ref<number | null>(null)
const coverLightboxOpen = ref(false)
const descriptionExpanded = ref(false)
const genresExpanded = ref(false)
const genreMeasureContainer = ref<HTMLElement | null>(null)
const genreHiddenCount = ref(0)
const visibleGenreCount = ref(0)
const safeDescription = useSafeHtml(() => props.book.description)
const filledCustomMetadata = computed(() => (props.book.customMetadata ?? []).filter((field) => field.value !== null && field.value !== ''))
const displayedGenres = computed(() => {
  if (genresExpanded.value || genreHiddenCount.value === 0) return props.book.genres
  const count = visibleGenreCount.value > 0 ? visibleGenreCount.value : props.book.genres.length
  return props.book.genres.slice(0, count)
})
const MORE_BUTTON_RESERVED_WIDTH = 72

function getUniqueRowTops(values: number[]): number[] {
  const rows: number[] = []
  for (const value of values) {
    if (!rows.some((rowTop) => Math.abs(rowTop - value) <= 1)) rows.push(value)
  }
  return rows.sort((a, b) => a - b)
}

function getRowTop(metrics: Array<{ top: number; right: number }>): number | null {
  const tops = getUniqueRowTops(metrics.map((metric) => metric.top))
  return tops.length > 0 ? tops[0]! : null
}

function getRowRight(metrics: Array<{ top: number; right: number }>, rowTop: number): number {
  const rowItems = metrics.filter((metric) => Math.abs(metric.top - rowTop) <= 1)
  return rowItems.length ? Math.max(...rowItems.map((metric) => metric.right)) : 0
}

function ensureMoreButtonFitsSecondRow(
  metrics: Array<{ top: number; right: number }>,
  secondRowTop: number,
  containerWidth: number,
  initialVisibleCount: number,
) {
  let visibleCount = initialVisibleCount
  let hiddenCount = metrics.length - visibleCount

  while (hiddenCount > 0 && visibleCount > 0) {
    const visibleMetrics = metrics.slice(0, visibleCount)
    const currentSecondRowTop = getRowTop(visibleMetrics.filter((metric) => metric.top >= secondRowTop - 1))
    const rowTop = currentSecondRowTop ?? secondRowTop
    const remainingWidth = containerWidth - getRowRight(visibleMetrics, rowTop)
    if (remainingWidth >= MORE_BUTTON_RESERVED_WIDTH) break
    visibleCount -= 1
    hiddenCount += 1
  }

  return { visibleCount, hiddenCount }
}

function resetGenreFoldState() {
  visibleGenreCount.value = props.book.genres.length
  genreHiddenCount.value = 0
}

function measureGenreOverflow() {
  const container = genreMeasureContainer.value
  if (!container) {
    resetGenreFoldState()
    return
  }

  const pills = Array.from(container.querySelectorAll<HTMLElement>('[data-genre-pill="true"]'))
  if (pills.length === 0) {
    resetGenreFoldState()
    return
  }

  const containerRect = container.getBoundingClientRect()
  const containerWidth = container.clientWidth
  const pillMetrics = pills.map((pill) => {
    const rect = pill.getBoundingClientRect()
    return {
      top: rect.top - containerRect.top,
      right: rect.right - containerRect.left,
    }
  })

  const rowTops = getUniqueRowTops(pillMetrics.map((metric) => metric.top))
  if (rowTops.length <= 2) {
    resetGenreFoldState()
    return
  }

  const secondRowTop = rowTops[1]!
  let visibleCount = pillMetrics.findIndex((metric) => metric.top > secondRowTop + 1)
  if (visibleCount === -1) visibleCount = pillMetrics.length

  const fitted = ensureMoreButtonFitsSecondRow(pillMetrics, secondRowTop, containerWidth, visibleCount)
  visibleGenreCount.value = fitted.visibleCount
  genreHiddenCount.value = fitted.hiddenCount
}

let genreResizeObserver: ResizeObserver | null = null
let genreMeasureFrame: number | null = null

function scheduleGenreOverflowMeasure() {
  void nextTick(() => {
    if (genreMeasureFrame != null) cancelAnimationFrame(genreMeasureFrame)
    genreMeasureFrame = requestAnimationFrame(() => {
      genreMeasureFrame = null
      measureGenreOverflow()
    })
  })
}

function formatCustomMetadataValue(field: CustomMetadataBookValue): string {
  if (field.value === null) return ''
  if (field.type === 'boolean') return field.value ? t('common.yes') : t('common.no')
  return String(field.value)
}

watch(
  () => `${props.book.id}:${props.book.genres.join('|')}`,
  () => {
    genresExpanded.value = false
    resetGenreFoldState()
    scheduleGenreOverflowMeasure()
  },
  { immediate: true },
)

watch(genreMeasureContainer, (current, previous) => {
  if (genreResizeObserver && previous) genreResizeObserver.unobserve(previous)
  if (genreResizeObserver && current) genreResizeObserver.observe(current)
  scheduleGenreOverflowMeasure()
})

onMounted(() => {
  genreResizeObserver = new ResizeObserver(() => {
    scheduleGenreOverflowMeasure()
  })
  if (genreMeasureContainer.value) genreResizeObserver.observe(genreMeasureContainer.value)
  window.addEventListener('resize', scheduleGenreOverflowMeasure)
})

onBeforeUnmount(() => {
  if (genreMeasureFrame != null) cancelAnimationFrame(genreMeasureFrame)
  if (genreResizeObserver) {
    genreResizeObserver.disconnect()
    genreResizeObserver = null
  }
  window.removeEventListener('resize', scheduleGenreOverflowMeasure)
})

const { hasPermission } = usePermissions()
const { load: loadLocks, isLocked } = useMetadataLocks()
watch(
  () => props.book,
  (b) => loadLocks(b),
  { immediate: true },
)

const isRatingLocked = computed(() => isLocked('rating'))
const canViewKobo = computed(() => hasPermission('kobo_sync'))
const canViewKoreader = computed(() => hasPermission('koreader_sync'))
const canEditMetadata = computed(() => hasPermission('library_edit_metadata'))
const resetReadingStateBookId = computed(() => props.book.id)
const {
  open: resetReadingStateDialogOpen,
  resetting: resettingReadingState,
  error: resetReadingStateError,
  openDialog: openResetReadingStateDialog,
  closeDialog: closeResetReadingStateDialog,
  resetReadingState,
} = useResetReadingState(resetReadingStateBookId)

const coverSeed = computed(() => props.book.title ?? props.book.folderPath.split('/').pop() ?? String(props.book.id))
const coverPlaceholderTitle = computed(() => props.book.title ?? props.book.folderPath.split('/').pop() ?? null)
const hasCover = computed(() => props.book.coverSource !== null)
const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'cover', props.book.updatedAt ?? props.book.addedAt))

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
  coverImageRatio.value = null
})

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const { bookCoverDisplayMode } = useDisplaySettings()
const detailCoverAspectRatio = computed(() => {
  if (bookCoverDisplayMode.value !== 'natural-bottom' || !hasCover.value || !coverLoaded.value || coverFailed.value || !coverImageRatio.value) {
    return coverAspectRatio.value
  }

  return `${coverImageRatio.value} / 1`
})
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isPrimaryComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')
const readableFiles = computed(() => props.book.files.filter((f) => f.format && READER_OPENABLE_FORMATS.has(f.format)))

// For multi-file audiobooks, collapse all tracks into one representative entry.
const isMultiTrackAudio = computed(() => {
  const audioFiles = readableFiles.value.filter((f) => FORMAT_TO_GROUP[f.format!] === 'audio')
  return audioFiles.length > 1
})
const openableFiles = computed(() => {
  if (isMultiTrackAudio.value) {
    const first = readableFiles.value.find((f) => FORMAT_TO_GROUP[f.format!] === 'audio')
    const nonAudio = readableFiles.value.filter((f) => FORMAT_TO_GROUP[f.format!] !== 'audio')
    return first ? [first, ...nonAudio] : nonAudio
  }
  return readableFiles.value
})
const hasMultipleFiles = computed(() => openableFiles.value.length > 1)
const authorLinks = computed(() => props.book.authors.filter((author) => author.name.trim().length > 0))
const narratorLine = computed(() => props.book.audioMetadata?.narrators?.map((n) => n.name).join(', ') || null)
const formats = computed(() => {
  const all = [...new Set(props.book.files.filter((f) => f.format && FORMAT_TO_GROUP[f.format]).map((f) => f.format!))]
  const priority = props.book.formatPriority
  const sorted = priority.length
    ? all.sort((a, b) => {
        const ai = priority.indexOf(a)
        const bi = priority.indexOf(b)
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
      })
    : all
  const primary = primaryFile.value?.format
  if (!primary) return sorted
  return [primary, ...sorted.filter((f) => f !== primary)]
})

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const localRating = ref<number | null>(null)
const hoverRating = ref<number | null>(null)
const displayRating = computed(() => hoverRating.value ?? localRating.value)
const communityRatingByProvider = computed(() => {
  const map: Record<string, { score: string; tooltip: string }> = {}
  for (const rating of props.book.communityRatings) {
    if (rating.rating == null || !Number.isFinite(rating.rating)) continue
    const score = Number.isInteger(rating.rating) ? rating.rating.toFixed(0) : rating.rating.toFixed(1)
    const label = PROVIDER_SHORT_LABELS[rating.provider] ?? rating.provider
    const value = formatCommunityRatingValue(rating.rating, rating.ratingCount)
    map[rating.provider] = { score, tooltip: `${label} ${value}` }
  }
  return map
})

watch(
  () => props.book.rating,
  (val) => {
    localRating.value = val ?? null
  },
  { immediate: true },
)

async function setRating(star: number) {
  if (!canEditMetadata.value) return
  const newRating = localRating.value === star ? null : star
  localRating.value = newRating
  try {
    const res = await api(`/api/v1/books/${props.book.id}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: newRating }),
    })
    if (!res.ok) throw new Error()
    const updated = (await res.json()) as BookDetail
    localRating.value = updated.rating ?? null
    emit('saved', updated)
  } catch {
    localRating.value = props.book.rating ?? null
  }
}

const ratingStars = RATING_STARS

const {
  draft: personalNoteDraft,
  editing: personalNoteEditing,
  saving: personalNoteSaving,
  error: personalNoteError,
  preview: personalNotePreview,
  hasNote: hasPersonalNote,
  canSave: canSavePersonalNote,
  canClearDraft: canClearPersonalNoteDraft,
  charCount: personalNoteCharCount,
  startEdit: startPersonalNoteEdit,
  cancelEdit: cancelPersonalNoteEdit,
  clearDraft: clearPersonalNoteDraft,
  save: savePersonalNoteDraft,
} = usePersonalNote(computed(() => props.book))

const personalNoteUpdatedLabel = computed(() => (props.book.personalNoteUpdatedAt ? formatDateTime(props.book.personalNoteUpdatedAt) : null))

watch(
  () => props.book.id,
  () => {
    showPersonalReview.value = false
  },
)

async function savePersonalNote() {
  const updated = await savePersonalNoteDraft()
  if (updated) emit('saved', updated)
}

const { setStatus, updateStatus } = useBookStatus()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function dateToDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  if (DATE_KEY_RE.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return dateToDateKey(parsed)
}

const localReadStatus = ref<ReadStatus | null>(props.book.readStatus?.status ?? null)
const savedReadingDates = ref<{ startedAt: string; finishedAt: string }>({
  startedAt: toDateInputValue(props.book.readStatus?.startedAt),
  finishedAt: toDateInputValue(props.book.readStatus?.finishedAt),
})
const draftReadingDates = ref<{ startedAt: string; finishedAt: string }>({
  startedAt: savedReadingDates.value.startedAt,
  finishedAt: savedReadingDates.value.finishedAt,
})
const savingReadingDates = ref(false)
const readingDatesError = ref<string | null>(null)
const activeReadingDateField = ref<'startedAt' | 'finishedAt' | null>(null)
const todayDateInput = computed(() => dateToDateKey(new Date()))

function normalizeReadStatusDates(readStatus: UserBookStatus | null | undefined) {
  return {
    startedAt: toDateInputValue(readStatus?.startedAt),
    finishedAt: toDateInputValue(readStatus?.finishedAt),
  }
}

function validateReadingDates(values: { startedAt: string; finishedAt: string }): string | null {
  const { startedAt, finishedAt } = values
  if (startedAt && startedAt > todayDateInput.value) return t('book.detail.details.dateStartedFutureError')
  if (finishedAt && finishedAt > todayDateInput.value) return t('book.detail.details.dateFinishedFutureError')
  if (startedAt && finishedAt && finishedAt < startedAt) return t('book.detail.details.dateFinishedBeforeStartedError')
  return null
}

const isEditingAnyReadingDate = computed(() => activeReadingDateField.value !== null)

function formatDisplayDate(dateKey: string): string {
  if (!dateKey) return '-'
  const [year, month, day] = dateKey.split('-').map(Number)
  const d = new Date(year!, month! - 1, day!)
  return formatLocaleDate(d, { year: 'numeric', month: 'short', day: 'numeric' })
}

function isEditingReadingDate(field: 'startedAt' | 'finishedAt') {
  return activeReadingDateField.value === field
}

function hasReadingDateFieldChanges(field: 'startedAt' | 'finishedAt') {
  return draftReadingDates.value[field] !== savedReadingDates.value[field]
}

function startEditingReadingDate(field: 'startedAt' | 'finishedAt') {
  if (savingReadingDates.value) return
  activeReadingDateField.value = field
  draftReadingDates.value = { ...savedReadingDates.value }
  readingDatesError.value = null
}

watch(
  draftReadingDates,
  (value) => {
    readingDatesError.value = validateReadingDates(value)
  },
  { deep: true },
)

function applyReadStatusUpdate(updatedReadStatus: UserBookStatus) {
  localReadStatus.value = updatedReadStatus.status
  const normalizedDates = normalizeReadStatusDates(updatedReadStatus)
  savedReadingDates.value = normalizedDates
  draftReadingDates.value = { ...normalizedDates }
  readingDatesError.value = null
  emit('saved', { ...props.book, readStatus: updatedReadStatus })
}

watch(
  () => props.book.readStatus,
  (value) => {
    activeReadingDateField.value = null
    localReadStatus.value = value?.status ?? null
    const normalizedDates = normalizeReadStatusDates(value)
    savedReadingDates.value = normalizedDates
    draftReadingDates.value = { ...normalizedDates }
    readingDatesError.value = null
  },
  { immediate: true },
)

async function handleSetReadStatus(status: ReadStatus) {
  const prev = localReadStatus.value
  localReadStatus.value = status
  try {
    const updatedReadStatus = await setStatus(props.book.id, status)
    applyReadStatusUpdate(updatedReadStatus)
  } catch {
    localReadStatus.value = prev
  }
}

async function saveReadingDateField(field: 'startedAt' | 'finishedAt') {
  if (!isEditingReadingDate(field)) return
  if (savingReadingDates.value) return
  const validationError = validateReadingDates(draftReadingDates.value)
  readingDatesError.value = validationError
  if (validationError) return

  if (!hasReadingDateFieldChanges(field)) {
    activeReadingDateField.value = null
    return
  }

  const patch =
    field === 'startedAt'
      ? ({ startedAt: draftReadingDates.value.startedAt || null } as const)
      : ({ finishedAt: draftReadingDates.value.finishedAt || null } as const)

  savingReadingDates.value = true
  try {
    const updatedReadStatus = await updateStatus(props.book.id, patch)
    applyReadStatusUpdate(updatedReadStatus)
    activeReadingDateField.value = null
  } catch {
    readingDatesError.value = t('book.detail.details.saveReadingDatesError')
  } finally {
    savingReadingDates.value = false
  }
}

function cancelReadingDateEdit(field: 'startedAt' | 'finishedAt') {
  if (!isEditingReadingDate(field)) return
  activeReadingDateField.value = null
  draftReadingDates.value[field] = savedReadingDates.value[field]
  readingDatesError.value = null
}

const fileProgressById = ref<Record<number, FileProgress>>({})
const audiobookProgress = ref<{ percentage: number; currentFileId: number; positionSeconds: number; updatedAt: string | null } | null>(null)
const collections = ref<CollectionMembership[]>([])
const koboState = ref<BookKoboState | null>(null)
const supplementalLoading = ref(false)
const resettingFileIds = ref<number[]>([])
const providerIconErrors = ref<Record<string, boolean>>({})

const providerLinks = computed<ProviderLink[]>(() => {
  const out: ProviderLink[] = []
  const ids = props.book.providerIds
  if (ids.google) {
    out.push({
      key: 'google',
      label: 'Google Books',
      url: `https://books.google.com/books?id=${ids.google}`,
      iconUrl: providerIconPath('google'),
      fallback: 'G',
    })
  }
  if (ids.goodreads) {
    out.push({
      key: 'goodreads',
      label: 'Goodreads',
      url: `https://www.goodreads.com/book/show/${ids.goodreads}`,
      iconUrl: providerIconPath('goodreads'),
      fallback: 'GR',
    })
  }
  if (ids.amazon) {
    out.push({
      key: 'amazon',
      label: 'Amazon',
      url: `https://www.amazon.com/dp/${ids.amazon}`,
      iconUrl: providerIconPath('amazon'),
      fallback: 'A',
    })
  }
  if (ids.hardcover) {
    out.push({
      key: 'hardcover',
      label: 'Hardcover',
      url: `https://hardcover.app/books/${ids.hardcover}`,
      iconUrl: providerIconPath('hardcover'),
      fallback: 'H',
    })
  }
  if (ids.openLibrary) {
    const path = String(ids.openLibrary).startsWith('/works/') ? String(ids.openLibrary) : `/works/${ids.openLibrary}`
    out.push({
      key: 'openLibrary',
      label: 'Open Library',
      url: `https://openlibrary.org${path}`,
      iconUrl: providerIconPath('openLibrary'),
      fallback: 'OL',
    })
  }
  if (ids.itunes) {
    out.push({
      key: 'itunes',
      label: 'Apple Books',
      url: `https://books.apple.com/book/id${ids.itunes}`,
      iconUrl: providerIconPath('itunes'),
      fallback: '',
    })
  }
  if (ids.audible) {
    out.push({
      key: 'audible',
      label: 'Audible',
      url: `https://www.audible.com/pd/${ids.audible}`,
      iconUrl: providerIconPath('audible'),
      fallback: 'Au',
    })
  }
  if (ids.librofm) {
    out.push({
      key: 'librofm',
      label: 'Libro.fm',
      url: libroFmAudiobookUrl(ids.librofm),
      iconUrl: providerIconPath('librofm'),
      fallback: 'Lf',
    })
  }
  if (ids.kobo) {
    out.push({
      key: 'kobo',
      label: 'Kobo',
      url: `https://www.kobo.com/us/en/ebook/${encodeURIComponent(ids.kobo)}`,
      iconUrl: providerIconPath('kobo'),
      fallback: 'K',
    })
  }
  if (ids.ranobedb) {
    out.push({
      key: 'ranobedb',
      label: 'RanobeDB',
      url: `https://ranobedb.org/book/${ids.ranobedb}`,
      iconUrl: providerIconPath('ranobedb'),
      fallback: 'RN',
    })
  }
  if (ids.lubimyczytac) {
    out.push({
      key: 'lubimyczytac',
      label: 'LubimyCzytac',
      url: lubimyczytacBookUrl(ids.lubimyczytac),
      iconUrl: providerIconPath('lubimyczytac'),
      fallback: 'LC',
    })
  }
  if (ids.aladin) {
    out.push({
      key: 'aladin',
      label: 'Aladin',
      url: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${ids.aladin}`,
      iconUrl: providerIconPath('aladin'),
      fallback: '알',
    })
  }
  return out
})

const communityRatingBadges = computed(() => {
  const linkByKey = new Map(providerLinks.value.map((link) => [link.key, link]))
  return props.book.communityRatings
    .filter((rating) => rating.rating != null && Number.isFinite(rating.rating))
    .map((rating) => {
      const link = linkByKey.get(rating.provider)
      const meta = communityRatingByProvider.value[rating.provider]
      const label = PROVIDER_SHORT_LABELS[rating.provider] ?? rating.provider
      return {
        key: rating.provider,
        label,
        fallback: label.slice(0, 2).toUpperCase(),
        iconUrl: link?.iconUrl ?? providerIconPathSafe(rating.provider),
        url: link?.url ?? null,
        score: meta?.score ?? '',
        tooltip: meta?.tooltip ?? '',
      }
    })
    .filter((badge) => badge.iconUrl)
})

const unlinkedCommunityBadges = computed(() => communityRatingBadges.value.filter((badge) => !badge.url))

const fileProgressRows = computed(() =>
  props.book.files.map((file) => ({
    file,
    progress: fileProgressById.value[file.id] ?? {
      percentage: 0,
      cfi: null,
      pageNumber: null,
      updatedAt: null,
    },
  })),
)
const detailProgressRows = computed(() => fileProgressRows.value.filter(({ progress }) => progress.percentage > 0))

type ProgressRow = {
  label: string
  percentage: number
  color: string
  badgeStyle: Record<string, string>
  finished: boolean
  resetFileId: number | null
}

const KOBO_COLOR = '#f59e0b'

const leftColumnProgressRows = computed<ProgressRow[]>(() => {
  const rows: ProgressRow[] = []

  for (const { file, progress } of detailProgressRows.value) {
    const color = getFormatColor(file.format ?? '?')
    rows.push({
      label: (file.format ?? '?').toUpperCase(),
      percentage: progress.percentage,
      color,
      badgeStyle: { color, borderColor: `${color}66`, backgroundColor: `${color}1a` },
      finished: progress.percentage >= 100,
      resetFileId: file.id,
    })
  }

  if (audiobookProgress.value && audiobookProgress.value.percentage > 0) {
    const audioFile = props.book.files.find((f) => f.id === audiobookProgress.value!.currentFileId)
    const format = audioFile?.format ?? 'audio'
    const color = getFormatColor(format)
    rows.push({
      label: format.toUpperCase(),
      percentage: audiobookProgress.value.percentage,
      color,
      badgeStyle: { color, borderColor: `${color}66`, backgroundColor: `${color}1a` },
      finished: audiobookProgress.value.percentage >= 100,
      resetFileId: audiobookProgress.value.currentFileId,
    })
  }
  const koboPercent = koboState.value?.readingState?.progressPercent
  if (canViewKobo.value && koboPercent != null && koboPercent > 0) {
    rows.push({
      label: 'Kobo',
      percentage: koboPercent,
      color: KOBO_COLOR,
      badgeStyle: { color: KOBO_COLOR, borderColor: `${KOBO_COLOR}66`, backgroundColor: `${KOBO_COLOR}1a` },
      finished: koboPercent >= 100,
      resetFileId: null,
    })
  }
  if (canViewKoreader.value && koreaderBookProgress.value != null && koreaderBookProgress.value.canonicalPercentage > 0) {
    const koreaderColor = '#b3b910'
    rows.push({
      label: 'KO-R',
      percentage: koreaderBookProgress.value.canonicalPercentage,
      color: koreaderColor,
      badgeStyle: { color: koreaderColor, borderColor: `${koreaderColor}66`, backgroundColor: `${koreaderColor}1a` },
      finished: koreaderBookProgress.value.canonicalPercentage >= 100,
      resetFileId: null,
    })
  }
  return rows
})

const leftColumnProgressVisible = computed(() => leftColumnProgressRows.value.slice(0, 3))
const leftColumnProgressOverflow = computed(() => Math.max(0, leftColumnProgressRows.value.length - 3))

function formatKoboDeviceNames(snapshots: BookKoboState['snapshots']): string {
  const names = snapshots.map((snapshot) => snapshot.deviceName)
  if (names.length === 1) return names.join('')
  if (names.length === 2) return names.join(' and ')
  return `${snapshots.length} devices`
}

const koboAnomaly = computed(() => {
  if (!canViewKobo.value) return null
  const snapshots = koboState.value?.snapshots ?? []
  const pendingDelete = snapshots.filter((snapshot) => snapshot.pendingDelete)
  if (pendingDelete.length > 0) {
    return { label: `Pending delete on ${formatKoboDeviceNames(pendingDelete)}`, tooltip: 'Kobo will remove it on the next sync.' }
  }
  const removedByDevice = snapshots.filter((snapshot) => snapshot.removedByDevice)
  if (removedByDevice.length > 0) {
    return { label: `Removed on ${formatKoboDeviceNames(removedByDevice)}`, tooltip: 'Kobo reported this book removed.' }
  }
  const unsynced = snapshots.filter((snapshot) => snapshot.synced === false)
  if (unsynced.length > 0) {
    return { label: `Not synced on ${formatKoboDeviceNames(unsynced)}`, tooltip: 'Queued for the next Kobo sync.' }
  }
  return null
})

function formatSeriesLabel(seriesName: string, seriesIndex: number | null): string {
  if (seriesIndex == null) return seriesName
  const formattedIndex = seriesIndex % 1 === 0 ? Math.floor(seriesIndex) : seriesIndex
  return `${seriesName} #${formattedIndex}`
}

const seriesLinks = computed<SeriesDisplayLink[]>(() => {
  const memberships = props.book.seriesMemberships ?? []
  if (memberships.length > 0) {
    return memberships
      .filter((membership) => membership.seriesName.trim().length > 0)
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder || a.seriesId - b.seriesId)
      .map((membership) => ({
        key: `${membership.seriesId}-${membership.displayOrder}`,
        seriesId: membership.seriesId,
        label: formatSeriesLabel(membership.seriesName, membership.seriesIndex),
      }))
  }

  if (!props.book.seriesName) return []
  return [
    {
      key: `primary-${props.book.seriesId ?? 'unknown'}`,
      seriesId: props.book.seriesId ?? null,
      label: formatSeriesLabel(props.book.seriesName, props.book.seriesIndex),
    },
  ]
})

function formatDateTime(iso: string): string {
  return formatLocaleDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  if (clamped > 0 && clamped < 1) return '<1%'
  if (clamped > 99 && clamped < 100) return '>99%'
  return `${Math.round(clamped)}%`
}

function formatDate(iso: string): string {
  return formatLocaleDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatBadgeStyle(fmt: string) {
  const color = getFormatColor(fmt)
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}1a`,
  }
}

function providerLinkStyle(provider: string) {
  const color = getProviderColor(provider)
  return {
    borderColor: `${color}66`,
    backgroundColor: `${color}12`,
  }
}

function handleEditMetadataFromScore() {
  scoreBreakdownOpen.value = false
  router.push({ name: 'book-detail', params: { bookId: props.book.id }, query: { tab: 'edit' } })
}

function handleDeleteFromMenu() {
  moreMenuOpen.value = false
  mobileMoreMenuOpen.value = false
  promptDelete(props.book.id)
}

function handleSendFromMenu() {
  moreMenuOpen.value = false
  mobileMoreMenuOpen.value = false
  showSendDialog.value = true
}

function handleOpenResetReadingState() {
  moreMenuOpen.value = false
  mobileMoreMenuOpen.value = false
  openResetReadingStateDialog()
}

async function handleResetReadingState() {
  const result = await resetReadingState()
  if (!result) return

  await loadSupplemental()
  emit('saved', { ...props.book, readStatus: result.readStatus })
}

function handleCoverLoad(ratio: number | null) {
  coverLoaded.value = true
  coverFailed.value = false
  coverImageRatio.value = ratio
}

function handleCoverError() {
  coverLoaded.value = false
  coverFailed.value = true
  coverImageRatio.value = null
}

function handleCoverClick() {
  if (hasCover.value && coverLoaded.value && !coverFailed.value) {
    coverLightboxOpen.value = true
  }
}

function openEditCover() {
  router.push({ name: 'book-detail', params: { bookId: props.book.id }, query: { tab: 'edit' } })
}

function openBookWithMode(mode?: 'peek') {
  if (!primaryFile.value) return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: primaryFile.value.id },
    query: mode === 'peek' ? { format: primaryFile.value.format ?? 'epub', mode } : { format: primaryFile.value.format ?? 'epub' },
  })
}

function openBook() {
  openBookWithMode()
}

function peekBook() {
  openBookWithMode('peek')
}

function openBookFile(file: BookDetail['files'][number], mode?: 'peek') {
  readMenuOpen.value = false
  mobileReadMenuOpen.value = false
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function isResettingFile(fileId: number | null): boolean {
  return fileId != null && resettingFileIds.value.includes(fileId)
}

function setFileResetting(fileId: number, resetting: boolean): void {
  if (resetting) {
    if (resettingFileIds.value.includes(fileId)) return
    resettingFileIds.value = [...resettingFileIds.value, fileId]
    return
  }
  resettingFileIds.value = resettingFileIds.value.filter((id) => id !== fileId)
}

async function handleResetFileProgress(row: ProgressRow) {
  const fileId = row.resetFileId
  if (fileId == null || isResettingFile(fileId)) return
  if (!window.confirm(t('book.detail.details.resetProgressConfirm', { label: row.label }))) return

  setFileResetting(fileId, true)
  try {
    const res = await api(`/api/v1/books/files/${fileId}/progress`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to reset file progress')
    await loadSupplemental()
  } finally {
    setFileResetting(fileId, false)
  }
}

let supplementalRequestId = 0

async function loadSupplemental() {
  const requestId = ++supplementalRequestId
  supplementalLoading.value = true
  const hasAudio = props.book.files.some((f) => f.format && FORMAT_TO_GROUP[f.format] === 'audio')
  try {
    const progressPromise = api(`/api/v1/books/${props.book.id}/progress`).catch(() => null)
    const audioProgressPromise = hasAudio ? api(`/api/v1/books/${props.book.id}/audio-progress`).catch(() => null) : Promise.resolve(null)
    const collectionsPromise = api('/api/v1/collections/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [props.book.id] }),
    })
    const koboPromise = canViewKobo.value ? api(`/api/v1/books/${props.book.id}/kobo-state`) : Promise.resolve(null)
    const koreaderProgressPromise = canViewKoreader.value ? fetchKoreaderProgress(props.book.id) : Promise.resolve()

    const [progressRes, audioProgressRes, collectionsRes, koboRes] = await Promise.all([
      progressPromise,
      audioProgressPromise,
      collectionsPromise,
      koboPromise,
    ])
    await koreaderProgressPromise

    if (requestId !== supplementalRequestId) return

    const progressRows: FileProgressRow[] = progressRes && progressRes.ok ? ((await progressRes.json()) as FileProgressRow[]) : []
    const progressMap: Record<number, FileProgress> = {}
    for (const row of progressRows) {
      if (!Number.isFinite(row.fileId)) continue
      progressMap[row.fileId] = {
        percentage: row.percentage,
        cfi: row.cfi,
        pageNumber: row.pageNumber,
        updatedAt: row.updatedAt,
      }
    }
    fileProgressById.value = progressMap

    if (audioProgressRes && audioProgressRes.ok) {
      const data = await audioProgressRes.json()
      audiobookProgress.value = data
        ? {
            percentage: data.percentage,
            currentFileId: data.currentFileId,
            positionSeconds: data.positionSeconds,
            updatedAt: data.updatedAt ?? null,
          }
        : null
    } else {
      audiobookProgress.value = null
    }

    const fetchedCollections = collectionsRes.ok ? ((await collectionsRes.json()) as CollectionMembership[]) : []
    collections.value = fetchedCollections.filter((collection) => (collection.memberCount ?? 0) > 0)

    if (canViewKobo.value) {
      const fallbackSyncCollections = collections.value.filter((c) => c.syncToKobo && (c.memberCount ?? 0) > 0).map((c) => c.name)
      if (koboRes && koboRes.ok) {
        const data = (await koboRes.json()) as BookKoboState
        koboState.value = {
          ...data,
          syncCollections: data.syncCollections.length > 0 ? data.syncCollections : fallbackSyncCollections,
        }
      } else {
        koboState.value = {
          eligibleForKoboSync: fallbackSyncCollections.length > 0,
          syncCollections: fallbackSyncCollections,
          readingState: null,
          snapshots: [],
        }
      }
    } else {
      koboState.value = null
    }
  } catch {
    if (requestId !== supplementalRequestId) return
    fileProgressById.value = {}
    audiobookProgress.value = null
    collections.value = []
    koboState.value = canViewKobo.value
      ? {
          eligibleForKoboSync: false,
          syncCollections: [],
          readingState: null,
          snapshots: [],
        }
      : null
  } finally {
    if (requestId === supplementalRequestId) supplementalLoading.value = false
  }
}

watch(
  () => `${props.book.id}:${props.book.files.map((f) => f.id).join(',')}:${canViewKobo.value ? 'kobo' : 'nokobo'}`,
  () => {
    providerIconErrors.value = {}
    void loadSupplemental()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="book.status === 'missing'" class="mb-6 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
    <TriangleAlert class="size-4 text-amber-500 shrink-0 mt-0.5" />
    <div>
      <p class="text-sm font-medium text-amber-600 dark:text-amber-400">{{ t('book.detail.details.filesNotFound') }}</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        {{ t('book.detail.details.filesNotFoundDescription') }}
      </p>
    </div>
  </div>

  <!-- Mobile-only hero: compact cover thumbnail + identity info + action buttons -->
  <div class="md:hidden mb-6">
    <div class="flex gap-4 mb-4 items-start">
      <!-- Cover thumbnail -->
      <div class="w-28 shrink-0">
        <BookCoverSurface
          class="book-cover-surface--spine-fitted relative w-full rounded-sm overflow-hidden"
          :disable-spine="isPrimaryAudio"
          :is-comic="isPrimaryComic"
          :class="hasCover && coverLoaded && !coverFailed ? 'cursor-zoom-in' : ''"
          :style="{ aspectRatio: detailCoverAspectRatio }"
          @click="handleCoverClick"
        >
          <BookCoverArtwork
            :src="coverSrc"
            :has-cover="hasCover"
            :title="coverPlaceholderTitle"
            :author-line="book.authors.map((a) => a.name).join(', ') || null"
            :is-audio="isPrimaryAudio"
            :seed="coverSeed"
            :alt="book.title ?? ''"
            :frame-aspect-ratio="detailCoverAspectRatio"
            loading="eager"
            backdrop-class="blur-lg brightness-50"
            :spine="!isPrimaryAudio"
            :is-comic="isPrimaryComic"
            @load="handleCoverLoad"
            @error="handleCoverError"
          />
        </BookCoverSurface>
      </div>
      <!-- Identity info -->
      <div class="flex-1 min-w-0">
        <h1 class="text-base font-bold leading-snug break-words">{{ book.title ?? t('book.detail.details.untitled') }}</h1>
        <p v-if="book.subtitle" class="text-sm text-muted-foreground mt-1 leading-snug break-words">{{ book.subtitle }}</p>

        <div class="mt-2">
          <Popover :open="mobileScoreBreakdownOpen" @update:open="(v) => (mobileScoreBreakdownOpen = v)">
            <PopoverTrigger as-child>
              <MetadataScoreBadge :score="book.metadataScore" />
            </PopoverTrigger>
            <PopoverContent class="w-72 p-4" align="start">
              <p class="text-sm font-semibold mb-3">{{ t('book.detail.details.metadataScore') }}</p>
              <MetadataScoreBreakdown :book="book" :weights="scoreWeights" @edit-metadata="handleEditMetadataFromScore" />
            </PopoverContent>
          </Popover>
        </div>

        <!-- Author / narrator / series -->
        <div class="mt-2 space-y-1 min-w-0">
          <p v-if="authorLinks.length" class="text-xs break-words">
            <span class="text-muted-foreground">{{ t('book.detail.details.by') }}</span>
            <span class="ml-1 font-medium text-foreground">
              <template v-for="(author, index) in authorLinks" :key="`${author.id}-${index}`">
                <RouterLink
                  :to="{ name: 'author-detail', params: { id: author.id } }"
                  class="hover:text-primary hover:underline underline-offset-2 transition-colors"
                  >{{ author.name }}</RouterLink
                ><span v-if="index < authorLinks.length - 1">, </span>
              </template>
            </span>
          </p>
          <p v-if="narratorLine" class="text-xs break-words">
            <span class="text-muted-foreground">{{ t('book.detail.details.narratedBy') }}</span>
            <span class="ml-1 font-medium text-foreground">{{ narratorLine }}</span>
          </p>
          <div v-if="seriesLinks.length" class="flex flex-wrap gap-1">
            <template v-for="series in seriesLinks" :key="series.key">
              <RouterLink
                v-if="series.seriesId != null"
                :to="{ name: 'series-detail', params: { seriesId: series.seriesId } }"
                class="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                >{{ series.label }}</RouterLink
              >
              <span v-else class="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ series.label }}</span>
            </template>
          </div>
        </div>
        <!-- Stars: own row -->
        <div class="mt-2 flex items-center gap-0.5" @mouseleave="hoverRating = null">
          <div class="flex items-center gap-0.5">
            <template v-if="canEditMetadata">
              <Tooltip v-for="star in ratingStars" :key="star">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="p-1 transition-colors"
                    :class="isRatingLocked ? 'pointer-events-none' : 'disabled:opacity-50'"
                    :disabled="isRatingLocked"
                    @mouseenter="hoverRating = star"
                    @click="setRating(star)"
                  >
                    <Star class="size-4" :class="getRatingStarClass(star, displayRating)" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{
                  isRatingLocked ? t('book.detail.details.ratingLocked') : t('book.detail.details.rateStar', { star })
                }}</TooltipContent>
              </Tooltip>
            </template>
            <template v-else>
              <Star v-for="star in ratingStars" :key="star" class="size-4" :class="getRatingStarClass(star, localRating)" />
            </template>
          </div>
          <template v-if="isRatingLocked">
            <div class="ml-1 p-1 rounded-full bg-primary/10 text-primary">
              <Lock class="size-3" />
            </div>
          </template>
        </div>
        <div v-if="communityRatingBadges.length" class="mt-2 flex flex-wrap items-center gap-1.5">
          <component
            :is="badge.url ? 'a' : 'span'"
            v-for="badge in communityRatingBadges"
            :key="badge.key"
            :href="badge.url ?? undefined"
            :target="badge.url ? '_blank' : undefined"
            :rel="badge.url ? 'noopener noreferrer' : undefined"
            :title="badge.tooltip"
            class="inline-flex h-6 items-center overflow-hidden rounded-md border transition-colors"
            :class="badge.url ? 'hover:bg-muted/60' : ''"
            :style="providerLinkStyle(badge.key)"
          >
            <span class="flex size-6 items-center justify-center">
              <img
                v-if="!providerIconErrors[badge.key]"
                :src="badge.iconUrl ?? undefined"
                :alt="badge.label"
                class="size-3.5 rounded-[2px] object-contain"
                loading="lazy"
                @error="providerIconErrors[badge.key] = true"
              />
              <span v-else class="text-[8px] font-bold leading-none text-foreground/90">{{ badge.fallback }}</span>
            </span>
            <span
              class="flex h-full items-center border-l border-border/60 bg-background/50 px-1.5 text-[11px] font-semibold tabular-nums text-foreground"
            >
              {{ badge.score }}
            </span>
          </component>
        </div>
        <!-- Read status + Personal Review row -->
        <div class="mt-1 flex items-center gap-1.5 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-1">
                <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-3.5" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                {{ STATUS_OPTIONS.find((o) => o.value === (localReadStatus ?? 'unread'))?.label }}
                <ChevronDown class="size-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetReadStatus(opt.value)">
                <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                {{ opt.label }}
                <Check v-if="localReadStatus === opt.value" class="size-3 ml-auto text-primary" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div class="w-px h-3.5 bg-border mx-1" />

          <button
            type="button"
            :aria-label="t('book.detail.details.personalReview.toggleAria')"
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-1"
            :class="{ 'text-primary hover:text-primary/80': showPersonalReview }"
            @click="togglePersonalReview"
          >
            <StickyNote class="size-3.5" />
            <span>{{ t('book.detail.details.personalReview.title') }}</span>
            <span v-if="hasPersonalNote" class="size-1.5 rounded-full bg-primary" />
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile action buttons: single row -->
    <div class="flex gap-2 mt-3 pt-3 border-t border-border">
      <div v-if="hasMultipleFiles" class="flex flex-1 h-9 rounded-md overflow-hidden">
        <button
          class="flex flex-1 items-center justify-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="!primaryFile"
          @click="openBook"
        >
          <Headphones v-if="isPrimaryAudio" class="size-4" />
          <BookOpen v-else class="size-4" />
          {{ isPrimaryAudio ? t('book.detail.details.listen') : t('book.detail.details.read') }}
        </button>
        <div class="w-px bg-primary-foreground/20 shrink-0" />
        <Popover :open="mobileReadMenuOpen" @update:open="(v) => (mobileReadMenuOpen = v)">
          <PopoverTrigger as-child>
            <button
              class="w-8 shrink-0 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              :title="t('book.detail.details.chooseFormat')"
            >
              <ChevronDown class="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-52 p-1" align="end">
            <button
              v-for="file in openableFiles"
              :key="file.id"
              class="flex w-full items-center gap-2.5 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
              @click="openBookFile(file)"
            >
              <span
                class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                :style="formatBadgeStyle(file.format ?? '?')"
                >{{ file.format ?? '?' }}</span
              >
              <span class="flex-1 text-left text-muted-foreground text-xs truncate">
                <template v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">{{ t('book.detail.details.audiobook') }}</template>
                <template v-else>{{ formatFileSize(file.sizeBytes) }}</template>
              </span>
              <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="text-[10px] text-primary font-medium shrink-0">{{
                t('book.detail.details.primary')
              }}</span>
            </button>
          </PopoverContent>
        </Popover>
      </div>
      <button
        v-else
        class="flex flex-1 items-center justify-center gap-1.5 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        :disabled="!primaryFile"
        @click="openBook"
      >
        <Headphones v-if="isPrimaryAudio" class="size-4" />
        <BookOpen v-else class="size-4" />
        {{ isPrimaryAudio ? t('book.detail.details.listen') : t('book.detail.details.read') }}
      </button>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex items-center justify-center h-9 w-12 rounded-md border border-input bg-background hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="!primaryFile"
            :aria-label="t('book.detail.details.peek')"
            @click="peekBook"
          >
            <Eye class="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('book.detail.details.peek') }}</TooltipContent>
      </Tooltip>
      <div v-if="hasPermission('library_download')" class="w-12 shrink-0">
        <BookDownloadButton :files="book.files" :book-id="book.id" />
      </div>
      <button
        class="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors"
        @click="addToCollectionOpen = true"
      >
        <Library class="size-3.5" />
      </button>
      <button
        v-if="hasPermission('email_send')"
        class="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors"
        :aria-label="t('book.detail.details.sendViaEmail')"
        @click="handleSendFromMenu"
      >
        <Send class="size-3.5" />
      </button>
      <Popover
        v-if="canEditMetadata || hasPermission('library_delete_books')"
        :open="mobileMoreMenuOpen"
        @update:open="(v) => (mobileMoreMenuOpen = v)"
      >
        <PopoverTrigger as-child>
          <button
            class="flex items-center justify-center h-9 w-9 rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10 transition-colors"
          >
            <MoreVertical class="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-44 p-1" align="end">
          <button
            v-if="canEditMetadata"
            class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
            @click="handleOpenResetReadingState"
          >
            <RotateCcw class="size-3.5" />
            Reset reading state
          </button>
          <button
            v-if="hasPermission('library_delete_books')"
            class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
            @click="handleDeleteFromMenu"
          >
            <Trash2 class="size-3.5" />
            {{ t('common.delete') }}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  </div>

  <div class="flex flex-col md:flex-row gap-8">
    <!-- Left column: cover + actions (desktop only) -->
    <div class="hidden md:block md:w-56 shrink-0 md:sticky md:top-0 md:self-start">
      <div class="max-w-48 mx-auto md:max-w-none">
        <BookCoverSurface
          class="book-cover-surface--spine-fitted group relative w-full rounded-sm overflow-hidden"
          :disable-spine="isPrimaryAudio"
          :is-comic="isPrimaryComic"
          :class="hasCover && coverLoaded && !coverFailed ? 'cursor-zoom-in' : ''"
          :style="{ aspectRatio: detailCoverAspectRatio }"
          @click="handleCoverClick"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="openEditCover"
              >
                <Pencil class="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('book.detail.details.editCover') }}</TooltipContent>
          </Tooltip>
          <BookCoverArtwork
            :src="coverSrc"
            :has-cover="hasCover"
            :title="coverPlaceholderTitle"
            :author-line="book.authors.map((a) => a.name).join(', ') || null"
            :is-audio="isPrimaryAudio"
            :seed="coverSeed"
            :alt="book.title ?? ''"
            :frame-aspect-ratio="detailCoverAspectRatio"
            loading="eager"
            backdrop-class="blur-lg brightness-50"
            :spine="!isPrimaryAudio"
            :is-comic="isPrimaryComic"
            @load="handleCoverLoad"
            @error="handleCoverError"
          />
        </BookCoverSurface>

        <div class="mt-4 space-y-2">
          <div class="flex gap-2">
            <!-- Read/Play button: split when multiple files, plain when single -->
            <div v-if="hasMultipleFiles" class="flex flex-1 h-9 rounded-md overflow-hidden">
              <button
                class="flex flex-1 items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="!primaryFile"
                @click="openBook"
              >
                <BookOpen v-if="isPrimaryAudio" class="size-4" />
                <BookOpen v-else class="size-4" />
                {{ isPrimaryAudio ? t('book.detail.details.listen') : t('book.detail.details.read') }}
              </button>
              <div class="w-px bg-primary-foreground/20 shrink-0" />
              <Popover :open="readMenuOpen" @update:open="(v) => (readMenuOpen = v)">
                <PopoverTrigger as-child>
                  <button
                    class="w-8 shrink-0 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    :title="t('book.detail.details.chooseFormat')"
                  >
                    <ChevronDown class="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent class="w-52 p-1" align="end">
                  <button
                    v-for="file in openableFiles"
                    :key="file.id"
                    class="flex w-full items-center gap-2.5 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
                    @click="openBookFile(file)"
                  >
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                      :style="formatBadgeStyle(file.format ?? '?')"
                      >{{ file.format ?? '?' }}</span
                    >
                    <span class="flex-1 text-left text-muted-foreground text-xs truncate">
                      <template v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">{{
                        t('book.detail.details.audiobook')
                      }}</template>
                      <template v-else>{{ formatFileSize(file.sizeBytes) }}</template>
                    </span>
                    <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="text-[10px] text-primary font-medium shrink-0">{{
                      t('book.detail.details.primary')
                    }}</span>
                  </button>
                </PopoverContent>
              </Popover>
            </div>
            <button
              v-else
              class="flex flex-1 items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="!primaryFile"
              @click="openBook"
            >
              <Headphones v-if="isPrimaryAudio" class="size-4" />
              <BookOpen v-else class="size-4" />
              {{ isPrimaryAudio ? t('book.detail.details.listen') : t('book.detail.details.read') }}
            </button>

            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center h-9 w-12 shrink-0 rounded-md border border-input bg-background hover:bg-muted transition-colors disabled:opacity-50"
                  :disabled="!primaryFile"
                  :aria-label="t('book.detail.details.peek')"
                  @click="peekBook"
                >
                  <Eye class="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('book.detail.details.peek') }}</TooltipContent>
            </Tooltip>
          </div>

          <div class="flex gap-2">
            <div v-if="hasPermission('library_download')" class="flex-1">
              <BookDownloadButton :files="book.files" :book-id="book.id" />
            </div>
            <button
              class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
              @click="addToCollectionOpen = true"
            >
              <Library class="size-3.5" />
            </button>
            <button
              v-if="hasPermission('email_send')"
              class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
              :aria-label="t('book.detail.details.sendViaEmail')"
              @click="handleSendFromMenu"
            >
              <Send class="size-3.5" />
            </button>
            <Popover v-if="canEditMetadata || hasPermission('library_delete_books')" :open="moreMenuOpen" @update:open="(v) => (moreMenuOpen = v)">
              <PopoverTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <MoreVertical class="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-44 p-1" align="end">
                <button
                  v-if="canEditMetadata"
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  @click="handleOpenResetReadingState"
                >
                  <RotateCcw class="size-3.5" />
                  Reset reading state
                </button>
                <button
                  v-if="hasPermission('library_delete_books')"
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  @click="handleDeleteFromMenu"
                >
                  <Trash2 class="size-3.5" />
                  Delete book
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div v-if="leftColumnProgressVisible.length" class="mt-4 space-y-2">
          <div v-for="row in leftColumnProgressVisible" :key="row.label" class="flex items-center gap-2 cursor-default">
            <span
              class="w-11 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border"
              :style="row.badgeStyle"
              >{{ row.label }}</span
            >
            <div class="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full"
                :style="{
                  width: `${Math.min(100, row.percentage)}%`,
                  backgroundColor: row.finished ? 'rgb(34 197 94 / 0.8)' : row.color,
                  opacity: row.finished ? '1' : '0.75',
                }"
              />
            </div>
            <span v-if="row.finished" class="text-[11px] font-medium text-green-500 shrink-0">{{ t('book.detail.details.finished') }}</span>
            <span v-else class="text-[11px] text-muted-foreground shrink-0 w-7 text-right">{{ formatPercent(row.percentage) }}</span>
            <Tooltip v-if="row.resetFileId != null">
              <TooltipTrigger as-child>
                <button
                  class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :aria-label="t('book.detail.details.resetFileProgress')"
                  :disabled="isResettingFile(row.resetFileId)"
                  @click.stop="void handleResetFileProgress(row)"
                >
                  <RotateCcw class="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                isResettingFile(row.resetFileId) ? t('book.detail.details.resetting') : t('book.detail.details.resetFileProgress')
              }}</TooltipContent>
            </Tooltip>
          </div>
          <p v-if="leftColumnProgressOverflow > 0" class="text-[11px] text-muted-foreground">
            {{ t('book.detail.details.moreCount', { count: leftColumnProgressOverflow }) }}
          </p>
        </div>
        <Tooltip v-if="koboAnomaly">
          <TooltipTrigger as-child>
            <div class="mt-2 flex items-center gap-1.5 cursor-help" tabindex="0">
              <TriangleAlert class="size-3 text-amber-500 shrink-0" />
              <p class="text-[11px] text-amber-500">{{ koboAnomaly.label }}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent>{{ koboAnomaly.tooltip }}</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Right column -->
    <div class="flex-1 min-w-0">
      <div class="hidden md:block">
        <!-- Identity block -->
        <div class="flex items-center flex-wrap gap-x-3 gap-y-2 -mt-1">
          <h1 class="text-2xl font-bold leading-tight">{{ book.title ?? t('book.detail.details.untitled') }}</h1>
          <Popover :open="scoreBreakdownOpen" @update:open="(v) => (scoreBreakdownOpen = v)">
            <PopoverTrigger as-child>
              <MetadataScoreBadge :score="book.metadataScore" />
            </PopoverTrigger>
            <PopoverContent class="w-72 p-4" align="start">
              <p class="text-sm font-semibold mb-3">{{ t('book.detail.details.metadataScore') }}</p>
              <MetadataScoreBreakdown :book="book" :weights="scoreWeights" @edit-metadata="handleEditMetadataFromScore" />
            </PopoverContent>
          </Popover>
        </div>
        <p v-if="book.subtitle" class="text-base text-muted-foreground mt-1 leading-snug">{{ book.subtitle }}</p>

        <div class="flex items-baseline flex-wrap gap-x-2 gap-y-1 mt-3">
          <p v-if="authorLinks.length" class="text-sm">
            <span class="text-muted-foreground">{{ t('book.detail.details.by') }}</span>
            <span class="ml-1 font-medium text-foreground">
              <template v-for="(author, index) in authorLinks" :key="`${author.id}-${index}`">
                <RouterLink
                  :to="{ name: 'author-detail', params: { id: author.id } }"
                  class="hover:text-primary hover:underline underline-offset-2 transition-colors"
                  >{{ author.name }}</RouterLink
                ><span v-if="index < authorLinks.length - 1">, </span>
              </template>
            </span>
          </p>
          <p v-if="narratorLine" class="text-sm">
            <span class="text-muted-foreground">{{ t('book.detail.details.narratedBy') }}</span>
            <span class="ml-1 font-medium text-foreground">{{ narratorLine }}</span>
          </p>
          <template v-if="seriesLinks.length">
            <span class="text-muted-foreground/60 text-xs">·</span>
            <span class="inline-flex flex-wrap items-center gap-1">
              <template v-for="series in seriesLinks" :key="series.key">
                <RouterLink
                  v-if="series.seriesId != null"
                  :to="{ name: 'series-detail', params: { seriesId: series.seriesId } }"
                  class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                  >{{ series.label }}</RouterLink
                >
                <span v-else class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ series.label }}</span>
              </template>
            </span>
          </template>
        </div>

        <div class="mt-3 flex items-center gap-1" @mouseleave="hoverRating = null">
          <div class="flex items-center gap-1">
            <template v-if="canEditMetadata">
              <Tooltip v-for="star in ratingStars" :key="star">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="p-0.5 transition-colors"
                    :class="isRatingLocked ? 'pointer-events-none' : 'disabled:opacity-50'"
                    :disabled="isRatingLocked"
                    @mouseenter="hoverRating = star"
                    @click="setRating(star)"
                  >
                    <Star class="size-3.5" :class="getRatingStarClass(star, displayRating)" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{
                  isRatingLocked ? t('book.detail.details.ratingLocked') : t('book.detail.details.rateStar', { star })
                }}</TooltipContent>
              </Tooltip>
            </template>
            <template v-else>
              <Star v-for="star in ratingStars" :key="star" class="size-3.5" :class="getRatingStarClass(star, localRating)" />
            </template>
          </div>

          <template v-if="isRatingLocked">
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="ml-1 p-1 rounded-full bg-primary/10 text-primary">
                  <Lock class="size-3" />
                </div>
              </TooltipTrigger>
              <TooltipContent>{{ t('book.detail.details.ratingLocked') }}</TooltipContent>
            </Tooltip>
          </template>

          <div class="w-px h-3.5 bg-border mx-1.5" />

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-3.5" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                {{ STATUS_OPTIONS.find((o) => o.value === (localReadStatus ?? 'unread'))?.label }}
                <ChevronDown class="size-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetReadStatus(opt.value)">
                <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                {{ opt.label }}
                <Check v-if="localReadStatus === opt.value" class="size-3 ml-auto text-primary" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div class="w-px h-3.5 bg-border mx-1.5" />

          <button
            type="button"
            :aria-label="t('book.detail.details.personalReview.toggleAria')"
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            :class="{ 'text-primary hover:text-primary/80': showPersonalReview }"
            @click="togglePersonalReview"
          >
            <StickyNote class="size-3.5" />
            <span>{{ t('book.detail.details.personalReview.title') }}</span>
            <span v-if="hasPersonalNote" class="size-1.5 rounded-full bg-primary" />
          </button>
        </div>
      </div>

      <!-- Collapsible Personal Review container -->
      <div v-show="showPersonalReview" class="mt-4 p-4 border border-border/70 rounded-lg bg-card/60 shadow-sm">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {{ t('book.detail.details.personalReview.title') }}
            </p>
            <p v-if="personalNoteUpdatedLabel && !personalNoteEditing" class="mt-0.5 text-[11px] text-muted-foreground">
              Updated {{ personalNoteUpdatedLabel }}
            </p>
          </div>
          <Tooltip v-if="!personalNoteEditing">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :aria-label="t('book.detail.details.personalReview.editAria')"
                @click="startPersonalNoteEdit"
              >
                <Pencil class="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ hasPersonalNote ? 'Edit personal review' : 'Add personal review' }}</TooltipContent>
          </Tooltip>
        </div>

        <template v-if="personalNoteEditing">
          <textarea
            v-model="personalNoteDraft"
            class="min-h-24 max-h-72 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            rows="4"
            :maxlength="PERSONAL_NOTE_MAX_LENGTH"
            :placeholder="t('book.detail.details.personalReview.placeholder')"
          />
          <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-[11px] text-muted-foreground">{{ personalNoteCharCount }}/{{ PERSONAL_NOTE_MAX_LENGTH }}</p>
            <div class="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    :aria-label="t('book.detail.details.personalReview.clearAria')"
                    :disabled="!canClearPersonalNoteDraft || personalNoteSaving"
                    @click="clearPersonalNoteDraft"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ t('book.detail.details.personalReview.clearAria') }}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    :aria-label="t('book.detail.details.personalReview.cancelEditAria')"
                    :disabled="personalNoteSaving"
                    @click="cancelPersonalNoteEdit"
                  >
                    <X class="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ t('common.cancel') }}</TooltipContent>
              </Tooltip>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canSavePersonalNote"
                @click="savePersonalNote"
              >
                <Check class="size-3.5" />
                {{ personalNoteSaving ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </div>
          <p v-if="personalNoteError" class="mt-2 text-xs text-rose-500">{{ personalNoteError }}</p>
        </template>
        <template v-else-if="hasPersonalNote">
          <p class="line-clamp-4 whitespace-pre-line break-words text-sm leading-relaxed text-foreground/80">{{ personalNotePreview }}</p>
        </template>
        <button
          v-else
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          @click="startPersonalNoteEdit"
        >
          <Pencil class="size-3.5" />
          Add personal review
        </button>
      </div>

      <!-- Format badges + provider links -->
      <div v-if="formats.length || providerLinks.length || unlinkedCommunityBadges.length" class="flex items-center flex-wrap gap-2 mt-0 md:mt-4">
        <span
          v-for="fmt in formats"
          :key="fmt"
          class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
          :style="formatBadgeStyle(fmt)"
        >
          <Tooltip v-if="fmt === primaryFile?.format">
            <TooltipTrigger as-child>
              <span class="size-1.5 rounded-full shrink-0" :style="{ backgroundColor: 'currentColor' }" />
            </TooltipTrigger>
            <TooltipContent>{{ t('book.detail.details.primaryFormat') }}</TooltipContent>
          </Tooltip>
          {{ fmt }}
        </span>
        <div v-if="providerLinks.length || unlinkedCommunityBadges.length" class="flex items-center flex-wrap gap-2 w-full sm:w-auto sm:shrink-0">
          <div class="hidden sm:block w-px h-3.5 bg-border" />
          <a
            v-for="link in providerLinks"
            :key="link.key"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="communityRatingByProvider[link.key]?.tooltip ?? t('book.detail.details.openIn', { provider: link.label })"
            class="inline-flex h-7 items-center overflow-hidden rounded-md border transition-colors hover:bg-muted/60"
            :style="providerLinkStyle(link.key)"
          >
            <span class="flex size-7 items-center justify-center">
              <img
                v-if="!providerIconErrors[link.key]"
                :src="link.iconUrl"
                :alt="link.label"
                class="size-4 rounded-[2px] object-contain"
                loading="lazy"
                @error="providerIconErrors[link.key] = true"
              />
              <span v-else class="text-[8px] font-bold leading-none text-foreground/90">{{ link.fallback }}</span>
            </span>
            <span
              v-if="communityRatingByProvider[link.key]"
              class="flex h-full items-center border-l border-border/60 bg-background/50 px-1.5 text-xs font-semibold tabular-nums text-foreground"
            >
              {{ communityRatingByProvider[link.key]?.score }}
            </span>
          </a>
          <span
            v-for="badge in unlinkedCommunityBadges"
            :key="badge.key"
            :title="badge.tooltip"
            class="inline-flex h-7 items-center overflow-hidden rounded-md border"
            :style="providerLinkStyle(badge.key)"
          >
            <span class="flex size-7 items-center justify-center">
              <img
                v-if="!providerIconErrors[badge.key]"
                :src="badge.iconUrl ?? undefined"
                :alt="badge.label"
                class="size-4 rounded-[2px] object-contain"
                loading="lazy"
                @error="providerIconErrors[badge.key] = true"
              />
              <span v-else class="text-[8px] font-bold leading-none text-foreground/90">{{ badge.fallback }}</span>
            </span>
            <span
              class="flex h-full items-center border-l border-border/60 bg-background/50 px-1.5 text-xs font-semibold tabular-nums text-foreground"
            >
              {{ badge.score }}
            </span>
          </span>
        </div>
      </div>

      <!-- Genres + Tags -->
      <div v-if="book.genres.length || book.tags.length" class="mt-4 space-y-1.5">
        <div v-if="book.genres.length" class="relative">
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-for="(genre, index) in displayedGenres"
              :key="`${genre}-${index}`"
              class="text-xs px-2.5 py-0.5 rounded-full border border-primary/40 text-primary/85"
            >
              {{ genre }}
            </span>
            <button
              v-if="genreHiddenCount > 0"
              type="button"
              class="text-xs font-medium text-foreground/75 hover:text-foreground transition-colors whitespace-nowrap"
              @click="genresExpanded = !genresExpanded"
            >
              {{ genresExpanded ? t('book.detail.details.showLess') : t('book.detail.details.moreCount', { count: genreHiddenCount }) }}
            </button>
          </div>
          <div
            ref="genreMeasureContainer"
            aria-hidden="true"
            class="pointer-events-none absolute left-0 top-0 -z-10 invisible flex w-full flex-wrap gap-1.5"
          >
            <span
              v-for="(genre, index) in book.genres"
              :key="`measure-${genre}-${index}`"
              data-genre-pill="true"
              class="text-xs px-2.5 py-0.5 rounded-full border border-primary/40 text-primary/85"
            >
              {{ genre }}
            </span>
          </div>
        </div>

        <div v-if="book.tags.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in book.tags"
            :key="tag"
            class="text-xs px-2.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            #{{ tag }}
          </span>
        </div>
      </div>

      <!-- Metadata grid -->
      <dl class="mt-5 pt-5 border-t border-border grid grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-4">
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.publisher') }}</dt>
          <template v-if="book.publisher">
            <Tooltip>
              <TooltipTrigger as-child>
                <dd class="text-sm text-foreground mt-0.5 truncate cursor-default">{{ book.publisher }}</dd>
              </TooltipTrigger>
              <TooltipContent>{{ book.publisher }}</TooltipContent>
            </Tooltip>
          </template>
          <dd v-else class="text-sm text-foreground mt-0.5">-</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.published') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.publishedDate ? formatDisplayDate(book.publishedDate) : book.publishedYear || '-' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.language') }}</dt>
          <dd class="text-sm text-foreground mt-0.5 capitalize">{{ book.language || '-' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.pages') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.pageCount || '-' }}</dd>
        </div>
        <div v-if="book.audioMetadata?.durationSeconds != null">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.duration') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ formatDuration(book.audioMetadata.durationSeconds) }}</dd>
        </div>
        <div v-if="book.audioMetadata?.durationSeconds != null">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.edition') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">
            {{ book.audioMetadata.abridged ? t('book.detail.details.abridged') : t('book.detail.details.unabridged') }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.isbn') }}</dt>
          <dd v-if="book.isbn13 || book.isbn10" class="text-sm text-foreground mt-0.5 font-mono space-y-0.5">
            <div v-if="book.isbn13">{{ book.isbn13 }}</div>
            <div v-if="book.isbn10" :class="book.isbn13 ? 'text-xs text-muted-foreground' : ''">{{ book.isbn10 }}</div>
          </dd>
          <dd v-else class="text-sm text-foreground mt-0.5">-</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.fileSize') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ formatFileSize(primaryFile?.sizeBytes) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.library') }}</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.libraryName || '-' }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.added') }}</dt>
          <template v-if="book.addedAt">
            <Tooltip>
              <TooltipTrigger as-child>
                <dd class="text-sm text-foreground mt-0.5 truncate cursor-default">{{ formatDate(book.addedAt) }}</dd>
              </TooltipTrigger>
              <TooltipContent>{{ formatDateTime(book.addedAt) }}</TooltipContent>
            </Tooltip>
          </template>
          <dd v-else class="text-sm text-foreground mt-0.5">-</dd>
        </div>
        <HardcoverBookSyncGridItem :book-id="book.id" />
        <StorygraphBookSyncGridItem :book-id="book.id" />
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.dateStarted') }}</dt>
          <template v-if="isEditingReadingDate('startedAt')">
            <dd class="mt-1">
              <div class="flex items-center gap-1.5">
                <input
                  v-model="draftReadingDates.startedAt"
                  type="date"
                  :max="todayDateInput"
                  class="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                />
                <button
                  class="h-6 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  :disabled="!hasReadingDateFieldChanges('startedAt') || savingReadingDates"
                  @click="saveReadingDateField('startedAt')"
                >
                  {{ savingReadingDates ? t('book.detail.details.saving') : t('common.save') }}
                </button>
                <button
                  class="inline-flex h-6 w-6 items-center justify-center rounded border border-destructive/30 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  :title="t('book.detail.details.cancelDateStartedEdit')"
                  :aria-label="t('book.detail.details.cancelDateStartedEdit')"
                  :disabled="savingReadingDates"
                  @click="cancelReadingDateEdit('startedAt')"
                >
                  <X class="size-3" />
                </button>
              </div>
              <p v-if="readingDatesError" class="mt-1 text-[10px] text-rose-500">{{ readingDatesError }}</p>
            </dd>
          </template>
          <dd v-else class="mt-0.5 flex items-center gap-1.5">
            <span class="text-sm text-foreground">{{ formatDisplayDate(savedReadingDates.startedAt) }}</span>
            <button
              class="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              :title="t('book.detail.details.editDateStarted')"
              :disabled="isEditingAnyReadingDate || savingReadingDates"
              @click="startEditingReadingDate('startedAt')"
            >
              <Pencil class="size-3" />
            </button>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ t('book.detail.details.dateFinished') }}</dt>
          <template v-if="isEditingReadingDate('finishedAt')">
            <dd class="mt-1">
              <div class="flex items-center gap-1.5">
                <input
                  v-model="draftReadingDates.finishedAt"
                  type="date"
                  :max="todayDateInput"
                  class="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                />
                <button
                  class="h-6 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  :disabled="!hasReadingDateFieldChanges('finishedAt') || savingReadingDates"
                  @click="saveReadingDateField('finishedAt')"
                >
                  {{ savingReadingDates ? t('book.detail.details.saving') : t('common.save') }}
                </button>
                <button
                  class="inline-flex h-6 w-6 items-center justify-center rounded border border-destructive/30 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  :title="t('book.detail.details.cancelDateFinishedEdit')"
                  :aria-label="t('book.detail.details.cancelDateFinishedEdit')"
                  :disabled="savingReadingDates"
                  @click="cancelReadingDateEdit('finishedAt')"
                >
                  <X class="size-3" />
                </button>
              </div>
              <p v-if="readingDatesError" class="mt-1 text-[10px] text-rose-500">{{ readingDatesError }}</p>
            </dd>
          </template>
          <dd v-else class="mt-0.5 flex items-center gap-1.5">
            <span class="text-sm text-foreground">{{ formatDisplayDate(savedReadingDates.finishedAt) }}</span>
            <button
              class="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              :title="t('book.detail.details.editDateFinished')"
              :disabled="isEditingAnyReadingDate || savingReadingDates"
              @click="startEditingReadingDate('finishedAt')"
            >
              <Pencil class="size-3" />
            </button>
          </dd>
        </div>
      </dl>

      <!-- Mobile-only: reading progress from left column -->
      <div v-if="leftColumnProgressVisible.length || koboAnomaly" class="md:hidden mt-6 pt-5 border-t border-border space-y-3">
        <div v-if="leftColumnProgressVisible.length" class="space-y-2">
          <div v-for="row in leftColumnProgressVisible" :key="row.label" class="flex items-center gap-2 cursor-default">
            <span
              class="w-11 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border"
              :style="row.badgeStyle"
              >{{ row.label }}</span
            >
            <div class="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full"
                :style="{
                  width: `${Math.min(100, row.percentage)}%`,
                  backgroundColor: row.finished ? 'rgb(34 197 94 / 0.8)' : row.color,
                  opacity: row.finished ? '1' : '0.75',
                }"
              />
            </div>
            <span v-if="row.finished" class="text-[11px] font-medium text-green-500 shrink-0">{{ t('book.detail.details.finished') }}</span>
            <span v-else class="text-[11px] text-muted-foreground shrink-0 w-7 text-right">{{ formatPercent(row.percentage) }}</span>
            <Tooltip v-if="row.resetFileId != null">
              <TooltipTrigger as-child>
                <button
                  class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :aria-label="t('book.detail.details.resetFileProgress')"
                  :disabled="isResettingFile(row.resetFileId)"
                  @click.stop="void handleResetFileProgress(row)"
                >
                  <RotateCcw class="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{
                isResettingFile(row.resetFileId) ? t('book.detail.details.resetting') : t('book.detail.details.resetFileProgress')
              }}</TooltipContent>
            </Tooltip>
          </div>
          <p v-if="leftColumnProgressOverflow > 0" class="text-[11px] text-muted-foreground">
            {{ t('book.detail.details.moreCount', { count: leftColumnProgressOverflow }) }}
          </p>
        </div>
        <Tooltip v-if="koboAnomaly">
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1.5 cursor-help" tabindex="0">
              <TriangleAlert class="size-3 text-amber-500 shrink-0" />
              <p class="text-[11px] text-amber-500">{{ koboAnomaly.label }}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent>{{ koboAnomaly.tooltip }}</TooltipContent>
        </Tooltip>
      </div>

      <div v-if="filledCustomMetadata.length > 0" class="mt-6 pt-5 border-t border-border">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">{{ t('book.detail.details.customMetadata') }}</p>
        <dl class="grid gap-3 sm:grid-cols-2">
          <div v-for="field in filledCustomMetadata" :key="field.fieldId" class="min-w-0">
            <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{{ field.label }}</dt>
            <dd class="mt-1 text-sm text-foreground break-words">
              <a
                v-if="field.type === 'url' && typeof field.value === 'string'"
                :href="field.value"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline"
              >
                {{ field.value }}
              </a>
              <span v-else>{{ formatCustomMetadataValue(field) }}</span>
            </dd>
          </div>
        </dl>
      </div>

      <!-- Synopsis -->
      <div class="mt-6 pt-5 border-t border-border">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">{{ t('book.detail.details.synopsis') }}</p>
        <div v-if="book.description">
          <div
            class="text-sm leading-relaxed text-foreground/80 transition-all"
            :class="descriptionExpanded ? '' : 'line-clamp-2'"
            v-html="safeDescription"
          />
          <button
            class="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? t('book.detail.details.showLess') : t('book.detail.details.showMore') }}
          </button>
        </div>
        <p v-else class="text-sm text-muted-foreground italic">{{ t('book.detail.details.noDescription') }}</p>
      </div>
    </div>
  </div>

  <DiscoverRow :book-id="book.id" :series-name="book.seriesName" :author-count="book.authors.length" />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :selection-payload="{ bookIds: [book.id] }"
    :selected-count="1"
    @update:open="addToCollectionOpen = $event"
    @done="void loadSupplemental()"
  />

  <SendBookDialog
    v-model:open="showSendDialog"
    :selection-payload="{ bookIds: [book.id] }"
    :selected-count="1"
    :book-title="book.title ?? undefined"
    :book-files="book.files"
  />

  <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />

  <ResetReadingStateDialog
    :open="resetReadingStateDialogOpen"
    :resetting="resettingReadingState"
    :error="resetReadingStateError"
    @close="closeResetReadingStateDialog"
    @confirm="handleResetReadingState"
  />

  <!-- Cover lightbox -->
  <DialogRoot :open="coverLightboxOpen" @update:open="coverLightboxOpen = $event">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <img :src="coverSrc" :alt="book.title ?? ''" class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain" />
        <DialogClose
          class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
