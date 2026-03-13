<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Download, FolderPlus, Pencil, Star, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { getProviderColor } from '@/lib/provider-colors'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import type { BookDetail, BookKoboState } from '@projectx/types'
import RecommendedBooksRow from '@/features/book/components/detail/RecommendedBooksRow.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
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

type BookmarkItem = {
  id: number
  title: string
  createdAt: string
}

type AnnotationItem = {
  id: number
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
const router = useRouter()

const addToCollectionOpen = ref(false)
const scoreBreakdownOpen = ref(false)

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

const { hasPermission } = usePermissions()
const canViewKobo = computed(() => hasPermission('kobo_sync'))

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'cover'))

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const authorLine = computed(() => props.book.authors.map((a) => a.name).join(', ') || null)
const formats = computed(() => [...new Set(props.book.files.map((f) => f.format ?? '?'))])
const ratingStars = [1, 2, 3, 4, 5]

const fileProgressById = ref<Record<number, FileProgress>>({})
const bookmarks = ref<BookmarkItem[]>([])
const annotations = ref<AnnotationItem[]>([])
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
      iconUrl: 'https://hardcover.app/favicon.ico',
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
  return out
})

const latestBookmark = computed(() => {
  if (bookmarks.value.length === 0) return null
  return [...bookmarks.value].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
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
const activityExpanded = ref(false)
const hasReadingSignals = computed(() => detailProgressRows.value.length > 0 || bookmarks.value.length > 0 || annotations.value.length > 0)
const hasKoboSignals = computed(() => {
  if (!canViewKobo.value || !koboState.value) return false
  const state = koboState.value
  const hasSnapshotFlags =
    state.snapshot != null &&
    (state.snapshot.inSnapshot ||
      state.snapshot.synced != null ||
      state.snapshot.pendingDelete != null ||
      state.snapshot.isNew != null ||
      state.snapshot.removedByDevice != null)
  return state.syncCollections.length > 0 || state.readingState != null || hasSnapshotFlags
})
const showActivitySummary = computed(() => hasReadingSignals.value || hasKoboSignals.value)
const activitySummaryLine = computed(() => {
  const parts: string[] = []
  const maxProgress = detailProgressRows.value.length > 0 ? Math.max(...detailProgressRows.value.map((r) => r.progress.percentage)) : 0
  if (maxProgress > 0) parts.push(`Progress ${formatPercent(maxProgress)}`)
  if (bookmarks.value.length > 0) parts.push(`Bookmarks ${bookmarks.value.length}`)
  if (annotations.value.length > 0) parts.push(`Highlights ${annotations.value.length}`)
  const koboProgress = koboState.value?.readingState?.progressPercent
  if (koboProgress != null) parts.push(`Kobo ${formatPercent(koboProgress)}`)
  return parts.length > 0 ? parts.join(' · ') : 'No reading activity yet'
})

const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function boolState(value: boolean | null | undefined): string {
  if (value == null) return 'n/a'
  return value ? 'yes' : 'no'
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
  router.push({ name: 'book-edit', params: { bookId: props.book.id } })
}

function openBook() {
  if (!primaryFile.value) return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: primaryFile.value.id },
    query: { format: primaryFile.value.format ?? 'epub' },
  })
}

function downloadFile() {
  if (!primaryFile.value) return
  const a = document.createElement('a')
  a.href = `/api/v1/books/files/${primaryFile.value.id}/serve?download=1`
  a.click()
}

let supplementalRequestId = 0

