<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Check, ChevronDown, FolderPlus, Headphones, Lock, MoreHorizontal, Pencil, Star, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { getProviderColor } from '@/lib/provider-colors'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@projectx/types'
import type { BookDetail, BookKoboState, ReadStatus } from '@projectx/types'
import { STATUS_OPTIONS, STATUS_ICONS, STATUS_COLORS, useBookStatus } from '@/features/book/composables/useBookStatus'
import BookDownloadButton from '@/features/book/components/BookDownloadButton.vue'
import RecommendedBooksRow from '@/features/book/components/detail/RecommendedBooksRow.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
import { useMetadataLocks } from '@/features/book/composables/useMetadataLocks'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import MetadataScoreBadge from '@/features/metadata-score/components/MetadataScoreBadge.vue'
import MetadataScoreBreakdown from '@/features/metadata-score/components/MetadataScoreBreakdown.vue'
import { useMetadataScoreWeights } from '@/features/metadata-score/composables/useMetadataScoreWeights'

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

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ saved: [BookDetail] }>()
const router = useRouter()

const addToCollectionOpen = ref(false)
const scoreBreakdownOpen = ref(false)
const mobileScoreBreakdownOpen = ref(false)
const moreMenuOpen = ref(false)
const mobileMoreMenuOpen = ref(false)
const readMenuOpen = ref(false)
const mobileReadMenuOpen = ref(false)

const { weights: scoreWeights, fetchWeights } = useMetadataScoreWeights()

onMounted(fetchWeights)

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
const coverLightboxOpen = ref(false)
const descriptionExpanded = ref(false)
const genresExpanded = ref(false)
const genreMeasureContainer = ref<HTMLElement | null>(null)
const genreHiddenCount = ref(0)
const visibleGenreCount = ref(0)
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
const canEditMetadata = computed(() => hasPermission('library_edit_metadata'))

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'cover'))

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
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
const authorLine = computed(() => props.book.authors.map((a) => a.name).join(', ') || null)
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

const ratingStars = [1, 2, 3, 4, 5]

const { setStatus } = useBookStatus()

const localReadStatus = ref<ReadStatus | null>(props.book.readStatus?.status ?? null)
watch(
  () => props.book.readStatus?.status,
  (val) => {
    localReadStatus.value = (val as ReadStatus) ?? null
  },
)

async function handleSetReadStatus(status: ReadStatus) {
  const prev = localReadStatus.value
  localReadStatus.value = status
  try {
    await setStatus(props.book.id, status)
  } catch {
    localReadStatus.value = prev
  }
}

const fileProgressById = ref<Record<number, FileProgress>>({})
const audiobookProgress = ref<{ percentage: number; currentFileId: number; positionSeconds: number; updatedAt: string | null } | null>(null)
const collections = ref<CollectionMembership[]>([])
const koboState = ref<BookKoboState | null>(null)
const supplementalLoading = ref(false)
const providerIconErrors = ref<Record<string, boolean>>({})

