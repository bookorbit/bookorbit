<script setup lang="ts">
import type { BookCard, BookFileRef, ConcreteBookMediaKind, CoverAspectRatio } from '@bookorbit/types'
import { getBookMediaKind, getBookMediaProfile, isAudioFormat, READER_OPENABLE_FORMATS, READ_STATUSES } from '@bookorbit/types'
import BookCardFormatBadges from './BookCardFormatBadges.vue'
import BookCardHoverPanel, { type CardDockAction } from './BookCardHoverPanel.vue'
import BookCardLabel from './BookCardLabel.vue'
import { bookFormatEntries, fileFormatKey, formatKeyName } from '../lib/book-formats'
import { cardMediaView } from '../lib/card-media'
import { cardEditionCount } from '../lib/book-editions'
import { readStatusLabel } from '../lib/read-status-label'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { computed, inject, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import {
  BookOpen,
  BookText,
  Check,
  Download,
  ExternalLink,
  Eye,
  FolderInput,
  FolderPlus,
  Image,
  Layers,
  Lock,
  LockOpen,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from '@lucide/vue'
import { useBookStatus, STATUS_ICONS, STATUS_COLORS } from '../composables/useBookStatus'
import type { ReadStatus } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCoverVersions } from '../composables/useCoverVersions'
import { useRefreshMetadata } from '../composables/useRefreshMetadata'
import { useRefreshingBooks } from '../composables/useRefreshingBooks'
import { mergeBookCardWithDetail } from '../lib/book-card-mapper'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useDisplaySettings, type GridCardLabelField } from '@/composables/useDisplaySettings'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO, coverAspectRatioValue, fittedCoverFrameStyle } from '../lib/cover-aspect-ratio'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { fetchAuthors } from '@/features/author/api/author'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { seriesNameWithPosition, seriesPositionToken } from '@/features/series/lib/series-unit-label'
import { useOpenInNewTab } from '@/composables/useOpenInNewTab'
import { useLongPress } from '../composables/useLongPress'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const { openInNewTab, openInNewTabIfRequested } = useOpenInNewTab()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
  showLabel?: boolean
  coverAspectRatio?: CoverAspectRatio
  /** Opt-in: only views that host the destination sheet should offer this. */
  allowMoveToLibrary?: boolean
  /** The medium the surrounding grid shows, such as a series' Audiobooks group. */
  mediaKind?: ConcreteBookMediaKind | null
}>()

type BookActionType = 'quick-view' | 'add-to-collection' | 'move-to-library' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: [event: MouseEvent]
  'update:book': [updated: BookCard]
}>()

const authorLine = computed(() => props.book.authors.join(', ') || null)
const authorQuery = computed(() => props.book.authors[0] ?? null)

// Card files arrive in edition order, so the first entry is the primary edition.
const formatEntries = computed(() => bookFormatEntries(props.book.files))
/** One file per edition: an audiobook downloads as a whole and opens from its first track. */
const downloadableFiles = computed(() => formatEntries.value.map((entry) => entry.files[0]!))
const openableFiles = computed(() => downloadableFiles.value.filter((file) => READER_OPENABLE_FORMATS.has(file.format!.toLowerCase())))
const mediaView = computed(() => cardMediaView(props.book, props.mediaKind))
const primaryFile = computed(() => {
  const kind = mediaView.value?.kind
  const fileOfKind = kind ? openableFiles.value.find((f) => getBookMediaKind(f.format) === kind) : undefined
  return fileOfKind ?? openableFiles.value.find((f) => f.role === 'primary') ?? openableFiles.value[0] ?? null
})
const primaryDownloadFile = computed(() => downloadableFiles.value[0] ?? null)
const mediaProfile = computed(() => getBookMediaProfile(formatEntries.value.flatMap((entry) => entry.files)))
const formatOverlayKey = computed(() => {
  const kind = mediaView.value?.kind
  const entry = kind ? formatEntries.value.find((e) => getBookMediaKind(e.files[0]?.format) === kind) : formatEntries.value[0]
  return entry?.key ?? null
})
/** Every edition the card offers, the one its media view leads with first; linked formats follow. */
const ownFormatKeys = computed(() => {
  const keys = formatEntries.value.map((entry) => entry.key)
  const lead = formatOverlayKey.value
  return lead ? [lead, ...keys.filter((key) => key !== lead)] : keys
})
const hasFormatBadges = computed(() => ownFormatKeys.value.length > 0 || (props.book.linked?.books.length ?? 0) > 0)
const displayMediaKind = computed(() => mediaView.value?.kind ?? mediaProfile.value.primaryMediaKind)
const isAudiobook = computed(() => displayMediaKind.value === 'audiobook')
const isComic = computed(() => displayMediaKind.value === 'comic')