async function loadSupplemental() {
  const requestId = ++supplementalRequestId
  supplementalLoading.value = true
  try {
    const progressPromises = props.book.files.map(async (file) => {
      try {
        const res = await api(`/api/v1/books/files/${file.id}/progress`)
        if (!res.ok) {
          return { fileId: file.id, percentage: 0, cfi: null, pageNumber: null, updatedAt: null }
        }
        const data = (await res.json()) as Partial<FileProgress>
        return {
          fileId: file.id,
          percentage: typeof data.percentage === 'number' ? data.percentage : 0,
          cfi: data.cfi ?? null,
          pageNumber: data.pageNumber ?? null,
          updatedAt: data.updatedAt ?? null,
        }
      } catch {
        return { fileId: file.id, percentage: 0, cfi: null, pageNumber: null, updatedAt: null }
      }
    })

    const bookmarksPromise = api(`/api/v1/books/${props.book.id}/bookmarks`)
    const annotationsPromise = api(`/api/v1/books/${props.book.id}/annotations`)
    const collectionsPromise = api(`/api/v1/collections?bookIds=${props.book.id}`)
    const koboPromise = canViewKobo.value ? api(`/api/v1/books/${props.book.id}/kobo-state`) : Promise.resolve(null)

    const [progressRows, bookmarksRes, annotationsRes, collectionsRes, koboRes] = await Promise.all([
      Promise.all(progressPromises),
      bookmarksPromise,
      annotationsPromise,
      collectionsPromise,
      koboPromise,
    ])

    if (requestId !== supplementalRequestId) return

    const progressMap: Record<number, FileProgress> = {}
    for (const row of progressRows) {
      progressMap[row.fileId] = {
        percentage: row.percentage,
        cfi: row.cfi,
        pageNumber: row.pageNumber,
        updatedAt: row.updatedAt,
      }
    }
    fileProgressById.value = progressMap

    bookmarks.value = bookmarksRes.ok ? ((await bookmarksRes.json()) as BookmarkItem[]) : []
    annotations.value = annotationsRes.ok ? ((await annotationsRes.json()) as AnnotationItem[]) : []
    collections.value = collectionsRes.ok ? ((await collectionsRes.json()) as CollectionMembership[]) : []

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
    bookmarks.value = []
    annotations.value = []
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
    activityExpanded.value = false
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

  <div class="flex flex-col md:flex-row gap-8">
    <!-- Left column: cover + actions -->
    <div class="md:w-56 shrink-0 md:sticky md:top-4 md:self-start">
      <div class="max-w-48 mx-auto md:max-w-none">
        <div
          class="group relative w-full rounded-sm overflow-hidden shadow-md cursor-zoom-in bg-muted/50"
          style="aspect-ratio: 2/3"
          :style="coverLoaded ? {} : coverStyle"
          @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="router.push({ name: 'book-edit', params: { bookId: book.id } })"
              >
                <Pencil class="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit cover</TooltipContent>
          </Tooltip>
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="w-full h-full object-contain transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            :alt="book.title ?? ''"
            @load="coverLoaded = true"
            @error="coverFailed = true"
          />
        </div>

        <div class="mt-4 space-y-2">
          <button
            class="flex w-full items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="!primaryFile"
            @click="openBook"
          >
            <BookOpen class="size-4" />
            Read
          </button>
          <div class="flex gap-2">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  :disabled="!primaryFile"
                  @click="downloadFile"
                >
                  <Download class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
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
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  @click="promptDelete(book.id)"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div class="flex-1 min-w-0">
      <!-- Identity block -->
      <div class="flex items-baseline flex-wrap gap-x-2 gap-y-1">
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
        <div v-if="providerLinks.length" class="flex items-center gap-1.5 shrink-0">
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
            <span v-else class="text-[9px] font-bold leading-none text-foreground/90">{{ link.fallback }}</span>
          </a>
        </div>
      </div>
      <p v-if="book.subtitle" class="text-base text-muted-foreground mt-1 leading-snug">{{ book.subtitle }}</p>

      <div class="flex items-baseline flex-wrap gap-x-2 gap-y-1 mt-3">
        <p v-if="authorLine" class="text-sm">
          <span class="text-muted-foreground">by</span>
          <span class="ml-1 font-medium text-foreground">{{ authorLine }}</span>
        </p>
        <template v-if="seriesLine">
          <span class="text-muted-foreground/40 text-xs">·</span>
          <span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ seriesLine }}</span>
        </template>
      </div>

      <!-- Format badges -->
      <div v-if="formats.length" class="flex flex-wrap gap-1.5 mt-4">
        <span
          v-for="fmt in formats"
          :key="fmt"
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
          :style="formatBadgeStyle(fmt)"
        >
          {{ fmt }}
        </span>
      </div>

      <!-- Genres -->
      <div v-if="book.genres.length" class="flex flex-wrap gap-1.5 mt-4">
        <span v-for="genre in book.genres" :key="genre" class="text-xs px-2.5 py-0.5 rounded-full border border-primary/30 text-primary/80">
          {{ genre }}
        </span>
      </div>

      <!-- Tags -->
      <div v-if="book.tags.length" class="flex flex-wrap gap-1.5 mt-3">
        <span v-for="tag in book.tags" :key="tag" class="text-xs px-2.5 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground">
          #{{ tag }}
        </span>
      </div>

      <!-- Metadata grid -->
      <dl
        v-if="
          book.publisher ||
          book.publishedYear ||
          book.language ||
          book.pageCount ||
          book.isbn13 ||
          book.isbn10 ||
          book.rating != null ||
          book.lastWrittenAt
        "
        class="mt-5 pt-5 border-t border-border grid grid-cols-2 xl:grid-cols-4 gap-x-8 gap-y-4"
      >
        <div v-if="book.publisher" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Publisher</dt>
          <dd class="text-sm text-foreground mt-0.5 leading-snug">{{ book.publisher }}</dd>
        </div>
        <div v-if="book.publishedYear">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Published</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.publishedYear }}</dd>
        </div>
        <div v-if="book.language">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Language</dt>
          <dd class="text-sm text-foreground mt-0.5 capitalize">{{ book.language }}</dd>
        </div>
        <div v-if="book.pageCount">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Pages</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.pageCount }}</dd>
        </div>
        <div v-if="book.isbn13" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-13</dt>
          <dd class="text-sm text-foreground mt-0.5 font-mono">{{ book.isbn13 }}</dd>
        </div>
        <div v-if="book.isbn10" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-10</dt>
          <dd class="text-sm text-foreground mt-0.5 font-mono">{{ book.isbn10 }}</dd>
        </div>
        <div v-if="book.rating != null" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Rating</dt>
          <dd class="mt-0.5 flex items-center gap-1">
            <Star
              v-for="star in ratingStars"
              :key="star"
              class="size-3.5"
              :class="book.rating >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'"
            />
            <span class="text-xs text-muted-foreground ml-1">{{ book.rating }}/5</span>
          </dd>
        </div>
        <div v-if="book.lastWrittenAt" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Last File Sync</dt>
          <dd class="text-sm text-foreground mt-0.5">
            {{ formatDateTime(book.lastWrittenAt) }}
            <span class="text-xs text-muted-foreground ml-1">({{ formatRelative(book.lastWrittenAt) }})</span>
          </dd>
        </div>
      </dl>

      <!-- Compact reading + sync summary -->
      <div v-if="showActivitySummary" class="mt-5 pt-5 border-t border-border">
        <div class="rounded-md border border-border bg-muted/20 px-3 py-2.5">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-foreground truncate">{{ activitySummaryLine }}</p>
            <button
              class="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
              @click="activityExpanded = !activityExpanded"
            >
              {{ activityExpanded ? 'Hide details' : 'Show details' }}
            </button>
          </div>
          <p v-if="supplementalLoading" class="text-[11px] text-muted-foreground mt-1">Refreshing…</p>
        </div>

        <div v-if="activityExpanded" class="mt-3 space-y-2">
          <p v-if="latestBookmark" class="text-xs text-muted-foreground truncate" :title="latestBookmark.title">
            Latest bookmark: {{ latestBookmark.title }} · {{ formatRelative(latestBookmark.createdAt) }}
          </p>

          <div v-for="{ file, progress } in detailProgressRows" :key="file.id" class="rounded-md border border-border px-3 py-2.5 bg-background/60">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-medium truncate min-w-0">
                {{ file.filename ?? `File #${file.id}` }}
                <span class="text-muted-foreground font-normal ml-1">({{ (file.format ?? '?').toUpperCase() }})</span>
              </p>
              <span class="text-xs font-semibold">{{ formatPercent(progress.percentage) }}</span>
            </div>
            <div class="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                :class="progress.percentage >= 100 ? 'bg-green-500/80' : 'bg-primary/70'"
                :style="{ width: `${Math.max(0, Math.min(100, progress.percentage))}%` }"
              />
            </div>
          </div>

          <div v-if="hasKoboSignals" class="rounded-md border border-border px-3 py-2.5 bg-background/60 space-y-1.5">
            <p class="text-xs text-muted-foreground">
              Kobo status:
              <span class="text-foreground">{{ koboState?.readingState?.status ?? 'unknown' }}</span>
              <span v-if="koboState?.readingState?.progressPercent != null">· {{ formatPercent(koboState.readingState.progressPercent) }}</span>
            </p>
            <p v-if="koboState?.readingState?.updatedAt" class="text-xs text-muted-foreground">
              Kobo updated {{ formatRelative(koboState.readingState.updatedAt) }}
            </p>
            <p v-if="koboState?.syncCollections?.length" class="text-xs text-muted-foreground truncate">
              Sync collections: {{ koboState.syncCollections.join(', ') }}
            </p>
            <p v-if="koboState?.snapshot?.inSnapshot" class="text-xs text-muted-foreground">
              Snapshot: in sync queue
              <span v-if="koboState?.snapshot?.synced != null"> · synced {{ boolState(koboState.snapshot.synced) }}</span>
            </p>
            <p
              v-if="koboState?.snapshot?.pendingDelete || koboState?.snapshot?.isNew || koboState?.snapshot?.removedByDevice"
              class="text-xs text-muted-foreground"
            >
              <span v-if="koboState?.snapshot?.pendingDelete">pending delete</span>
              <span v-if="koboState?.snapshot?.isNew" class="ml-2">new</span>
              <span v-if="koboState?.snapshot?.removedByDevice" class="ml-2">removed by device</span>
            </p>
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