const providerLinks = computed<ProviderLink[]>(() => {
  const out: ProviderLink[] = []
  const ids = props.book.providerIds
  if (ids.google) {
    out.push({
      key: 'google',
      label: 'Google Books',
      url: `https://books.google.com/books?id=${ids.google}`,
      iconUrl: 'https://books.google.com/favicon.ico',
      fallback: 'G',
    })
  }
  if (ids.goodreads) {
    out.push({
      key: 'goodreads',
      label: 'Goodreads',
      url: `https://www.goodreads.com/book/show/${ids.goodreads}`,
      iconUrl: 'https://www.goodreads.com/favicon.ico',
      fallback: 'GR',
    })
  }
  if (ids.amazon) {
    out.push({
      key: 'amazon',
      label: 'Amazon',
      url: `https://www.amazon.com/dp/${ids.amazon}`,
      iconUrl: 'https://www.amazon.com/favicon.ico',
      fallback: 'A',
    })
  }
  if (ids.hardcover) {
    out.push({
      key: 'hardcover',
      label: 'Hardcover',
      url: `https://hardcover.app/books/${ids.hardcover}`,
      iconUrl: 'https://assets.hardcover.app/static/favicon.ico',
      fallback: 'H',
    })
  }
  if (ids.openLibrary) {
    const path = String(ids.openLibrary).startsWith('/works/') ? String(ids.openLibrary) : `/works/${ids.openLibrary}`
    out.push({
      key: 'openLibrary',
      label: 'Open Library',
      url: `https://openlibrary.org${path}`,
      iconUrl: 'https://openlibrary.org/favicon.ico',
      fallback: 'OL',
    })
  }
  if (ids.itunes) {
    out.push({
      key: 'itunes',
      label: 'Apple Books',
      url: `https://books.apple.com/book/id${ids.itunes}`,
      iconUrl: 'https://www.apple.com/favicon.ico',
      fallback: '',
    })
  }
  if (ids.audible) {
    out.push({
      key: 'audible',
      label: 'Audible',
      url: `https://www.audible.com/pd/${ids.audible}`,
      iconUrl: 'https://www.audible.com/favicon.ico',
      fallback: 'Au',
    })
  }
  return out
})

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
  tooltipText: string
  finished: boolean
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
      tooltipText: file.absolutePath,
      finished: progress.percentage >= 100,
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
      tooltipText: audioFile?.absolutePath ?? '',
      finished: audiobookProgress.value.percentage >= 100,
    })
  }
  const koboPercent = koboState.value?.readingState?.progressPercent
  if (canViewKobo.value && koboPercent != null && koboPercent > 0) {
    const syncCols = koboState.value?.syncCollections ?? []
    rows.push({
      label: 'Kobo',
      percentage: koboPercent,
      color: KOBO_COLOR,
      badgeStyle: { color: KOBO_COLOR, borderColor: `${KOBO_COLOR}66`, backgroundColor: `${KOBO_COLOR}1a` },
      tooltipText: syncCols.length > 0 ? `Via: ${syncCols.join(', ')}` : 'Kobo device',
      finished: koboPercent >= 100,
    })
  }
  return rows
})

const leftColumnProgressVisible = computed(() => leftColumnProgressRows.value.slice(0, 3))
const leftColumnProgressOverflow = computed(() => Math.max(0, leftColumnProgressRows.value.length - 3))

const koboAnomaly = computed(() => {
  if (!canViewKobo.value) return null
  const snap = koboState.value?.snapshot
  if (!snap) return null
  if (snap.pendingDelete) return 'Pending delete from device'
  if (snap.removedByDevice) return 'Removed by device'
  if (snap.synced === false) return 'Not synced'
  return null
})

const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function handleCoverLoad() {
  coverLoaded.value = true
}

function openEditCover() {
  router.push({ name: 'book-detail', params: { bookId: props.book.id }, query: { tab: 'edit' } })
}

function openBook() {
  if (!primaryFile.value) return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: primaryFile.value.id },
    query: { format: primaryFile.value.format ?? 'epub' },
  })
}