const isMultiTrackAudio = computed(() => formatEntries.value.some((entry) => entry.audio && entry.files.length > 1))

const { coverUrl, bumpVersion } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'thumbnail', props.book.coverVersion, mediaView.value?.coverMedium))

const { refreshing, refreshWithFeedback } = useRefreshMetadata()
const { isRefreshing } = useRefreshingBooks()
const anyRefreshing = computed(() => refreshing.value || isRefreshing(props.book.id))
const reExtractingCover = ref(false)

async function reExtractCover() {
  if (reExtractingCover.value) return
  reExtractingCover.value = true
  try {
    const res = await fetch(`/api/v1/books/${props.book.id}/re-extract-cover`, { method: 'POST' })
    if (!res.ok) {
      toast.error(t('book.coverRegeneration.failed'))
      return
    }
    bumpVersion(props.book.id)
  } catch {
    toast.error(t('book.coverRegeneration.failed'))
  } finally {
    reExtractingCover.value = false
  }
}

async function handleRefreshMetadata() {
  const updated = await refreshWithFeedback(props.book.id)
  if (updated) emit('update:book', mergeBookCardWithDetail(props.book, updated))
}
const { hasPermission } = usePermissions()
const { hasLibraryPermission } = useLibraryPermissions()
const canEditMetadata = computed(() => hasLibraryPermission('library_edit_metadata', props.book?.libraryId, 'editor'))
const { cardOverlays, formatBadgeStyle, bookCoverDisplayMode, gridCardPrimaryLabel, gridCardSecondaryLabel, cardInfoMode } = useDisplaySettings()
const injectedCoverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const effectiveCoverAspectRatio = computed<CoverAspectRatio>(
  () => props.coverAspectRatio ?? mediaView.value?.coverAspectRatio ?? props.book.coverAspectRatio ?? injectedCoverAspectRatio.value,
)
const showSendDialog = ref(false)

const hasProgress = computed(() => props.book.readingProgress != null && props.book.readingProgress > 0)
const showProgressBar = computed(() => cardOverlays.value.includes('progress-bar') && hasProgress.value)
const showFormatOverlay = computed(() => cardOverlays.value.includes('format') && hasFormatBadges.value)
const showRatingOverlay = computed(() => cardOverlays.value.includes('rating') && props.book.rating != null)
const showLockStatusPill = computed(() => cardOverlays.value.includes('lock-status') && !props.selectionMode && !isMissing.value)
const metadataLocked = computed(() => props.book.hasMetadataLocks)

const showSeriesPositionBadge = computed(
  () => cardOverlays.value.includes('series-position') && props.book.seriesIndex != null && !props.selectionMode && !isMissing.value,
)
const seriesPositionLabel = computed(() => {
  const index = props.book.seriesIndex
  if (index == null) return ''
  return seriesPositionToken(t, index, props.book.seriesUnit, props.book.seriesVolumeIndex)
})
/** Other editions this viewer can see stand behind the card; the pill says how many in all. */
const editionCount = computed(() => cardEditionCount(props.book))
const menuLabel = computed(() => t('book.card.moreActions', { title: props.book.title?.trim() || t('book.untitled') }))
const showEditionsPill = computed(() => editionCount.value > 0 && !props.selectionMode && !isMissing.value)

const seriesPositionTooltip = computed(() => {
  const label = seriesPositionLabel.value
  return props.book.seriesName ? `${props.book.seriesName} ${label}` : label
})

const ratingColor = computed(() => {
  const r = Math.round(props.book.rating ?? 0)
  if (r <= 1) return '#dc2626'
  if (r === 2) return '#ea580c'
  if (r === 3) return '#ca8a04'
  if (r === 4) return '#65a30d'
  return '#059669'
})

const coverLoaded = ref(false)
const coverFailed = ref(false)
const coverImageRatio = ref<number | null>(null)
const isMissing = computed(() => props.book.status === 'missing')
const showMobileOverlay = ref(false)
const root = ref<HTMLElement | null>(null)
const coverSlotRatio = computed(() => coverAspectRatioValue(String(effectiveCoverAspectRatio.value)))
const coverOverlayFrameStyle = computed(() => {
  if (bookCoverDisplayMode.value !== 'natural-bottom' || !props.book.hasCover || !coverLoaded.value || coverFailed.value) return { inset: '0' }
  return fittedCoverFrameStyle(coverImageRatio.value, coverSlotRatio.value, 'bottom')
})

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
  coverImageRatio.value = null
})

function handleArtworkLoad(ratio: number | null) {
  coverLoaded.value = true
  coverFailed.value = false
  coverImageRatio.value = ratio
}

