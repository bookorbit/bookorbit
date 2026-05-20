<script setup lang="ts">
import type { BookCard, BookFileRef } from '@bookorbit/types'
import { FORMAT_TO_GROUP } from '@bookorbit/types'
import { bookCoverStyle } from '../lib/book-cover'
import BookCoverPlaceholder from './BookCoverPlaceholder.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { api } from '@/lib/api'
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  BookOpen,
  Check,
  ExternalLink,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCoverVersions } from '../composables/useCoverVersions'
import { coverAspectRatioValue, COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO, fittedCoverFrameStyle } from '../lib/cover-aspect-ratio'
import { useRefreshMetadata } from '../composables/useRefreshMetadata'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { RATING_STARS, getRatingStarClass } from '@/features/book/lib/rating-stars'

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
const showSendDialog = ref(false)

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
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
const secondaryFiles = computed(() => props.book.files.filter((f) => f !== primaryFile.value))

const metaLine = computed(() => {
  const parts: string[] = []
  if (props.book.publishedYear) parts.push(String(props.book.publishedYear))
  if (props.book.language) parts.push(props.book.language.toUpperCase())
  return parts.length > 0 ? parts.join(' · ') : null
})

const visibleTags = computed(() => props.book.genres.slice(0, 2))

const coverLoaded = ref(false)
const coverFailed = ref(false)
const coverImageRatio = ref<number | null>(null)

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
const coverSrc = computed(() => coverUrl(props.book.id))

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
  coverImageRatio.value = null
})

const { refreshing, refreshWithFeedback } = useRefreshMetadata()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const slotAspectRatio = computed(() => coverAspectRatioValue(String(coverAspectRatio.value)))
const fittedCoverSpineStyle = computed(() => fittedCoverFrameStyle(coverImageRatio.value, slotAspectRatio.value))

function handleCoverLoad(event: Event) {
  const target = event.target as HTMLImageElement | null
  if (target && target.naturalWidth > 0 && target.naturalHeight > 0) {
    coverImageRatio.value = target.naturalWidth / target.naturalHeight
  }
  coverLoaded.value = true
}

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function openAuthorBrowse() {
  if (!authorQuery.value) return
  void router.push({ name: 'authors', query: { q: authorQuery.value } })
}
</script>

<template>
  <div
    class="flex items-center gap-3 py-3 px-2 rounded-md transition-colors cursor-pointer"
    :class="[
      selectionMode ? 'cursor-pointer select-none' : '',
      selected ? 'bg-primary/8 ring-1 ring-primary/30' : '',
      isMissing ? 'grayscale opacity-60' : 'hover:bg-muted/50',
    ]"
    @click="selectionMode ? emit('select', $event) : emit('action', 'quick-view')"
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
      :class="isMissing ? 'opacity-50 grayscale' : ''"
      :style="[{ aspectRatio: coverAspectRatio }, !book.hasCover || !coverLoaded || coverFailed ? coverStyle : {}]"
    >
      <!-- Blurred background fill for mismatched aspect ratios -->
      <img
        v-if="book.hasCover && coverLoaded && !coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-50"
        aria-hidden="true"
        loading="lazy"
      />
      <img
        v-if="book.hasCover && !coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-contain"
        loading="lazy"
        decoding="async"
        :alt="book.title ?? ''"
        @load="handleCoverLoad"
        @error="coverFailed = true"
      />
      <div v-if="book.hasCover && coverLoaded && !coverFailed" class="book-cover-spine-layer absolute z-[3]" :style="fittedCoverSpineStyle" />
      <BookCoverPlaceholder
        v-if="!book.hasCover || coverFailed"
        :title="book.title"
        :author-line="authorLine"
        :is-audio="isAudiobook"
        :seed="book.title ?? String(book.id)"
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
          <TooltipContent>Rate {{ star }}</TooltipContent>
        </Tooltip>
      </div>

      <!-- Format badges -->
      <div class="flex items-center gap-1">
        <span
          v-if="isMissing"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert class="size-3 shrink-0" />
          <span class="hidden sm:inline">Missing</span>
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
          <TooltipContent>Open as {{ primaryFile.format?.toUpperCase() ?? 'unknown' }}</TooltipContent>
        </Tooltip>
        <Tooltip v-for="file in secondaryFiles" :key="file.id">
          <TooltipTrigger as-child>
            <button
              class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
              @click="openFile(file)"
            >
              {{ file.format ?? '?' }}
            </button>
          </TooltipTrigger>
          <TooltipContent>Open as {{ file.format?.toUpperCase() ?? 'unknown' }}</TooltipContent>
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
            Open
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'quick-view')">
            <PanelRight class="size-4 mr-2" />
            Quick View
          </DropdownMenuItem>
          <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
            <ExternalLink class="size-4 mr-2" />
            Book Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            v-if="hasPermission('library_edit_metadata')"
            @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })"
          >
            <Pencil class="size-4 mr-2" />
            Edit Metadata
          </DropdownMenuItem>
          <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" :disabled="refreshing" @click="refreshWithFeedback(book.id)">
            <Loader2 v-if="refreshing" class="size-4 mr-2 animate-spin" />
            <RefreshCw v-else class="size-4 mr-2" />
            Refresh Metadata
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'add-to-collection')">
            <FolderPlus class="size-4 mr-2" />
            Add to Collection
          </DropdownMenuItem>
          <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
            <Send class="size-4 mr-2" />
            Send via Email
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="hasPermission('library_delete_books')" />
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

  <SendBookDialog
    v-if="showSendDialog"
    :open="showSendDialog"
    :book-ids="[book.id]"
    :book-files="book.files"
    :book-title="book.title ?? undefined"
    @update:open="showSendDialog = $event"
  />
</template>