function openBookFile(file: BookDetail['files'][number]) {
  readMenuOpen.value = false
  mobileReadMenuOpen.value = false
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

let supplementalRequestId = 0

async function loadSupplemental() {
  const requestId = ++supplementalRequestId
  supplementalLoading.value = true
  const hasAudio = props.book.files.some((f) => f.format && FORMAT_TO_GROUP[f.format] === 'audio')
  try {
    const progressPromise = api(`/api/v1/books/${props.book.id}/progress`).catch(() => null)
    const audioProgressPromise = hasAudio ? api(`/api/v1/books/${props.book.id}/audio-progress`).catch(() => null) : Promise.resolve(null)
    const collectionsPromise = api(`/api/v1/collections?bookIds=${props.book.id}`)
    const koboPromise = canViewKobo.value ? api(`/api/v1/books/${props.book.id}/kobo-state`) : Promise.resolve(null)

    const [progressRes, audioProgressRes, collectionsRes, koboRes] = await Promise.all([
      progressPromise,
      audioProgressPromise,
      collectionsPromise,
      koboPromise,
    ])

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
          snapshot: null,
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
          snapshot: null,
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
      <p class="text-sm font-medium text-amber-600 dark:text-amber-400">Files not found</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        The file(s) for this book can no longer be found on disk. Metadata is still available. Run a library scan to confirm, or remove the record.
      </p>
    </div>
  </div>

  <!-- Mobile-only hero: compact cover thumbnail + identity info + action buttons -->
  <div class="md:hidden mb-6">
    <div class="flex gap-4 mb-4 items-start">
      <!-- Cover thumbnail -->
      <div class="w-28 shrink-0">
        <div
          class="relative w-full rounded-sm overflow-hidden shadow-md cursor-zoom-in"
          :style="[{ aspectRatio: coverAspectRatio }, !coverLoaded || coverFailed ? coverStyle : {}]"
          @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
        >
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="absolute inset-0 w-full h-full object-cover scale-110 blur-lg brightness-50 transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          />
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="absolute inset-0 w-full h-full object-contain transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            :alt="book.title ?? ''"
            @load="handleCoverLoad"
            @error="coverFailed = true"
          />
        </div>
      </div>
      <!-- Identity info -->
      <div class="flex-1 min-w-0">
        <h1 class="text-base font-bold leading-snug break-words">{{ book.title ?? 'Untitled' }}</h1>
        <p v-if="book.subtitle" class="text-sm text-muted-foreground mt-1 leading-snug break-words">{{ book.subtitle }}</p>

        <div class="mt-2">
          <Popover :open="mobileScoreBreakdownOpen" @update:open="(v) => (mobileScoreBreakdownOpen = v)">
            <PopoverTrigger as-child>
              <MetadataScoreBadge :score="book.metadataScore" />
            </PopoverTrigger>
            <PopoverContent class="w-72 p-4" align="start">
              <p class="text-sm font-semibold mb-3">Metadata Score</p>
              <MetadataScoreBreakdown :book="book" :weights="scoreWeights" @edit-metadata="handleEditMetadataFromScore" />
            </PopoverContent>
          </Popover>
        </div>

        <!-- Author / narrator / series -->
        <div class="mt-2 space-y-1 min-w-0">
          <p v-if="authorLine" class="text-xs break-words">
            <span class="text-muted-foreground">by</span>
            <span class="ml-1 font-medium text-foreground">{{ authorLine }}</span>
          </p>
          <p v-if="narratorLine" class="text-xs break-words">
            <span class="text-muted-foreground">narrated by</span>
            <span class="ml-1 font-medium text-foreground">{{ narratorLine }}</span>
          </p>
          <span v-if="seriesLine" class="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ seriesLine }}</span>
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
                    <Star class="size-4" :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ isRatingLocked ? 'Rating is locked' : `Rate ${star}` }}</TooltipContent>
              </Tooltip>
            </template>
            <template v-else>
              <Star
                v-for="star in ratingStars"
                :key="star"
                class="size-4"
                :class="(localRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'"
              />
            </template>
          </div>
          <template v-if="isRatingLocked">
            <div class="ml-1 p-1 rounded-full bg-primary/10 text-primary">
              <Lock class="size-3" />
            </div>
          </template>
        </div>
        <!-- Read status: own row -->
        <div class="mt-1">
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
          {{ isPrimaryAudio ? 'Listen' : 'Read' }}
        </button>
        <div class="w-px bg-primary-foreground/20 shrink-0" />
        <Popover :open="mobileReadMenuOpen" @update:open="(v) => (mobileReadMenuOpen = v)">
          <PopoverTrigger as-child>
            <button
              class="w-8 shrink-0 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Choose format"
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
                <template v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</template>
                <template v-else>{{ formatFileSize(file.sizeBytes) }}</template>
              </span>
              <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="text-[10px] text-primary font-medium shrink-0">Primary</span>
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
        {{ isPrimaryAudio ? 'Listen' : 'Read' }}
      </button>
      <div v-if="hasPermission('library_download')" class="w-12 shrink-0">
        <BookDownloadButton :files="book.files" :book-id="book.id" />
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors"
            @click="addToCollectionOpen = true"
          >
            <FolderPlus class="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Add to collection</TooltipContent>
      </Tooltip>
      <Popover v-if="hasPermission('library_delete_books')" :open="mobileMoreMenuOpen" @update:open="(v) => (mobileMoreMenuOpen = v)">
        <PopoverTrigger as-child>
          <button class="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors">
            <MoreHorizontal class="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-36 p-1" align="end">
          <button
            class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
            @click="handleDeleteFromMenu"
          >
            <Trash2 class="size-3.5" />
            Delete
          </button>
        </PopoverContent>
      </Popover>
    </div>
  </div>

  <div class="flex flex-col md:flex-row gap-8">
    <!-- Left column: cover + actions (desktop only) -->
    <div class="hidden md:block md:w-56 shrink-0 md:sticky md:top-0 md:self-start">
      <div class="max-w-48 mx-auto md:max-w-none">
        <div
          class="group relative w-full rounded-sm overflow-hidden shadow-md cursor-zoom-in"
          :style="[{ aspectRatio: coverAspectRatio }, !coverLoaded || coverFailed ? coverStyle : {}]"
          @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
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
            <TooltipContent>Edit cover</TooltipContent>
          </Tooltip>
          <!-- Blurred background fill for mismatched aspect ratios -->
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="absolute inset-0 w-full h-full object-cover scale-110 blur-lg brightness-50 transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          />
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="absolute inset-0 w-full h-full object-contain transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            :alt="book.title ?? ''"
            @load="handleCoverLoad"
            @error="coverFailed = true"
          />
        </div>

        <div class="mt-4 space-y-2">
          <!-- Read/Play button: split when multiple files, plain when single -->
          <div v-if="hasMultipleFiles" class="flex w-full h-9 rounded-md overflow-hidden">
            <button
              class="flex flex-1 items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="!primaryFile"
              @click="openBook"
            >
              <BookOpen v-if="isPrimaryAudio" class="size-4" />
              <BookOpen v-else class="size-4" />
              {{ isPrimaryAudio ? 'Listen' : 'Read' }}
            </button>
            <div class="w-px bg-primary-foreground/20 shrink-0" />
            <Popover :open="readMenuOpen" @update:open="(v) => (readMenuOpen = v)">
              <PopoverTrigger as-child>
                <button
                  class="w-8 shrink-0 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  title="Choose format"
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
                    <template v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</template>
                    <template v-else>{{ formatFileSize(file.sizeBytes) }}</template>
                  </span>
                  <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="text-[10px] text-primary font-medium shrink-0">Primary</span>
                </button>
              </PopoverContent>
            </Popover>
          </div>
          <button
            v-else
            class="flex w-full items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="!primaryFile"
            @click="openBook"
          >
            <Headphones v-if="isPrimaryAudio" class="size-4" />
            <BookOpen v-else class="size-4" />
            {{ isPrimaryAudio ? 'Listen' : 'Read' }}
          </button>

          <div class="flex gap-2">
            <div v-if="hasPermission('library_download')" class="flex-1">
              <BookDownloadButton :files="book.files" :book-id="book.id" />
            </div>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
                  @click="addToCollectionOpen = true"
                >
                  <FolderPlus class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add to collection</TooltipContent>
            </Tooltip>
            <Popover v-if="hasPermission('library_delete_books')" :open="moreMenuOpen" @update:open="(v) => (moreMenuOpen = v)">
              <PopoverTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
                >
                  <MoreHorizontal class="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-36 p-1" align="end">
                <button
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  @click="handleDeleteFromMenu"
                >
                  <Trash2 class="size-3.5" />
                  Delete
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div v-if="leftColumnProgressVisible.length" class="mt-4 space-y-2">
          <Tooltip v-for="row in leftColumnProgressVisible" :key="row.label">
            <TooltipTrigger as-child>
              <div class="flex items-center gap-2 cursor-default">
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
                <span v-if="row.finished" class="text-[11px] font-medium text-green-500 shrink-0">Finished</span>
                <span v-else class="text-[11px] text-muted-foreground shrink-0 w-7 text-right">{{ formatPercent(row.percentage) }}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{{ row.tooltipText }}</TooltipContent>
          </Tooltip>
          <p v-if="leftColumnProgressOverflow > 0" class="text-[11px] text-muted-foreground">+{{ leftColumnProgressOverflow }} more</p>
        </div>
        <div v-if="koboAnomaly" class="mt-2 flex items-center gap-1.5">
          <TriangleAlert class="size-3 text-amber-500 shrink-0" />
          <p class="text-[11px] text-amber-500">{{ koboAnomaly }}</p>
        </div>
        <div v-if="collections.length" class="mt-3">
          <span class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground block mb-1.5">Collections</span>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="col in collections"
              :key="col.id"
              class="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
            >
              {{ col.name }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div class="flex-1 min-w-0">
      <div class="hidden md:block">
        <!-- Identity block -->
        <div class="flex items-center flex-wrap gap-x-3 gap-y-2 -mt-1">
          <h1 class="text-2xl font-bold leading-tight">{{ book.title ?? 'Untitled' }}</h1>
          <Popover :open="scoreBreakdownOpen" @update:open="(v) => (scoreBreakdownOpen = v)">
            <PopoverTrigger as-child>
              <MetadataScoreBadge :score="book.metadataScore" />
            </PopoverTrigger>
            <PopoverContent class="w-72 p-4" align="start">
              <p class="text-sm font-semibold mb-3">Metadata Score</p>
              <MetadataScoreBreakdown :book="book" :weights="scoreWeights" @edit-metadata="handleEditMetadataFromScore" />
            </PopoverContent>
          </Popover>
        </div>
        <p v-if="book.subtitle" class="text-base text-muted-foreground mt-1 leading-snug">{{ book.subtitle }}</p>

        <div class="flex items-baseline flex-wrap gap-x-2 gap-y-1 mt-3">
          <p v-if="authorLine" class="text-sm">
            <span class="text-muted-foreground">by</span>
            <span class="ml-1 font-medium text-foreground">{{ authorLine }}</span>
          </p>
          <p v-if="narratorLine" class="text-sm">
            <span class="text-muted-foreground">narrated by</span>
            <span class="ml-1 font-medium text-foreground">{{ narratorLine }}</span>
          </p>
          <template v-if="seriesLine">
            <span class="text-muted-foreground/60 text-xs">·</span>
            <span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ seriesLine }}</span>
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
                    <Star class="size-3.5" :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ isRatingLocked ? 'Rating is locked' : `Rate ${star}` }}</TooltipContent>
              </Tooltip>
            </template>
            <template v-else>
              <Star
                v-for="star in ratingStars"
                :key="star"
                class="size-3.5"
                :class="(localRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'"
              />
            </template>
          </div>

          <template v-if="isRatingLocked">
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="ml-1 p-1 rounded-full bg-primary/10 text-primary">
                  <Lock class="size-3" />
                </div>
              </TooltipTrigger>
              <TooltipContent>Rating is locked</TooltipContent>
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
        </div>
      </div>

      <!-- Format badges + provider links -->
      <div v-if="formats.length || providerLinks.length" class="flex items-center flex-wrap gap-2 mt-0 md:mt-4">
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
            <TooltipContent>Primary format</TooltipContent>
          </Tooltip>
          {{ fmt }}
        </span>
        <div v-if="providerLinks.length" class="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
          <div class="hidden sm:block w-px h-3.5 bg-border" />
          <a
            v-for="link in providerLinks"
            :key="link.key"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="`Open in ${link.label}`"
            class="inline-flex size-7 items-center justify-center rounded-md border transition-colors hover:bg-muted/60"
            :style="providerLinkStyle(link.key)"
          >
            <img
              v-if="!providerIconErrors[link.key]"
              :src="link.iconUrl"
              :alt="link.label"
              class="size-4 rounded-[2px] object-contain"
              loading="lazy"
              @error="providerIconErrors[link.key] = true"
            />
            <span v-else class="text-[8px] font-bold leading-none text-foreground/90">{{ link.fallback }}</span>
          </a>
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
              {{ genresExpanded ? 'Show less' : `+${genreHiddenCount} more` }}
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
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Publisher</dt>
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
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Published</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.publishedYear || '-' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Language</dt>
          <dd class="text-sm text-foreground mt-0.5 capitalize">{{ book.language || '-' }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Pages</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.pageCount || '-' }}</dd>
        </div>
        <div v-if="book.audioMetadata?.durationSeconds != null">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Duration</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ formatDuration(book.audioMetadata.durationSeconds) }}</dd>
        </div>
        <div v-if="book.audioMetadata?.durationSeconds != null">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Edition</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.audioMetadata.abridged ? 'Abridged' : 'Unabridged' }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN</dt>
          <dd v-if="book.isbn13 || book.isbn10" class="text-sm text-foreground mt-0.5 font-mono space-y-0.5">
            <div v-if="book.isbn13">{{ book.isbn13 }}</div>
            <div v-if="book.isbn10" :class="book.isbn13 ? 'text-xs text-muted-foreground' : ''">{{ book.isbn10 }}</div>
          </dd>
          <dd v-else class="text-sm text-foreground mt-0.5">-</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">File Size</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ formatFileSize(primaryFile?.sizeBytes) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Library</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.libraryName || '-' }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Added</dt>
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
      </dl>

      <!-- Mobile-only: reading progress + collections (relocated from left column) -->
      <div v-if="leftColumnProgressVisible.length || koboAnomaly || collections.length" class="md:hidden mt-6 pt-5 border-t border-border space-y-3">
        <div v-if="leftColumnProgressVisible.length" class="space-y-2">
          <Tooltip v-for="row in leftColumnProgressVisible" :key="row.label">
            <TooltipTrigger as-child>
              <div class="flex items-center gap-2 cursor-default">
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
                <span v-if="row.finished" class="text-[11px] font-medium text-green-500 shrink-0">Finished</span>
                <span v-else class="text-[11px] text-muted-foreground shrink-0 w-7 text-right">{{ formatPercent(row.percentage) }}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{{ row.tooltipText }}</TooltipContent>
          </Tooltip>
          <p v-if="leftColumnProgressOverflow > 0" class="text-[11px] text-muted-foreground">+{{ leftColumnProgressOverflow }} more</p>
        </div>
        <div v-if="koboAnomaly" class="flex items-center gap-1.5">
          <TriangleAlert class="size-3 text-amber-500 shrink-0" />
          <p class="text-[11px] text-amber-500">{{ koboAnomaly }}</p>
        </div>
        <div v-if="collections.length">
          <span class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground block mb-1.5">Collections</span>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="col in collections"
              :key="col.id"
              class="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
            >
              {{ col.name }}
            </span>
          </div>
        </div>
      </div>

      <!-- Synopsis -->
      <div class="mt-6 pt-5 border-t border-border">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Synopsis</p>
        <div v-if="book.description">
          <div
            class="text-sm leading-relaxed text-foreground/80 transition-all"
            :class="descriptionExpanded ? '' : 'line-clamp-2'"
            v-html="book.description"
          />
          <button
            class="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          </button>
        </div>
        <p v-else class="text-sm text-muted-foreground italic">No description available.</p>
      </div>
    </div>
  </div>

  <RecommendedBooksRow :book-id="book.id" />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="[book.id]"
    @update:open="addToCollectionOpen = $event"
    @done="void loadSupplemental()"
  />

  <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />

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