function handleArtworkError() {
  coverLoaded.value = false
  coverFailed.value = true
  coverImageRatio.value = null
}

const detailsLocation = computed<RouteLocationRaw>(() => ({ name: 'book-detail', params: { bookId: props.book.id } }))
const seriesLocation = computed<RouteLocationRaw | null>(() =>
  props.book.seriesId == null ? null : { name: 'series-detail', params: { seriesId: props.book.seriesId }, query: { from: route.fullPath } },
)

function readerLocation(file: BookFileRef, mode?: 'peek'): RouteLocationRaw {
  return {
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  }
}

function openFile(file: BookFileRef, mode?: 'peek') {
  router.push(readerLocation(file, mode))
}

function peekPrimaryFile() {
  if (!primaryFile.value || isMissing.value) return
  openFile(primaryFile.value, 'peek')
}

function openBookDetails() {
  void router.push(detailsLocation.value)
}

function openBookDetailsInNewTab() {
  openInNewTab(detailsLocation.value)
}

function openSeriesDetails() {
  if (seriesLocation.value == null) return
  void router.push(seriesLocation.value)
}

async function openAuthorDetails() {
  const authorName = authorQuery.value?.trim()
  if (!authorName) return

  try {
    const page = await fetchAuthors({ q: authorName, page: 0, size: 5, sort: 'name', order: 'asc' })
    const author = page.items.find((item) => item.name.trim().toLocaleLowerCase() === authorName.toLocaleLowerCase())
    if (author) {
      void router.push({ name: 'author-detail', params: { id: author.id }, query: { from: route.fullPath } })
      return
    }
  } catch {
    // Fall back to the filtered author list below.
  }

  void router.push({ name: 'authors', query: { q: authorName } })
}

function openLabelTarget(field: GridCardLabelField) {
  if (field === 'book-title') {
    openBookDetails()
    return
  }
  if (field === 'author') {
    void openAuthorDetails()
    return
  }
  if (field === 'series-title' || field === 'series-title-position') {
    openSeriesDetails()
  }
}

function handleLabelClick(field: GridCardLabelField, event: MouseEvent) {
  if (props.selectionMode) {
    emit('select', event)
    return
  }
  openLabelTarget(field)
}

function handlePrimaryLabelClick(event: MouseEvent) {
  handleLabelClick(gridCardPrimaryLabel.value, event)
}

function handleSecondaryLabelClick(event: MouseEvent) {
  handleLabelClick(gridCardSecondaryLabel.value, event)
}

function revealTouchOverlay() {
  if (props.selectionMode) return
  showMobileOverlay.value = true
}

/** Touch has no hover, so holding a card reveals the panel that hovering shows. */
const {
  onPointerDown: handleCoverPointerDown,
  onPointerMove: handleCoverPointerMove,
  onPointerUp: handleCoverPointerUp,
  onPointerCancel: handleCoverPointerCancel,
  consumeClick: consumeLongPressClick,
} = useLongPress(revealTouchOverlay)

/** A click on the card opens the book's details; reading has its own button in the hover dock. */
function handleCardClick(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('button, [data-card-click-blocker]')) return
  if (props.selectionMode) {
    emit('select', event)
    return
  }
  if (consumeLongPressClick()) return
  if (showMobileOverlay.value) {
    showMobileOverlay.value = false
    return
  }
  if (openInNewTabIfRequested(event, detailsLocation.value)) return
  openBookDetails()
}

function handleCardAuxClick(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('button, [data-card-click-blocker]')) return
  if (props.selectionMode) return
  openInNewTabIfRequested(event, detailsLocation.value)
}

/** The browser's own menu is what offers "Open link in new tab", so it stays on links and is suppressed elsewhere on the card. */
function handleContextMenu(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('a[href]')) return
  event.preventDefault()
}

function handleClickOutside(event: MouseEvent) {
  if (!showMobileOverlay.value) return
  if (!root.value?.contains(event.target as Node)) {
    showMobileOverlay.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
})

function openQuickView() {
  emit('action', 'quick-view')
}

function openAuthorBrowse() {
  if (!authorQuery.value) return
  void router.push({ name: 'authors', query: { q: authorQuery.value } })
}

