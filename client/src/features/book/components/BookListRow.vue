<script setup lang="ts">
import type { BookCard, BookFileRef } from '@bookorbit/types'
import { FORMAT_TO_GROUP } from '@bookorbit/types'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { api } from '@/lib/api'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  ExternalLink,
  FolderPlus,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCoverVersions } from '../composables/useCoverVersions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { useRefreshMetadata } from '../composables/useRefreshMetadata'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { RATING_STARS, getRatingStarClass } from '@/features/book/lib/rating-stars'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { displayPublishedDate } from '../lib/published-date'

const COLLAPSED_SERIES_COVER_LIMIT = 3

const { t } = useI18n()
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
  'rating-change': [rating: number | null]
}>()

const { hasPermission } = usePermissions()
const { thumbnailClickAction } = useDisplaySettings()
const showSendDialog = ref(false)

const collapsedSeries = computed(() => props.book.collapsedSeries ?? null)
const isCollapsedSeries = computed(() => collapsedSeries.value !== null)
const canOpenSeries = computed(() => isCollapsedSeries.value && props.book.seriesId != null)
const collapsedSeriesName = computed(() => props.book.seriesName?.trim() || props.book.title?.trim() || t('book.collapsedSeries.label'))
const collapsedBookCount = computed(() => collapsedSeries.value?.bookCount ?? 0)
const collapsedReadCount = computed(() => collapsedSeries.value?.readCount ?? 0)
const collapsedCoverIds = computed(
  () => collapsedSeries.value?.coverBookIds.filter((bookId) => bookId > 0).slice(0, COLLAPSED_SERIES_COVER_LIMIT) ?? [],
)
const collapsedCoverIsStacked = computed(() => collapsedCoverIds.value.length > 1)
const collapsedCoverContainerClass = computed(() =>
  collapsedCoverIsStacked.value ? 'flex h-20 w-20 shrink-0 items-center' : 'flex h-20 w-16 shrink-0 items-center',
)
const collapsedCoverSurfaceClass = computed(() => [
  'book-cover-surface--spine-fitted relative shrink-0 overflow-hidden rounded-sm shadow-sm',
  collapsedCoverIsStacked.value ? '-ml-8 first:ml-0 w-12 ring-1 ring-background/80' : 'w-16',
])
const collapsedCountLabel = computed(() => t('book.collapsedSeries.bookCount', { count: collapsedBookCount.value }, collapsedBookCount.value))
const collapsedProgressPercent = computed(() => {
  if (collapsedBookCount.value <= 0) return 0
  return Math.min(100, Math.max(0, (collapsedReadCount.value / collapsedBookCount.value) * 100))
})
const authorLine = computed(() => props.book.authors.join(', ') || null)
const authorQuery = computed(() => props.book.authors[0] ?? null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const isMissing = computed(() => props.book.status === 'missing')
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isAudiobook = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')
const secondaryFiles = computed(() => props.book.files.filter((f) => f !== primaryFile.value))

const uniqueSecondaryFiles = computed(() => {
  const seenFormats = new Set<string>()
  if (primaryFile.value?.format) seenFormats.add(primaryFile.value.format)

  return secondaryFiles.value.filter((f) => {
    const format = f.format
    if (!format) return true
    if (seenFormats.has(format)) return false
    seenFormats.add(format)
    return true
  })
})

const metaLine = computed(() => {
  const parts: string[] = []
  const published = displayPublishedDate(props.book.publishedDate, props.book.publishedYear)
  if (published) parts.push(published)
  if (props.book.language) parts.push(props.book.language.toUpperCase())
  return parts.length > 0 ? parts.join(' · ') : null
})

const visibleTags = computed(() => props.book.genres.slice(0, 2))

const localRating = ref<number | null>(props.book.rating)
const hoverRating = ref<number | null>(null)
const displayRating = computed(() => hoverRating.value ?? localRating.value)

watch(
  () => props.book.rating,
  (rating) => {
    localRating.value = rating ?? null
  },
)

async function setRating(star: number) {
  const newRating = localRating.value === star ? null : star
  localRating.value = newRating
  emit('rating-change', newRating)
  await api(`/api/v1/books/${props.book.id}/metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: newRating }),
  })
}

const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'thumbnail', props.book.updatedAt ?? props.book.addedAt))

const { refreshing, refreshWithFeedback } = useRefreshMetadata()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

function openFile(file: BookFileRef, mode?: 'peek') {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function peekPrimaryFile() {
  if (!primaryFile.value || isMissing.value) return
  openFile(primaryFile.value, 'peek')
}

function openAuthorBrowse() {
  if (!authorQuery.value) return
  void router.push({ name: 'authors', query: { q: authorQuery.value } })
}

function openBookDetails() {
  void router.push({ name: 'book-detail', params: { bookId: props.book.id } })
}

function openSeriesDetails() {
  if (props.book.seriesId == null) return
  void router.push({ name: 'series-detail', params: { seriesId: props.book.seriesId } })
}

function collapsedCoverVersion(bookId: number): string | null | undefined {
  if (bookId === props.book.id) return props.book.updatedAt ?? props.book.addedAt
  return collapsedSeries.value?.coverUpdatedAtByBookId?.[bookId]
}

function collapsedCoverSrc(bookId: number): string {
  return coverUrl(bookId, 'thumbnail', collapsedCoverVersion(bookId))
}

function handleRowClick(event: MouseEvent) {
  if (props.selectionMode) {
    emit('select', event)
    return
  }

  if (isCollapsedSeries.value) {
    openSeriesDetails()
    return
  }

  if (thumbnailClickAction.value === 'details') {
    openBookDetails()
    return
  }

  emit('action', 'quick-view')
}
</script>

<template>
  <div
    v-if="isCollapsedSeries"
    data-testid="collapsed-series-list-row"
    class="flex items-center gap-3 py-3 px-2 rounded-md transition-colors"
    :class="[
      selectionMode ? 'cursor-pointer select-none' : canOpenSeries ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default',
      selected ? 'bg-primary/8 ring-1 ring-primary/30' : '',
    ]"
    @click="handleRowClick"
  >
    <div
      v-if="selectionMode"
      class="h-5 w-5 rounded shrink-0 flex items-center justify-center transition-colors"
      :class="selected ? 'bg-primary' : 'border border-border bg-background'"
    >
      <Check v-if="selected" class="text-primary-foreground" :size="12" />
    </div>

    <div :class="collapsedCoverContainerClass">
      <template v-if="collapsedCoverIds.length > 0">
        <BookCoverSurface
          v-for="bookId in collapsedCoverIds"
          :key="bookId"
          data-testid="collapsed-series-cover"
          size="mini"
          :class="collapsedCoverSurfaceClass"
          :disable-spine="isAudiobook"
          :is-comic="isComic"
          :style="{ aspectRatio: coverAspectRatio }"
        >
          <img :src="collapsedCoverSrc(bookId)" class="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" alt="" />
        </BookCoverSurface>
      </template>
      <BookCoverSurface
        v-else
        data-testid="collapsed-series-cover-fallback"
        size="mini"
        :class="collapsedCoverSurfaceClass"
        :disable-spine="isAudiobook"
        :is-comic="isComic"
        :style="{ aspectRatio: coverAspectRatio }"
      >
        <BookCoverArtwork
          :src="null"
          :has-cover="false"
          :title="collapsedSeriesName"
          :author-line="authorLine"
          :is-audio="isAudiobook"
          :seed="`series-${book.seriesId ?? book.id}`"
          alt=""
          :spine="!isAudiobook"
          :is-comic="isComic"
        />
      </BookCoverSurface>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-semibold leading-snug text-foreground">{{ collapsedSeriesName }}</span>
        <span class="hidden shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary sm:inline-flex">
          {{ t('book.collapsedSeries.label') }}
        </span>
      </div>
      <button v-if="authorLine" class="w-fit max-w-full truncate text-xs text-muted-foreground hover:underline" @click.stop="openAuthorBrowse">
        {{ authorLine }}
      </button>
      <div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <LibraryBig class="size-3.5 shrink-0 text-muted-foreground/70" />
        <span class="truncate">{{ collapsedCountLabel }}</span>
        <span v-if="collapsedReadCount > 0" class="shrink-0">
          &middot; {{ t('book.collapsedSeries.readCount', { count: collapsedReadCount }, collapsedReadCount) }}
        </span>
      </div>
      <div
        v-if="collapsedReadCount > 0 && collapsedBookCount > 0"
        data-testid="collapsed-series-progress"
        class="mt-1 h-1 w-32 max-w-full overflow-hidden rounded-full bg-muted"
      >
        <div class="h-full rounded-full bg-primary/60 transition-all" :style="{ width: `${collapsedProgressPercent}%` }" />
      </div>
    </div>

    <div v-if="!selectionMode" class="flex shrink-0 items-center gap-2">
      <ChevronRight class="size-4 text-muted-foreground/60 transition-colors" />
    </div>
  </div>
  <div
    v-else
    class="flex items-center gap-3 py-3 px-2 rounded-md transition-colors cursor-pointer"
    :class="[
      selectionMode ? 'cursor-pointer select-none' : '',
      selected ? 'bg-primary/8 ring-1 ring-primary/30' : '',
      isMissing ? 'grayscale opacity-60' : 'hover:bg-muted/50',
    ]"
    @click="handleRowClick"
  >
    <!-- Selection checkbox -->
    <div
      v-if="selectionMode"
      class="h-5 w-5 rounded shrink-0 flex items-center justify-center transition-colors"
      :class="selected ? 'bg-primary' : 'border border-border bg-background'"
    >
      <Check v-if="selected" class="text-primary-foreground" :size="12" />
    </div>

    <!-- Cover -->
    <BookCoverSurface
      size="mini"
      class="book-cover-surface--spine-fitted w-16 rounded shrink-0 overflow-hidden relative"
      :disable-spine="isAudiobook"
      :is-comic="isComic"
      :class="isMissing ? 'opacity-50 grayscale' : ''"
      :style="{ aspectRatio: coverAspectRatio }"
    >
      <BookCoverArtwork
        :src="coverSrc"
        :has-cover="book.hasCover"
        :title="book.title"
        :author-line="authorLine"
        :is-audio="isAudiobook"
        :seed="book.title ?? String(book.id)"
        :alt="book.title ?? ''"
        backdrop-class="blur-md brightness-50"
        :spine="!isAudiobook"
        :is-comic="isComic"
      />
    </BookCoverSurface>

    <!-- Main info -->
    <div class="flex flex-col min-w-0 flex-1 gap-0.5">
      <span class="text-sm font-medium text-foreground truncate leading-snug" :class="isMissing ? 'opacity-60' : ''">{{ book.title ?? '-' }}</span>
      <button v-if="authorLine" class="w-fit max-w-full text-xs text-muted-foreground truncate hover:underline" @click.stop="openAuthorBrowse">
        {{ authorLine }}
      </button>
      <span v-if="seriesLine" class="text-xs text-muted-foreground truncate italic">{{ seriesLine }}</span>
      <span v-if="metaLine" class="text-xs text-muted-foreground truncate">{{ metaLine }}</span>
      <div v-if="visibleTags.length > 0" class="flex items-center gap-1 flex-wrap">
        <span v-for="tag in visibleTags" :key="tag" class="text-[11px] px-1.5 py-0 rounded-full bg-muted text-muted-foreground leading-5">{{
          tag
        }}</span>
      </div>
      <!-- Reading progress -->
      <div v-if="book.readingProgress != null && book.readingProgress > 0" class="mt-1">
        <div class="h-1 w-24 rounded-full bg-muted overflow-hidden">
          <div class="h-full rounded-full bg-primary/60 transition-all" :style="{ width: `${book.readingProgress}%` }" />
        </div>
      </div>
    </div>

    <!-- Right badges + actions -->
    <div v-if="!selectionMode" class="flex items-center gap-1.5 shrink-0" @click.stop>
      <!-- Star rating -->
      <div class="hidden sm:flex items-center gap-0.5" @mouseleave="hoverRating = null">
        <Tooltip v-for="star in RATING_STARS" :key="star">
          <TooltipTrigger as-child>
            <button class="p-0.5 transition-colors" @mouseenter="hoverRating = star" @click="setRating(star)">
              <Star class="size-3" :class="getRatingStarClass(star, displayRating)" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.actions.rate', { star }) }}</TooltipContent>
        </Tooltip>
      </div>

      <!-- Format badges -->
      <div class="flex items-center gap-1">
        <span
          v-if="isMissing"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert class="size-3 shrink-0" />
          <span class="hidden sm:inline">{{ t('book.card.missing') }}</span>
        </span>
        <Tooltip v-if="primaryFile && !isMissing">
          <TooltipTrigger as-child>
            <button
              class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
              @click="openFile(primaryFile)"
            >
              {{ primaryFile.format ?? '?' }}
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.actions.openAs', { format: primaryFile.format?.toUpperCase() ?? t('book.unknownFormat') }) }}</TooltipContent>
        </Tooltip>
        <Tooltip v-for="file in uniqueSecondaryFiles" :key="file.id">
          <TooltipTrigger as-child>
            <button
              class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
              @click="openFile(file)"
            >
              {{ file.format ?? '?' }}
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.actions.openAs', { format: file.format?.toUpperCase() ?? t('book.unknownFormat') }) }}</TooltipContent>
        </Tooltip>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <MoreHorizontal class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem :disabled="!primaryFile || isMissing" @click="primaryFile && !isMissing && openFile(primaryFile)">
            <BookOpen class="size-4 mr-2" />
            {{ t('book.actions.read') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!primaryFile || isMissing" @click="peekPrimaryFile">
            <Eye class="size-4 mr-2" />
            {{ t('book.actions.peek') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'quick-view')">
            <PanelRight class="size-4 mr-2" />
            {{ t('book.actions.quickView') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="openBookDetails">
            <ExternalLink class="size-4 mr-2" />
            {{ t('book.actions.bookDetails') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            v-if="hasPermission('library_edit_metadata')"
            @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })"
          >
            <Pencil class="size-4 mr-2" />
            {{ t('book.actions.editMetadata') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" :disabled="refreshing" @click="refreshWithFeedback(book.id)">
            <Loader2 v-if="refreshing" class="size-4 mr-2 animate-spin" />
            <RefreshCw v-else class="size-4 mr-2" />
            {{ t('book.actions.refreshMetadata') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'add-to-collection')">
            <FolderPlus class="size-4 mr-2" />
            {{ t('book.actions.addToCollection') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
            <Send class="size-4 mr-2" />
            {{ t('book.actions.sendViaEmail') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="hasPermission('library_delete_books')" />
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
  </div>

  <SendBookDialog
    v-if="showSendDialog"
    :open="showSendDialog"
    :selection-payload="{ bookIds: [book.id] }"
    :selected-count="1"
    :book-files="book.files"
    :book-title="book.title ?? undefined"
    @update:open="showSendDialog = $event"
  />
</template>
