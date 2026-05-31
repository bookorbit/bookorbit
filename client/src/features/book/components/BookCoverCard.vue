<script setup lang="ts">
import type { BookCard, BookFileRef } from '@bookorbit/types'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import { getFormatColor } from '../lib/format-colors'
import { computed, inject, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BookOpen,
  Check,
  Download,
  ExternalLink,
  FolderPlus,
  Image,
  Lock,
  LockOpen,
  Loader2,
  MoreVertical,
  PanelRight,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import { useBookStatus, STATUS_OPTIONS, STATUS_ICONS, STATUS_COLORS } from '../composables/useBookStatus'
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
import { useDisplaySettings, type GridCardLabelField } from '@/composables/useDisplaySettings'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO, coverAspectRatioValue, fittedCoverFrameStyle } from '../lib/cover-aspect-ratio'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { fetchAuthors } from '@/features/author/api/author'

const route = useRoute()
const router = useRouter()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
  showLabel?: boolean
}>()

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: [event: MouseEvent]
  'update:book': [updated: BookCard]
}>()

const authorLine = computed(() => props.book.authors.join(', ') || null)
const authorQuery = computed(() => props.book.authors[0] ?? null)

const readableFiles = computed(() => props.book.files.filter((f) => f.format && READER_OPENABLE_FORMATS.has(f.format)))
const primaryFile = computed(() => readableFiles.value.find((f) => f.role === 'primary') ?? readableFiles.value[0] ?? null)
const isAudiobook = computed(() => readableFiles.value.some((f) => FORMAT_TO_GROUP[f.format!] === 'audio'))

// For multi-file audiobooks, collapse all tracks into one representative entry.
// The audio reader loads the full track queue from the book, so opening any track is equivalent.
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

const { coverUrl, bumpVersion } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id))

const { refreshing, refreshWithFeedback } = useRefreshMetadata()
const { isRefreshing } = useRefreshingBooks()
const anyRefreshing = computed(() => refreshing.value || isRefreshing(props.book.id))
const reExtractingCover = ref(false)

async function reExtractCover() {
  if (reExtractingCover.value) return
  reExtractingCover.value = true
  try {
    await fetch(`/api/v1/books/${props.book.id}/re-extract-cover`, { method: 'POST' })
    bumpVersion(props.book.id)
  } finally {
    reExtractingCover.value = false
  }
}

async function handleRefreshMetadata() {
  const updated = await refreshWithFeedback(props.book.id)
  if (updated) emit('update:book', mergeBookCardWithDetail(props.book, updated))
}
const { hasPermission } = usePermissions()
const { cardOverlays, bookCoverDisplayMode, gridCardPrimaryLabel, gridCardSecondaryLabel, cardInfoMode } = useDisplaySettings()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const showSendDialog = ref(false)

const hasProgress = computed(() => props.book.readingProgress != null && props.book.readingProgress > 0)
const showProgressBar = computed(() => cardOverlays.value.includes('progress-bar') && hasProgress.value)
const showFormatOverlay = computed(() => cardOverlays.value.includes('format') && primaryFile.value?.format != null)
const showRatingOverlay = computed(() => cardOverlays.value.includes('rating') && props.book.rating != null)
const showLockStatusPill = computed(() => cardOverlays.value.includes('lock-status') && !props.selectionMode && !isMissing.value)
const metadataLocked = computed(() => props.book.hasMetadataLocks)

const showSeriesPositionBadge = computed(
  () => cardOverlays.value.includes('series-position') && props.book.seriesIndex != null && !props.selectionMode && !isMissing.value,
)
const seriesPositionLabel = computed(() => {
  const index = props.book.seriesIndex
  if (index == null) return ''
  const display = index % 1 === 0 ? String(Math.trunc(index)) : String(index)
  return `#${display}`
})
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
const coverSlotRatio = computed(() => coverAspectRatioValue(String(coverAspectRatio.value)))
const coverOverlayFrameStyle = computed(() => {
  if (bookCoverDisplayMode.value !== 'natural-bottom' || !props.book.hasCover || !coverLoaded.value || coverFailed.value) return { inset: '0' }
  return fittedCoverFrameStyle(coverImageRatio.value, coverSlotRatio.value, 'bottom')
})

const isTouch = computed(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)

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

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function openBookDetails() {
  void router.push({ name: 'book-detail', params: { bookId: props.book.id } })
}