const showHoverTitle = computed(
  () => (cardInfoMode.value === 'hover-overlay' || !props.showLabel) && (coverLoaded.value || !props.book.hasCover || coverFailed.value),
)
/** The hover panel restates what the badges say, so every badge gives way to it. */
const restFadeClass = computed(() => (showMobileOverlay.value ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0'))
/** Badges that take the pointer (for their tooltips) must also stop taking it once they fade. */
const interactiveRestFadeClass = computed(() =>
  showMobileOverlay.value
    ? 'opacity-0 pointer-events-none'
    : 'group-hover:opacity-0 group-hover:pointer-events-none group-focus-within:opacity-0 group-focus-within:pointer-events-none',
)
const overlayVisibilityClass = computed(() =>
  showMobileOverlay.value
    ? 'opacity-100'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100',
)
const panelRevealClass = computed(() =>
  showMobileOverlay.value ? '' : 'translate-y-1.5 group-hover:translate-y-0 group-focus-within:translate-y-0 motion-reduce:translate-y-0',
)
const showBelowCoverLabelArea = computed(() => props.showLabel && cardInfoMode.value === 'below-cover')

const { downloadFile, exportBooks } = useBookDownload()

function isAudioFile(file: BookFileRef) {
  return !!file.format && isAudioFormat(file.format)
}

function fileFormatName(file: BookFileRef): string {
  const key = fileFormatKey(file)
  return key ? formatKeyName(key) : t('book.unknownFormat')
}

function handleDownloadFile(file: BookFileRef) {
  if (isMultiTrackAudio.value && isAudioFile(file)) {
    void exportBooks([props.book.id], false, 'audio')
    return
  }
  void downloadFile(file.id)
}

function handleExportAll() {
  void exportBooks([props.book.id], true)
}

const { setStatus } = useBookStatus()

const localReadStatus = ref<ReadStatus | null>(props.book.readStatus?.status ?? null)
watch(
  () => props.book.readStatus?.status,
  (val) => {
    localReadStatus.value = val ?? null
  },
)
const showReadBadge = computed(
  () => cardOverlays.value.includes('read-status') && localReadStatus.value != null && localReadStatus.value !== 'unread' && !props.selectionMode,
)

async function handleSetStatus(status: ReadStatus) {
  const prev = localReadStatus.value
  localReadStatus.value = status
  try {
    await setStatus(props.book.id, status)
  } catch {
    localReadStatus.value = prev
  }
}

const canOpenPrimaryFile = computed(() => primaryFile.value != null && !isMissing.value)
const isUnderway = computed(() => {
  const progress = props.book.readingProgress
  return progress != null && progress > 0 && progress < 100 && localReadStatus.value !== 'read'
})

const dockAction = computed<CardDockAction>(() => {
  if (!canOpenPrimaryFile.value) {
    return { icon: BookText, label: t('book.actions.details'), ariaLabel: t('book.actions.bookDetails'), progress: null, progressLabel: null }
  }
  const icon = isAudiobook.value ? Play : BookOpen
  if (localReadStatus.value === 'read') {
    return isAudiobook.value
      ? { icon, label: t('book.actions.listen'), ariaLabel: t('book.card.dock.listenAgain'), progress: null, progressLabel: null }
      : { icon, label: t('book.actions.read'), ariaLabel: t('book.card.dock.readAgain'), progress: null, progressLabel: null }
  }
  const progress = isUnderway.value ? props.book.readingProgress! : null
  const progressLabel = progress === null ? null : formatPercent(progress / 100)
  if (isAudiobook.value) {
    return progress === null
      ? { icon, label: t('book.actions.listen'), ariaLabel: t('book.actions.startListening'), progress, progressLabel }
      : { icon, label: t('book.card.dock.resume'), ariaLabel: t('book.actions.continueListening'), progress, progressLabel }
  }
  return progress === null
    ? { icon, label: t('book.actions.read'), ariaLabel: t('book.actions.startReading'), progress, progressLabel }
    : { icon, label: t('book.card.dock.continue'), ariaLabel: t('book.actions.continueReading'), progress, progressLabel }
})

function handleDockPrimary(event: MouseEvent) {
  const file = canOpenPrimaryFile.value ? primaryFile.value : null
  if (openInNewTabIfRequested(event, file ? readerLocation(file) : detailsLocation.value)) return
  if (file) openFile(file)
  else openBookDetails()
}

function resolveBookLabel(field: GridCardLabelField): string | null {
  if (field === 'hidden') return null
  if (field === 'book-title') return props.book.title?.trim() || null
  if (field === 'series-title') return props.book.seriesName?.trim() || null
  if (field === 'series-title-position') {
    const name = props.book.seriesName?.trim()
    if (!name) return null
    return seriesNameWithPosition(t, name, props.book.seriesIndex, props.book.seriesUnit, props.book.seriesVolumeIndex)
  }
  if (field === 'author') return props.book.authors.length > 0 ? props.book.authors.join(', ') : null
  return null
}

const primaryLabelText = computed(() => resolveBookLabel(gridCardPrimaryLabel.value))
const secondaryLabelText = computed(() => resolveBookLabel(gridCardSecondaryLabel.value))

function resolveLabelLocation(field: GridCardLabelField): RouteLocationRaw | null {
  if (field === 'book-title') return detailsLocation.value
  if (field === 'series-title' || field === 'series-title-position') return seriesLocation.value
  return null
}

const primaryLabelLocation = computed(() => (props.selectionMode ? null : resolveLabelLocation(gridCardPrimaryLabel.value)))
const secondaryLabelLocation = computed(() => (props.selectionMode ? null : resolveLabelLocation(gridCardSecondaryLabel.value)))
</script>

<template>
  <div
    ref="root"
    class="flex flex-col @container touch-manipulation cursor-pointer"
    :class="selectionMode ? 'select-none' : ''"
    @click="handleCardClick"
    @auxclick="handleCardAuxClick"
    @contextmenu="handleContextMenu"
  >
    <!-- Cover -->
    <div
      class="group [-webkit-touch-callout:none]"
      @pointerdown="handleCoverPointerDown"
      @pointermove="handleCoverPointerMove"
      @pointerup="handleCoverPointerUp"
      @pointercancel="handleCoverPointerCancel"
    >
      <BookCoverSurface
        class="book-cover-surface--spine-fitted relative w-full rounded-sm overflow-hidden transition-[box-shadow,transform,ring] duration-150 will-change-transform"
        :class="isMissing || selectionMode ? '' : 'group-hover:[transform:var(--cover-hover-transform)] motion-reduce:group-hover:[transform:none]'"
        :interactive="!isMissing && !selectionMode"
        :disable-spine="isAudiobook"
        :is-comic="isComic"
        :style="{ aspectRatio: effectiveCoverAspectRatio }"
      >
        <!-- Missing border overlay: mirror selected overlay pattern so border is never clipped/hidden -->
        <div v-if="isMissing" class="absolute inset-0 z-30 pointer-events-none rounded-sm ring-2 ring-inset ring-amber-500" />

        <BookCoverArtwork
          :src="coverSrc"
          :has-cover="book.hasCover"
          :title="book.title"
          :author-line="authorLine"
          :is-audio="isAudiobook"
          :seed="book.title ?? String(book.id)"
          :alt="book.title ?? ''"
          :frame-aspect-ratio="effectiveCoverAspectRatio"
          :image-class="isMissing ? 'brightness-50' : ''"
          :spine="!isAudiobook"
          :is-comic="isComic"
          :authors="book.authors"
          :subtitle="book.subtitle"
          :series-name="book.seriesName"
          :series-index="book.seriesIndex"
          :genres="book.genres"
          @load="handleArtworkLoad"
          @error="handleArtworkError"
        />

        <div
          data-testid="cover-overlay-frame"
          class="absolute z-10 overflow-hidden rounded-[inherit] [container-type:size]"
          :style="coverOverlayFrameStyle"
        >
          <!-- Top-left overlay: read status -->
          <div
            v-if="showReadBadge && !isMissing"
            class="absolute top-1.5 left-1.5 z-10 flex items-center justify-center rounded-full bg-black/60 p-1 pointer-events-none transition-opacity duration-150"
            :class="restFadeClass"
          >
            <component :is="STATUS_ICONS[localReadStatus!]" :size="12" :class="STATUS_COLORS[localReadStatus!]" />
          </div>

          <!-- Top-right overlay container: lock status (above) + series position (below) -->
          <div class="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1 pointer-events-none">
            <div
              v-if="showLockStatusPill"
              class="flex items-center justify-center rounded-full bg-black/60 p-1 transition-opacity duration-150"
              :class="restFadeClass"
            >
              <component :is="metadataLocked ? Lock : LockOpen" :size="12" :class="metadataLocked ? 'text-amber-400' : 'text-emerald-400'" />
            </div>

            <Tooltip v-if="showSeriesPositionBadge">
              <TooltipTrigger as-child>
                <div
                  data-card-click-blocker
                  class="pointer-events-auto flex items-center bg-black/60 rounded-full px-1.5 py-0.5 transition-opacity duration-150 cursor-default"
                  :class="interactiveRestFadeClass"
                >
                  <span class="text-[9px] font-bold text-white leading-none">{{ seriesPositionLabel }}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ seriesPositionTooltip }}</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip v-if="showEditionsPill">
              <TooltipTrigger as-child>
                <div
                  data-card-click-blocker
                  data-testid="card-editions-pill"
                  class="pointer-events-auto flex items-center gap-[3px] bg-black/60 rounded-full px-1.5 py-0.5 transition-opacity duration-150 cursor-default"
                  :class="interactiveRestFadeClass"
                  role="img"
                  :aria-label="t('book.editions.card.count', { count: editionCount })"
                >
                  <Layers class="size-[9px] text-white" aria-hidden="true" />
                  <span class="text-[9px] font-bold text-white leading-none" aria-hidden="true">{{ formatNumber(editionCount) }}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ t('book.editions.card.count', { count: editionCount }) }}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <!-- Bottom-left overlay: rating -->
          <div
            v-if="showRatingOverlay && !selectionMode"
            class="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5 pointer-events-none transition-opacity duration-150"
            :class="restFadeClass"
          >
            <Star class="size-3" :style="{ fill: ratingColor, color: ratingColor }" />
            <span class="text-[9px] font-bold text-white leading-none">{{ Math.round(book.rating!) }}</span>
          </div>

          <!-- Bottom-right overlay: the format badge, in the style the user chose; it places itself -->
          <div
            v-if="showFormatOverlay && !selectionMode"
            class="absolute inset-0 z-10 pointer-events-none transition-opacity duration-150"
            :class="restFadeClass"
          >
            <BookCardFormatBadges :own-keys="ownFormatKeys" :linked="book.linked" :badge-style="formatBadgeStyle" />
          </div>

          <!-- Reading progress bar - bottom edge -->
          <div
            v-if="showProgressBar && !selectionMode"
            data-testid="reading-progress-bar"
            class="absolute bottom-0 left-0 z-10 h-0.75 transition-[width,opacity] duration-500 [box-shadow:0_-1px_0_rgba(255,255,255,0.25)]"
            style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
            :class="[localReadStatus === 'read' ? 'bg-green-500/80' : 'bg-primary/70', restFadeClass]"
            :style="{ width: `${book.readingProgress}%` }"
          />

          <div
            v-if="selectionMode"
            class="absolute inset-0 z-30 pointer-events-none rounded-sm"
            :class="selected ? 'bg-primary/20 ring-2 ring-inset ring-primary' : ''"
          >
            <div
              class="absolute top-1.5 left-1.5 h-5 w-5 rounded-xs flex items-center justify-center transition-colors"
              :class="selected ? 'bg-primary' : 'bg-black/40 border border-white/50'"
            >
              <Check v-if="selected" class="text-primary-foreground" :size="12" />
            </div>
          </div>

          <!-- Missing badge -->
          <div v-if="isMissing" class="absolute top-1.5 right-1.5 z-20">
            <span
              class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-xs bg-amber-600/95 text-white"
            >
              <TriangleAlert class="size-2.5 shrink-0" />
              {{ t('book.card.missing') }}
            </span>
          </div>

          <!-- Refresh spinner overlay -->
          <Transition name="fade">
            <div v-if="anyRefreshing" class="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
              <Loader2 class="size-[32cqi] animate-spin text-white drop-shadow-lg" />
            </div>
          </Transition>

          <!-- Hover overlay: one panel at the foot of the cover -->
          <div
            v-if="!selectionMode"
            data-testid="grid-card-hover-overlay"
            class="absolute inset-0 z-20 flex flex-col justify-end p-[clamp(6px,5cqi,12px)] transition-opacity duration-150"
            :class="overlayVisibilityClass"
          >
            <BookCardHoverPanel
              class="transition-transform duration-240 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
              :class="panelRevealClass"
              :action="dockAction"
              :own-keys="ownFormatKeys"
              :linked="book.linked"
              :show-formats="showFormatOverlay"
              :title="showHoverTitle ? (book.title ?? '-') : null"
              :author="authorLine"
              :show-menu="!showBelowCoverLabelArea"
              :menu-label="menuLabel"
              @primary="handleDockPrimary"
              @quick-view="openQuickView"
              @author="openAuthorBrowse"
            >
              <template #menu>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-if="openableFiles.length <= 1 && primaryFile && !isMissing" @click="openFile(primaryFile)">
                    <BookOpen class="size-4 mr-2" />
                    {{ t('book.actions.read') }}
                  </DropdownMenuItem>
                  <DropdownMenuSub v-else-if="openableFiles.length > 1 && !isMissing">
                    <DropdownMenuSubTrigger>
                      <BookOpen class="size-4 mr-2" />
                      {{ t('book.actions.read') }}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="openFile(file)">
                        <span v-if="isMultiTrackAudio && isAudioFile(file)">{{ t('book.file.audiobook') }}</span>
                        <span v-else>{{ fileFormatName(file) }}</span>
                        <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary">{{
                          t('book.file.primary')
                        }}</span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem v-if="primaryFile && !isMissing" @click="peekPrimaryFile">
                    <Eye class="size-4 mr-2" />
                    {{ t('book.actions.peek') }}
                  </DropdownMenuItem>

                  <!-- Download submenu -->
                  <DropdownMenuItem
                    v-if="hasPermission('library_download') && downloadableFiles.length === 1 && primaryDownloadFile"
                    @click="handleDownloadFile(primaryDownloadFile)"
                  >
                    <Download class="size-4 mr-2" />
                    {{ t('book.actions.download') }}
                  </DropdownMenuItem>
                  <DropdownMenuSub v-else-if="hasPermission('library_download') && downloadableFiles.length > 1">
                    <DropdownMenuSubTrigger>
                      <Download class="size-4 mr-2" />
                      {{ t('book.actions.download') }}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="file in downloadableFiles" :key="file.id" @click="handleDownloadFile(file)">
                        <span v-if="isMultiTrackAudio && isAudioFile(file)">{{ t('book.download.audiobookZip') }}</span>
                        <span v-else>{{ fileFormatName(file) }}</span>
                        <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary">{{
                          t('book.file.primary')
                        }}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="handleExportAll"> {{ t('book.download.allFormatsZip') }} </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem @click="openBookDetails">
                    <BookText class="size-4 mr-2" />
                    {{ t('book.actions.bookDetails') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="openBookDetailsInNewTab">
                    <ExternalLink class="size-4 mr-2" />
                    {{ t('common.openInNewTab') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator v-if="canEditMetadata" />
                  <DropdownMenuSub v-if="canEditMetadata">
                    <DropdownMenuSubTrigger>
                      <Pencil class="size-4 mr-2" />
                      {{ t('book.actions.metadata') }}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })">
                        <Pencil class="size-4 mr-2" />
                        {{ t('book.actions.editMetadata') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem :disabled="anyRefreshing" @click="handleRefreshMetadata">
                        <Loader2 v-if="anyRefreshing" class="size-4 mr-2 animate-spin" />
                        <RefreshCw v-else class="size-4 mr-2" />
                        {{ t('book.actions.refreshMetadata') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem :disabled="reExtractingCover" @click="reExtractCover">
                        <Loader2 v-if="reExtractingCover" class="size-4 mr-2 animate-spin" />
                        <Image v-else class="size-4 mr-2" />
                        {{ t('book.actions.regenerateCover') }}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem @click="emit('action', 'add-to-collection')">
                    <FolderPlus class="size-4 mr-2" />
                    {{ t('book.actions.addToCollection') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem v-if="allowMoveToLibrary && canEditMetadata" @click="emit('action', 'move-to-library')">
                    <FolderInput class="size-4 mr-2" />
                    {{ t('book.move.action') }}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <component
                        :is="STATUS_ICONS[localReadStatus ?? 'unread']"
                        class="size-4 mr-2"
                        :class="STATUS_COLORS[localReadStatus ?? 'unread']"
                      />
                      {{ t('book.actions.setStatus') }}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="status in READ_STATUSES" :key="status" @click="handleSetStatus(status)">
                        <component :is="STATUS_ICONS[status]" class="size-4 mr-2" :class="STATUS_COLORS[status]" />
                        {{ readStatusLabel(status) }}
                        <Check v-if="localReadStatus === status" class="size-3 ml-auto text-primary" />
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
                    <Send class="size-4 mr-2" />
                    {{ t('book.actions.sendViaEmail') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator v-if="hasPermission('email_send') || hasPermission('library_delete_books')" />
                  <DropdownMenuItem
                    v-if="hasPermission('library_delete_books')"
                    class="text-destructive focus:text-destructive"
                    @click="emit('action', 'delete')"
                  >
                    <Trash2 class="size-4 mr-2" />
                    {{ t('common.delete') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </template>
            </BookCardHoverPanel>
          </div>
        </div>
      </BookCoverSurface>
    </div>

    <!-- Below-cover label row (below-cover mode only) -->
    <div v-if="showBelowCoverLabelArea" class="grid-card-label" data-testid="grid-card-label">
      <div class="grid-card-label__primary-row">
        <BookCardLabel
          v-if="primaryLabelText"
          :text="primaryLabelText"
          :to="primaryLabelLocation"
          class="min-w-0 flex-1 text-xs/5 font-medium text-foreground"
          data-testid="grid-card-label-primary"
          @activate="handlePrimaryLabelClick"
        />
        <div v-else class="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="shrink-0 p-0.5 rounded-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="grid-card-kebab"
              :aria-label="menuLabel"
            >
              <MoreVertical class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-if="openableFiles.length <= 1 && primaryFile && !isMissing" @click="openFile(primaryFile)">
              <BookOpen class="size-4 mr-2" />
              {{ t('book.actions.read') }}
            </DropdownMenuItem>
            <DropdownMenuSub v-else-if="openableFiles.length > 1 && !isMissing">
              <DropdownMenuSubTrigger>
                <BookOpen class="size-4 mr-2" />
                {{ t('book.actions.read') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="openFile(file)">
                  <span v-if="isMultiTrackAudio && isAudioFile(file)">{{ t('book.file.audiobook') }}</span>
                  <span v-else>{{ fileFormatName(file) }}</span>
                  <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary">{{
                    t('book.file.primary')
                  }}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem v-if="primaryFile && !isMissing" @click="peekPrimaryFile">
              <Eye class="size-4 mr-2" />
              {{ t('book.actions.peek') }}
            </DropdownMenuItem>

            <DropdownMenuItem
              v-if="hasPermission('library_download') && downloadableFiles.length === 1 && primaryDownloadFile"
              @click="handleDownloadFile(primaryDownloadFile)"
            >
              <Download class="size-4 mr-2" />
              {{ t('book.actions.download') }}
            </DropdownMenuItem>
            <DropdownMenuSub v-else-if="hasPermission('library_download') && downloadableFiles.length > 1">
              <DropdownMenuSubTrigger>
                <Download class="size-4 mr-2" />
                {{ t('book.actions.download') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="file in downloadableFiles" :key="file.id" @click="handleDownloadFile(file)">
                  <span v-if="isMultiTrackAudio && isAudioFile(file)">{{ t('book.download.audiobookZip') }}</span>
                  <span v-else>{{ fileFormatName(file) }}</span>
                  <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary">{{
                    t('book.file.primary')
                  }}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="handleExportAll"> {{ t('book.download.allFormatsZip') }} </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem @click="openBookDetails">
              <BookText class="size-4 mr-2" />
              {{ t('book.actions.bookDetails') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="openBookDetailsInNewTab">
              <ExternalLink class="size-4 mr-2" />
              {{ t('common.openInNewTab') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="canEditMetadata" />
            <DropdownMenuSub v-if="canEditMetadata">
              <DropdownMenuSubTrigger>
                <Pencil class="size-4 mr-2" />
                {{ t('book.actions.metadata') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })">
                  <Pencil class="size-4 mr-2" />
                  {{ t('book.actions.editMetadata') }}
                </DropdownMenuItem>
                <DropdownMenuItem :disabled="anyRefreshing" @click="handleRefreshMetadata">
                  <Loader2 v-if="anyRefreshing" class="size-4 mr-2 animate-spin" />
                  <RefreshCw v-else class="size-4 mr-2" />
                  {{ t('book.actions.refreshMetadata') }}
                </DropdownMenuItem>
                <DropdownMenuItem :disabled="reExtractingCover" @click="reExtractCover">
                  <Loader2 v-if="reExtractingCover" class="size-4 mr-2 animate-spin" />
                  <Image v-else class="size-4 mr-2" />
                  {{ t('book.actions.regenerateCover') }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem @click="emit('action', 'add-to-collection')">
              <FolderPlus class="size-4 mr-2" />
              {{ t('book.actions.addToCollection') }}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-4 mr-2" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                {{ t('book.actions.setStatus') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="status in READ_STATUSES" :key="status" @click="handleSetStatus(status)">
                  <component :is="STATUS_ICONS[status]" class="size-4 mr-2" :class="STATUS_COLORS[status]" />
                  {{ readStatusLabel(status) }}
                  <Check v-if="localReadStatus === status" class="size-3 ml-auto text-primary" />
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
              <Send class="size-4 mr-2" />
              {{ t('book.actions.sendViaEmail') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="hasPermission('email_send') || hasPermission('library_delete_books')" />
            <DropdownMenuItem
              v-if="hasPermission('library_delete_books')"
              class="text-destructive focus:text-destructive"
              @click="emit('action', 'delete')"
            >
              <Trash2 class="size-4 mr-2" />
              {{ t('common.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <BookCardLabel
        v-if="secondaryLabelText"
        :text="secondaryLabelText"
        :to="secondaryLabelLocation"
        class="mt-0.5 w-full text-[0.675rem]/3.5 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
        data-testid="grid-card-label-secondary"
        @activate="handleSecondaryLabelClick"
      />
    </div>
  </div>

  <SendBookDialog
    v-if="showSendDialog"
    :open="showSendDialog"
    :selection-payload="{ bookIds: [book.id] }"
    :selected-count="1"
    :book-files="book.files"
    :book-title="book.title ?? undefined"
    :book-authors="authorLine ?? undefined"
    @update:open="showSendDialog = $event"
  />
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.grid-card-label {
  padding-top: 4px;
  min-width: 0;
}

.grid-card-label__primary-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
</style>
