<script setup lang="ts">
import type { BookCard, BookFileRef } from '@bookorbit/types'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import { bookCoverStyle } from '../lib/book-cover'
import { getFormatColor } from '../lib/format-colors'
import { computed, inject, ref, watch, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
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
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { coverAspectRatioValue, COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO, fittedCoverFrameStyle } from '../lib/cover-aspect-ratio'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import BookCoverPlaceholder from './BookCoverPlaceholder.vue'
import BookCoverSurface from './BookCoverSurface.vue'

const router = useRouter()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
}>()

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: [event: MouseEvent]
  'update:book': [updated: BookCard]
}>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
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
const { cardOverlays } = useDisplaySettings()
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

const isTouch = computed(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
  coverImageRatio.value = null
})

const slotAspectRatio = computed(() => coverAspectRatioValue(String(coverAspectRatio.value)))
const fittedCoverSpineStyle = computed(() => fittedCoverFrameStyle(coverImageRatio.value, slotAspectRatio.value))

function updateCoverImageRatio(img: HTMLImageElement | null) {
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) return
  coverImageRatio.value = img.naturalWidth / img.naturalHeight
}

function onMainImgRef(el: Element | ComponentPublicInstance | null) {
  const img = el as HTMLImageElement | null
  if (img?.complete && img.naturalWidth > 0) {
    coverLoaded.value = true
    updateCoverImageRatio(img)
  }
}

function handleMainImageLoad(event: Event) {
  const target = event.target as HTMLImageElement | null
  updateCoverImageRatio(target)
  coverLoaded.value = true
}

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function handleCardClick(event: MouseEvent) {
  if ((event.target as Element).closest('button')) return
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

const showHoverText = computed(() => coverLoaded.value || !props.book.hasCover || coverFailed.value)
const showAuthorOnHover = computed(() => showHoverText.value && !!authorLine.value)
const hoverTitleClampClass = computed(() => (coverAspectRatio.value === '1/1' ? 'line-clamp-1' : 'line-clamp-2'))

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
</script>

<template>
  <div
    ref="root"
    class="group flex flex-col @container touch-manipulation"
    :class="[selectionMode || (primaryFile && !isMissing) ? 'cursor-pointer' : 'cursor-default', selectionMode ? 'select-none' : '']"
    @click="handleCardClick"
    @contextmenu.prevent
  >
    <!-- Cover -->
    <BookCoverSurface
      class="book-cover-surface--spine-fitted relative w-full rounded-sm overflow-hidden transition-[box-shadow,transform,ring] duration-150 will-change-transform"
      :class="isMissing || selectionMode ? '' : 'group-hover:scale-[1.02]'"
      :interactive="!isMissing && !selectionMode"
      :style="[{ aspectRatio: coverAspectRatio }, !book.hasCover || !coverLoaded || coverFailed ? coverStyle : {}]"
    >
      <!-- Missing border overlay: mirror selected overlay pattern so border is never clipped/hidden -->
      <div v-if="isMissing" class="absolute inset-0 z-30 pointer-events-none rounded-sm ring-2 ring-inset ring-amber-500" />

      <!-- Blurred background fill for mismatched aspect ratios -->
      <img
        v-if="book.hasCover && coverLoaded && !coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-90 transition-opacity duration-300 ease-out"
        aria-hidden="true"
        loading="lazy"
      />

      <img
        v-if="book.hasCover && !coverFailed"
        :ref="onMainImgRef"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ease-out"
        :class="[isMissing ? 'brightness-50' : '', coverLoaded ? 'opacity-100' : 'opacity-0']"
        loading="lazy"
        decoding="async"
        :alt="book.title ?? ''"
        @load="handleMainImageLoad"
        @error="coverFailed = true"
      />

      <div v-if="book.hasCover && coverLoaded && !coverFailed" class="book-cover-spine-layer absolute z-[3]" :style="fittedCoverSpineStyle" />

      <!-- Skeleton shimmer while a known-cover loads -->
      <div v-if="book.hasCover && !coverLoaded && !coverFailed" class="absolute inset-0 animate-pulse bg-white/10" />

      <!-- Top-left overlay: read status -->
      <div
        v-if="showReadBadge && !isMissing"
        class="absolute top-1.5 left-1.5 z-10 flex items-center justify-center rounded-full bg-black/60 p-1 pointer-events-none group-hover:opacity-0 transition-opacity duration-150"
      >
        <component :is="STATUS_ICONS[localReadStatus!]" :size="12" :class="STATUS_COLORS[localReadStatus!]" />
      </div>

      <!-- Top-right overlay container: lock status (above) + series position (below) -->
      <div class="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1 pointer-events-none">
        <div
          v-if="showLockStatusPill"
          class="flex items-center justify-center rounded-full bg-black/60 p-1 group-hover:opacity-0 transition-opacity duration-150"
        >
          <component :is="metadataLocked ? Lock : LockOpen" :size="12" :class="metadataLocked ? 'text-amber-400' : 'text-emerald-400'" />
        </div>

        <Tooltip v-if="showSeriesPositionBadge">
          <TooltipTrigger as-child>
            <div
              class="pointer-events-auto flex items-center bg-black/60 rounded-full px-1.5 py-0.5 group-hover:opacity-0 transition-opacity duration-150 cursor-default"
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
        class="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5 pointer-events-none group-hover:opacity-0 transition-opacity duration-150"
      >
        <Star class="size-3" :style="{ fill: ratingColor, color: ratingColor }" />
        <span class="text-[9px] font-bold text-white leading-none">{{ Math.round(book.rating!) }}</span>
      </div>

      <!-- Bottom-right overlay: format badge -->
      <div
        v-if="showFormatOverlay && !selectionMode"
        class="absolute bottom-1.5 right-1.5 z-10 group-hover:opacity-0 transition-opacity duration-150 pointer-events-none"
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
        class="absolute bottom-0 left-0 z-10 h-0.75 transition-[width] duration-500 [box-shadow:0_-1px_0_rgba(255,255,255,0.25)]"
        style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)"
        :class="book.readingProgress === 100 ? 'bg-green-500/80' : 'bg-primary/70'"
        :style="{ width: `${book.readingProgress}%` }"
      />

      <!-- Selection checkbox overlay -->
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

      <!-- Placeholder shown when book has no cover or cover failed to load -->
      <BookCoverPlaceholder
        v-if="!book.hasCover || coverFailed"
        :title="book.title"
        :author-line="authorLine"
        :is-audio="isAudiobook"
        :seed="book.title ?? String(book.id)"
      />

      <!-- Refresh spinner overlay -->
      <Transition name="fade">
        <div v-if="anyRefreshing" class="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
          <Loader2 class="size-[32cqi] animate-spin text-white drop-shadow-lg" />
        </div>
      </Transition>

      <!-- Hover overlay -->
      <div
        v-if="!selectionMode"
        class="absolute inset-0 flex flex-col p-2 bg-black/70 transition-opacity duration-150"
        :class="[showMobileOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto']"
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

        <!-- Bottom: title/author -->
        <div class="shrink-0 flex flex-col pr-10">
          <div class="flex items-start justify-between gap-2">
            <p v-if="showHoverText" class="text-xs font-semibold text-white leading-tight min-w-0 flex-1" :class="hoverTitleClampClass">
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

        <!-- Kebab menu anchored to lower-right -->
        <div class="absolute bottom-2 right-2 z-20">
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

              <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
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
    </BookCoverSurface>
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
</style>