function openSeriesDetails() {
  const seriesName = props.book.seriesName?.trim()
  if (!seriesName) return
  void router.push({ name: 'series-detail', params: { seriesName }, query: { from: route.fullPath } })
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

function handleCardClick(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest('button, [data-card-click-blocker]')) return
  if (props.selectionMode) {
    emit('select', event)
    return
  }

  if (isTouch.value) {
    showMobileOverlay.value = !showMobileOverlay.value
    return
  }

  if (primaryFile.value && !isMissing.value) openFile(primaryFile.value)
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
const showAuthorOnHover = computed(() => showHoverTitle.value && !!authorLine.value)
const hoverTitleClampClass = computed(() => (coverAspectRatio.value === '1/1' ? 'line-clamp-1' : 'line-clamp-2'))

const overlayBackground = computed(() => (cardInfoMode.value === 'hover-overlay' || !props.showLabel ? 'bg-black/70' : 'bg-black/20'))
const overlayFadeClass = computed(() => (cardInfoMode.value === 'hover-overlay' || !props.showLabel ? 'group-hover:opacity-0' : ''))
const showBelowCoverLabelArea = computed(() => props.showLabel && cardInfoMode.value === 'below-cover')

const { downloadFile, exportBooks } = useBookDownload()

function handleDownloadFile(file: BookFileRef) {
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

function resolveBookLabel(field: GridCardLabelField): string | null {
  if (field === 'hidden') return null
  if (field === 'book-title') return props.book.title?.trim() || null
  if (field === 'series-title') return props.book.seriesName?.trim() || null
  if (field === 'series-title-position') {
    const name = props.book.seriesName?.trim()
    if (!name) return null
    return props.book.seriesIndex != null ? `${name} #${props.book.seriesIndex}` : name
  }
  if (field === 'author') return props.book.authors.length > 0 ? props.book.authors.join(', ') : null
  return null
}

const primaryLabelText = computed(() => resolveBookLabel(gridCardPrimaryLabel.value))
const secondaryLabelText = computed(() => resolveBookLabel(gridCardSecondaryLabel.value))
</script>

<template>
  <div
    ref="root"
    class="flex flex-col @container touch-manipulation"
    :class="[selectionMode || (primaryFile && !isMissing) ? 'cursor-pointer' : 'cursor-default', selectionMode ? 'select-none' : '']"
    @click="handleCardClick"
    @contextmenu.prevent
  >
    <!-- Cover -->
    <div class="group">
      <BookCoverSurface
        class="book-cover-surface--spine-fitted relative w-full rounded-sm overflow-hidden transition-[box-shadow,transform,ring] duration-150 will-change-transform"
        :class="isMissing || selectionMode ? '' : 'group-hover:scale-[1.02]'"
        :interactive="!isMissing && !selectionMode"
        :disable-spine="isAudiobook"
        :style="{ aspectRatio: coverAspectRatio }"
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
          :image-class="isMissing ? 'brightness-50' : ''"
          :spine="!isAudiobook"
          @load="handleArtworkLoad"
          @error="handleArtworkError"
        />

        <div data-testid="cover-overlay-frame" class="absolute z-10 overflow-hidden rounded-[inherit]" :style="coverOverlayFrameStyle">
          <!-- Top-left overlay: read status -->
          <div
            v-if="showReadBadge && !isMissing"
            class="absolute top-1.5 left-1.5 z-10 flex items-center justify-center rounded-full bg-black/60 p-1 pointer-events-none transition-opacity duration-150"
            :class="[overlayFadeClass, overlayFadeClass ? '' : showMobileOverlay ? 'opacity-0 pointer-events-none' : '']"
          >
            <component :is="STATUS_ICONS[localReadStatus!]" :size="12" :class="STATUS_COLORS[localReadStatus!]" />
          </div>

          <!-- Top-right overlay container: lock status (above) + series position (below) -->
          <div class="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1 pointer-events-none">
            <div
              v-if="showLockStatusPill"
              class="flex items-center justify-center rounded-full bg-black/60 p-1 transition-opacity duration-150"
              :class="showMobileOverlay ? 'opacity-0 pointer-events-none' : 'group-hover:opacity-0'"
            >
              <component :is="metadataLocked ? Lock : LockOpen" :size="12" :class="metadataLocked ? 'text-amber-400' : 'text-emerald-400'" />
            </div>

            <Tooltip v-if="showSeriesPositionBadge">
              <TooltipTrigger as-child>
                <div
                  data-card-click-blocker
                  class="pointer-events-auto flex items-center bg-black/60 rounded-full px-1.5 py-0.5 transition-opacity duration-150 cursor-default"
                  :class="showMobileOverlay ? 'opacity-0 pointer-events-none' : 'group-hover:opacity-0 group-hover:pointer-events-none'"
                >
                  <span class="text-[9px] font-bold text-white leading-none">{{ seriesPositionLabel }}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ seriesPositionTooltip }}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <!-- Bottom-left overlay: rating -->
          <div
            v-if="showRatingOverlay && !selectionMode"
            class="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5 pointer-events-none transition-opacity duration-150"
            :class="overlayFadeClass"
          >
            <Star class="size-3" :style="{ fill: ratingColor, color: ratingColor }" />
            <span class="text-[9px] font-bold text-white leading-none">{{ Math.round(book.rating!) }}</span>
          </div>

          <!-- Bottom-right overlay: format badge -->
          <div
            v-if="showFormatOverlay && !selectionMode"
            class="absolute bottom-1.5 right-1.5 z-10 pointer-events-none transition-opacity duration-150"
            :class="overlayFadeClass"
          >
            <span
              class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded text-white"
              :style="{ backgroundColor: getFormatColor(primaryFile!.format!) + 'cc' }"
            >
              {{ primaryFile!.format!.toUpperCase() }}
            </span>
          </div>

          <!-- Reading progress bar - bottom edge -->
          <div
            v-if="showProgressBar && !selectionMode"
            class="absolute bottom-0 left-0 z-10 h-0.75 transition-[width,opacity] duration-500 [box-shadow:0_-1px_0_rgba(255,255,255,0.25)]"
            style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
            :class="[book.readingProgress === 100 ? 'bg-green-500/80' : 'bg-primary/70', overlayFadeClass]"
            :style="{ width: `${book.readingProgress}%` }"
          />

          <div
            v-if="selectionMode"
            class="absolute inset-0 z-30 pointer-events-none rounded-sm"
            :class="selected ? 'bg-primary/20 ring-2 ring-inset ring-primary' : ''"
          >
            <div
              class="absolute top-1.5 left-1.5 h-5 w-5 rounded flex items-center justify-center transition-colors"
              :class="selected ? 'bg-primary' : 'bg-black/40 border border-white/50'"
            >
              <Check v-if="selected" class="text-primary-foreground" :size="12" />
            </div>
          </div>

          <!-- Missing badge -->
          <div v-if="isMissing" class="absolute top-1.5 right-1.5 z-20">
            <span class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-600/95 text-white">
              <TriangleAlert class="size-2.5 shrink-0" />
              Missing
            </span>
          </div>

          <!-- Refresh spinner overlay -->
          <Transition name="fade">
            <div v-if="anyRefreshing" class="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
              <Loader2 class="size-[32cqi] animate-spin text-white drop-shadow-lg" />
            </div>
          </Transition>

          <!-- Hover overlay -->
          <div
            v-if="!selectionMode"
            class="absolute inset-0 flex flex-col p-2 transition-opacity duration-150"
            :class="[
              overlayBackground,
              showMobileOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
            ]"
          >
            <!-- Top row: Quick View -->
            <div class="shrink-0 flex justify-end">
              <button class="p-[3cqi] rounded-[2.5cqi] bg-black/50 hover:bg-black/30 transition-colors text-white" @click="openQuickView">
                <PanelRight class="size-[12cqi]" />
              </button>
            </div>

            <!-- Center: Play/Read button -->
            <div class="flex-1 flex items-center justify-center">
              <button
                v-if="primaryFile && !isMissing"
                class="size-[30cqi] flex items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-all duration-300 scale-75 hover:scale-110 active:scale-90"
                :class="[showMobileOverlay || 'group-hover:scale-100', showMobileOverlay ? 'scale-100' : '']"
                @click.stop="openFile(primaryFile)"
              >
                <component :is="isAudiobook ? Play : BookOpen" class="size-[16cqi]" :class="{ 'ml-[2cqi]': isAudiobook }" />
              </button>
            </div>

            <!-- Bottom: title/author (hover-overlay mode only) + kebab (when not in below-cover label row) -->
            <div class="shrink-0 flex flex-col pr-10">
              <div class="flex items-start justify-between gap-2">
                <p v-if="showHoverTitle" class="text-xs font-semibold text-white leading-tight min-w-0 flex-1" :class="hoverTitleClampClass">
                  {{ book.title ?? '-' }}
                </p>
                <div v-else class="flex-1" />
              </div>

              <div v-if="showAuthorOnHover" class="min-w-0">
                <button class="text-[10px] text-white/70 truncate hover:underline text-left block w-full" @click.stop="openAuthorBrowse">
                  {{ authorLine }}
                </button>
              </div>
            </div>

            <!-- Kebab menu anchored to lower-right (not in below-cover mode, where it lives in the label row) -->
            <div v-if="!showBelowCoverLabelArea" class="absolute bottom-2 right-2 z-20">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button class="px-0.75 py-1.5 rounded-md bg-black/40 hover:bg-white/30 transition-colors text-white shrink-0">
                    <MoreVertical class="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem v-if="openableFiles.length <= 1 && primaryFile && !isMissing" @click="openFile(primaryFile)">
                    <BookOpen class="size-4 mr-2" />
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuSub v-else-if="openableFiles.length > 1 && !isMissing">
                    <DropdownMenuSubTrigger>
                      <BookOpen class="size-4 mr-2" />
                      Open
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="openFile(file)">
                        <span v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</span>
                        <span v-else>{{ file.format?.toUpperCase() ?? '?' }}</span>
                        <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary/70">Primary</span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <!-- Download submenu -->
                  <DropdownMenuItem
                    v-if="hasPermission('library_download') && openableFiles.length === 1 && primaryFile"
                    @click="handleDownloadFile(primaryFile)"
                  >
                    <Download class="size-4 mr-2" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuSub v-else-if="hasPermission('library_download') && openableFiles.length > 1">
                    <DropdownMenuSubTrigger>
                      <Download class="size-4 mr-2" />
                      Download
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="handleDownloadFile(file)">
                        <span v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</span>
                        <span v-else>{{ file.format?.toUpperCase() ?? '?' }}</span>
                        <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary/70">Primary</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="handleExportAll"> All formats (ZIP) </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem @click="openBookDetails">
                    <ExternalLink class="size-4 mr-2" />
                    Book Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator v-if="hasPermission('library_edit_metadata')" />
                  <DropdownMenuSub v-if="hasPermission('library_edit_metadata')">
                    <DropdownMenuSubTrigger>
                      <Pencil class="size-4 mr-2" />
                      Metadata
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })">
                        <Pencil class="size-4 mr-2" />
                        Edit Metadata
                      </DropdownMenuItem>
                      <DropdownMenuItem :disabled="anyRefreshing" @click="handleRefreshMetadata">
                        <Loader2 v-if="anyRefreshing" class="size-4 mr-2 animate-spin" />
                        <RefreshCw v-else class="size-4 mr-2" />
                        Refresh Metadata
                      </DropdownMenuItem>
                      <DropdownMenuItem :disabled="reExtractingCover" @click="reExtractCover()">
                        <Loader2 v-if="reExtractingCover" class="size-4 mr-2 animate-spin" />
                        <Image v-else class="size-4 mr-2" />
                        Regenerate Cover
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem @click="emit('action', 'add-to-collection')">
                    <FolderPlus class="size-4 mr-2" />
                    Add to Collection
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <component
                        :is="STATUS_ICONS[localReadStatus ?? 'unread']"
                        class="size-4 mr-2"
                        :class="STATUS_COLORS[localReadStatus ?? 'unread']"
                      />
                      Set Status
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetStatus(opt.value)">
                        <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                        {{ opt.label }}
                        <Check v-if="localReadStatus === opt.value" class="size-3 ml-auto text-primary" />
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
                    <Send class="size-4 mr-2" />
                    Send via Email
                  </DropdownMenuItem>
                  <DropdownMenuSeparator v-if="hasPermission('email_send') || hasPermission('library_delete_books')" />
                  <DropdownMenuItem
                    v-if="hasPermission('library_delete_books')"
                    class="text-destructive focus:text-destructive"
                    @click="emit('action', 'delete')"
                  >
                    <Trash2 class="size-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </BookCoverSurface>
    </div>

    <!-- Below-cover label row (below-cover mode only) -->
    <div v-if="showBelowCoverLabelArea" class="grid-card-label" data-testid="grid-card-label">
      <div class="grid-card-label__primary-row">
        <button
          v-if="primaryLabelText"
          type="button"
          class="grid-card-label__button grid-card-label__primary min-w-0 flex-1 truncate"
          data-testid="grid-card-label-primary"
          @click.stop="handlePrimaryLabelClick"
        >
          {{ primaryLabelText }}
        </button>
        <div v-else class="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button class="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors" data-testid="grid-card-kebab">
              <MoreVertical class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-if="openableFiles.length <= 1 && primaryFile && !isMissing" @click="openFile(primaryFile)">
              <BookOpen class="size-4 mr-2" />
              Open
            </DropdownMenuItem>
            <DropdownMenuSub v-else-if="openableFiles.length > 1 && !isMissing">
              <DropdownMenuSubTrigger>
                <BookOpen class="size-4 mr-2" />
                Open
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="openFile(file)">
                  <span v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</span>
                  <span v-else>{{ file.format?.toUpperCase() ?? '?' }}</span>
                  <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary/70">Primary</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              v-if="hasPermission('library_download') && openableFiles.length === 1 && primaryFile"
              @click="handleDownloadFile(primaryFile)"
            >
              <Download class="size-4 mr-2" />
              Download
            </DropdownMenuItem>
            <DropdownMenuSub v-else-if="hasPermission('library_download') && openableFiles.length > 1">
              <DropdownMenuSubTrigger>
                <Download class="size-4 mr-2" />
                Download
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="file in openableFiles" :key="file.id" @click="handleDownloadFile(file)">
                  <span v-if="isMultiTrackAudio && FORMAT_TO_GROUP[file.format!] === 'audio'">Audiobook</span>
                  <span v-else>{{ file.format?.toUpperCase() ?? '?' }}</span>
                  <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="ml-auto pl-4 text-[10px] text-primary/70">Primary</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="handleExportAll"> All formats (ZIP) </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem @click="openBookDetails">
              <ExternalLink class="size-4 mr-2" />
              Book Details
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="hasPermission('library_edit_metadata')" />
            <DropdownMenuSub v-if="hasPermission('library_edit_metadata')">
              <DropdownMenuSubTrigger>
                <Pencil class="size-4 mr-2" />
                Metadata
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })">
                  <Pencil class="size-4 mr-2" />
                  Edit Metadata
                </DropdownMenuItem>
                <DropdownMenuItem :disabled="anyRefreshing" @click="handleRefreshMetadata">
                  <Loader2 v-if="anyRefreshing" class="size-4 mr-2 animate-spin" />
                  <RefreshCw v-else class="size-4 mr-2" />
                  Refresh Metadata
                </DropdownMenuItem>
                <DropdownMenuItem :disabled="reExtractingCover" @click="reExtractCover()">
                  <Loader2 v-if="reExtractingCover" class="size-4 mr-2 animate-spin" />
                  <Image v-else class="size-4 mr-2" />
                  Regenerate Cover
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem @click="emit('action', 'add-to-collection')">
              <FolderPlus class="size-4 mr-2" />
              Add to Collection
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-4 mr-2" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                Set Status
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetStatus(opt.value)">
                  <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                  {{ opt.label }}
                  <Check v-if="localReadStatus === opt.value" class="size-3 ml-auto text-primary" />
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
              <Send class="size-4 mr-2" />
              Send via Email
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="hasPermission('email_send') || hasPermission('library_delete_books')" />
            <DropdownMenuItem
              v-if="hasPermission('library_delete_books')"
              class="text-destructive focus:text-destructive"
              @click="emit('action', 'delete')"
            >
              <Trash2 class="size-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button
        v-if="secondaryLabelText"
        type="button"
        class="grid-card-label__button grid-card-label__secondary w-full"
        data-testid="grid-card-label-secondary"
        @click.stop="handleSecondaryLabelClick"
      >
        {{ secondaryLabelText }}
      </button>
    </div>
  </div>

  <SendBookDialog
    v-if="showSendDialog"
    :open="showSendDialog"
    :book-ids="[book.id]"
    :book-files="book.files"
    :book-title="book.title ?? undefined"
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

.grid-card-label__button {
  display: block;
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.grid-card-label__button:hover {
  text-decoration-line: underline;
}

.grid-card-label__button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 2px;
}

.grid-card-label__primary {
  font-size: 0.75rem;
  line-height: 1.25rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--foreground);
}

.grid-card-label__secondary {
  font-size: 0.625rem;
  line-height: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted-foreground);
  margin-top: 2px;
}
</style>
