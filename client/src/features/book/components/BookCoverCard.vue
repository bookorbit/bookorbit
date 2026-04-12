<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@projectx/types'
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
  Headphones,
  Image,
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
import type { ReadStatus } from '@projectx/types'
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
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'

const router = useRouter()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
}>()

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: [event: MouseEvent]
}>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const authorQuery = computed(() => props.book.authors[0] ?? null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

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
const { hasPermission } = usePermissions()
const { cardOverlays } = useDisplaySettings()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const showSendDialog = ref(false)

const showSeriesOverlay = computed(() => cardOverlays.value.includes('series') && seriesLine.value != null)
const hasProgress = computed(() => props.book.readingProgress != null && props.book.readingProgress > 0)
const showProgressBar = computed(() => cardOverlays.value.includes('progress-bar') && hasProgress.value)
const showProgressPill = computed(() => cardOverlays.value.includes('progress-pill') && hasProgress.value)
const showFormatOverlay = computed(() => cardOverlays.value.includes('format') && primaryFile.value?.format != null)
const showRatingOverlay = computed(() => cardOverlays.value.includes('rating') && props.book.rating != null)
const showNewOverlay = computed(() => {
  if (!cardOverlays.value.includes('new')) return false
  const addedAt = new Date(props.book.addedAt)
  return Date.now() - addedAt.getTime() < 7 * 24 * 60 * 60 * 1000
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
const isMissing = computed(() => props.book.status === 'missing')
const showMobileOverlay = ref(false)
const root = ref<HTMLElement | null>(null)

const isTouch = computed(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
})

function onMainImgRef(el: Element | ComponentPublicInstance | null) {
  const img = el as HTMLImageElement | null
  if (img?.complete && img.naturalWidth > 0) coverLoaded.value = true
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

const showAuthorOnHover = computed(() => coverLoaded.value && !!authorLine.value)
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
    class="group flex flex-col @container"
    :class="[selectionMode || (primaryFile && !isMissing) ? 'cursor-pointer' : 'cursor-default', selectionMode ? 'select-none' : '']"
    @click="handleCardClick"
    @contextmenu.prevent
  >
    <!-- Cover -->
    <div
      class="relative w-full rounded-sm overflow-hidden shadow-md transition-[box-shadow,transform,ring] duration-150 will-change-transform"
      :class="[isMissing ? '' : selectionMode ? '' : 'group-hover:shadow-xl group-hover:scale-[1.02]']"
      :style="[{ aspectRatio: coverAspectRatio }, !coverLoaded || coverFailed ? coverStyle : {}]"
    >
      <!-- Missing border overlay: mirror selected overlay pattern so border is never clipped/hidden -->
      <div v-if="isMissing" class="absolute inset-0 z-30 pointer-events-none rounded-sm ring-2 ring-inset ring-amber-500" />

      <!-- Blurred background fill for mismatched aspect ratios -->
      <img
        v-if="coverLoaded && !coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-90"
        aria-hidden="true"
        loading="lazy"
      />

      <img
        v-if="!coverFailed"
        :ref="onMainImgRef"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-contain"
        :class="isMissing ? 'brightness-50' : ''"
        loading="lazy"
        decoding="async"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />

      <!-- Series badge -->
      <div v-if="showSeriesOverlay" class="absolute top-1.5 left-1.5 right-1.5 z-10 pointer-events-none">
        <span
          class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/60 line-clamp-1"
          :style="{ color: coverStyle.color }"
        >
          {{ seriesLine }}
        </span>
      </div>

      <!-- "New" dot - top-right accent indicator -->
      <div v-if="showNewOverlay && !isMissing" class="absolute top-1.5 right-1.5 z-10 size-2 rounded-full bg-primary shadow-sm pointer-events-none" />

      <!-- Read status icon - top-left -->
      <div
        v-if="showReadBadge && !isMissing"
        class="absolute top-1.5 left-1.5 z-10 pointer-events-none group-hover:opacity-0 transition-opacity duration-150"
      >
        <component
          :is="STATUS_ICONS[localReadStatus!]"
          :size="14"
          :class="[STATUS_COLORS[localReadStatus!], 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]']"
        />
      </div>

      <!-- Bottom-left overlays: rating dots + progress pill -->
      <div
        v-if="(showRatingOverlay || showProgressPill) && !selectionMode"
        class="absolute bottom-1.5 left-1.5 z-10 flex flex-col gap-0.5 items-start pointer-events-none"
      >
        <div v-if="showProgressPill">
          <span
            v-if="book.readingProgress === 100"
            class="flex items-center gap-0.5 text-[8px] font-semibold px-1.5 py-0.5 rounded bg-green-600/90 text-white"
          >
            <Check :size="8" />
          </span>
          <span v-else class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60" :style="{ color: coverStyle.color }">
            {{ Math.floor(book.readingProgress!) }}%
          </span>
        </div>
        <div v-if="showRatingOverlay" class="relative flex items-center justify-center size-5 group-hover:opacity-0 transition-opacity duration-150">
          <Star class="size-5" :style="{ fill: ratingColor, color: ratingColor }" />
          <span class="absolute text-[7px] font-black text-white leading-none" style="margin-top: 1px">
            {{ Math.round(book.rating!) }}
          </span>
        </div>
      </div>

      <!-- Format badge - bottom-right -->
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

      <!-- Audiobook badge - bottom-left, distinct from series/read-status badges at top-left -->
      <div
        v-if="isAudiobook && !selectionMode"
        class="absolute bottom-5 left-1.5 z-10 group-hover:opacity-0 transition-opacity duration-150 pointer-events-none"
      >
        <span class="flex items-center gap-0.5 bg-black/60 text-white rounded px-1.5 py-0.5">
          <Headphones class="size-2.5" />
        </span>
      </div>

      <!-- Reading progress bar - bottom edge -->
      <div
        v-if="showProgressBar && !selectionMode"
        class="absolute bottom-0 left-0 z-10 h-0.75 transition-all duration-300"
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

      <!-- Title + author (no-cover fallback, always visible when cover absent) -->
      <div v-if="!coverLoaded" class="absolute bottom-0 left-0 right-0 p-2 bg-linear-to-t from-black/60 to-transparent">
        <p class="text-xs font-bold leading-tight" :class="hoverTitleClampClass" :style="{ color: coverStyle.color }">
          {{ book.title ?? '-' }}
        </p>
        <button
          v-if="authorLine"
          class="text-[10px] mt-0.5 opacity-80 truncate hover:underline block w-full text-left"
          :style="{ color: coverStyle.color }"
          @click.stop="openAuthorBrowse"
        >
          {{ authorLine }}
        </button>
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
        class="absolute inset-0 flex flex-col p-2 bg-black/70 transition-opacity duration-150"
        :class="[showMobileOverlay || 'group-hover:opacity-100 group-active:opacity-100', showMobileOverlay ? 'opacity-100' : 'opacity-0']"
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
            :class="[showMobileOverlay || 'group-hover:scale-100 group-active:scale-100', showMobileOverlay ? 'scale-100' : '']"
            @click.stop="openFile(primaryFile)"
          >
            <component :is="isAudiobook ? Play : BookOpen" class="size-[16cqi]" :class="{ 'ml-[2cqi]': isAudiobook }" />
          </button>
        </div>

        <!-- Bottom: title/author -->
        <div class="shrink-0 flex flex-col pr-10">
          <div class="flex items-start justify-between gap-2">
            <p v-if="coverLoaded" class="text-xs font-semibold text-white leading-tight min-w-0 flex-1" :class="hoverTitleClampClass">
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
                  <DropdownMenuItem :disabled="anyRefreshing" @click="refreshWithFeedback(book.id)">
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
              <DropdownMenuSeparator />
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
