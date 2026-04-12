<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, ExternalLink, Folder, FolderPlus, Headphones, Pencil, Star, Trash2, X } from 'lucide-vue-next'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { DialogRoot, DialogContent, DialogPortal, DialogOverlay, DialogClose, DialogTitle, DialogDescription } from 'reka-ui'
import { formatBytes } from '@/lib/formatting'
import { getProviderColor } from '@/lib/provider-colors'
import { useBookDetail } from '../composables/useBookDetail'
import { useCoverVersions } from '../composables/useCoverVersions'
import { bookCoverStyle } from '../lib/book-cover'
import { getFormatColor } from '../lib/format-colors'
import { FORMAT_TO_GROUP } from '@projectx/types'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ bookId: number | null; open: boolean }>()
const { hasPermission } = usePermissions()
const emit = defineEmits<{
  'update:open': [value: boolean]
  action: [type: 'edit-metadata' | 'add-to-collection' | 'delete']
}>()

type ProviderLink = {
  key: string
  label: string
  url: string
  iconUrl: string
  fallback: string
}

const router = useRouter()
const { detail, loading, fetch } = useBookDetail()

const coverLoaded = ref(false)
const coverFailed = ref(false)
const providerIconErrors = ref<Record<string, boolean>>({})

watch(
  () => props.bookId,
  (id) => {
    if (id !== null) {
      coverLoaded.value = false
      coverFailed.value = false
      descriptionExpanded.value = false
      genresExpanded.value = false
      providerIconErrors.value = {}
      fetch(id)
    }
  },
  { immediate: true },
)

const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => (detail.value ? coverUrl(detail.value.id, 'cover') : null))

const coverStyle = computed(() => (detail.value ? bookCoverStyle(detail.value.title ?? String(detail.value.id)) : {}))

const seriesLine = computed(() => {
  if (!detail.value?.seriesName) return null
  const idx = detail.value.seriesIndex
  return idx != null ? `${detail.value.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : detail.value.seriesName
})

const authorLine = computed(() => detail.value?.authors.map((a) => a.name).join(', ') ?? null)
const ratingStars = [1, 2, 3, 4, 5]
const providerLinks = computed<ProviderLink[]>(() => {
  const out: ProviderLink[] = []
  const ids = detail.value?.providerIds
  if (!ids) return out
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

const descriptionExpanded = ref(false)
const genresExpanded = ref(false)
const coverLightboxOpen = ref(false)

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const primaryFile = computed(() => detail.value?.files.find((f) => f.role === 'primary') ?? detail.value?.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const knownFormats = computed(() => [
  ...new Set((detail.value?.files ?? []).filter((f) => f.format && FORMAT_TO_GROUP[f.format]).map((f) => f.format!)),
])

function providerLinkStyle(provider: string) {
  const color = getProviderColor(provider)
  return {
    borderColor: `${color}66`,
    backgroundColor: `${color}12`,
  }
}

function formatBadgeStyle(fmt: string) {
  const color = getFormatColor(fmt)
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}1a`,
  }
}

function openBook() {
  if (!primaryFile.value || !detail.value) return
  router.push({
    name: 'reader',
    params: { bookId: detail.value.id, fileId: primaryFile.value.id },
    query: { format: primaryFile.value.format ?? 'epub' },
  })
  emit('update:open', false)
}

function editMetadata() {
  if (!detail.value) return
  router.push({ name: 'book-detail', params: { bookId: detail.value.id }, query: { tab: 'edit' } })
  emit('update:open', false)
}

function openDetails() {
  if (!detail.value) return
  router.push({ name: 'book-detail', params: { bookId: detail.value.id } })
  emit('update:open', false)
}

function toggleGenres() {
  genresExpanded.value = !genresExpanded.value
}
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <Sheet :open="props.open" @update:open="emit('update:open', $event)">
      <SheetContent side="right" class="sm:max-w-100 p-0 overflow-hidden">
        <SheetTitle class="sr-only">{{ detail?.title ? `Quick view for ${detail.title}` : 'Book quick view' }}</SheetTitle>
        <SheetDescription class="sr-only">Preview book details and run quick actions.</SheetDescription>
        <div class="flex flex-col h-full">
          <!-- Header: cover + title block -->
          <div class="p-5 pt-10 border-b shrink-0">
            <div v-if="loading" class="flex gap-4 items-start">
              <Skeleton class="w-24 rounded shrink-0" :style="{ aspectRatio: coverAspectRatio }" />
              <div class="flex-1 space-y-2 pt-1">
                <Skeleton class="h-4 w-full" />
                <Skeleton class="h-3 w-3/4" />
                <Skeleton class="h-3 w-1/2" />
              </div>
            </div>

            <div v-else-if="detail" class="flex gap-4 items-start">
              <!-- Cover -->
              <div
                class="w-24 shrink-0 rounded overflow-hidden shadow-md cursor-zoom-in"
                :style="[{ aspectRatio: coverAspectRatio }, coverLoaded ? {} : coverStyle]"
                @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
              >
                <img
                  v-if="!coverFailed"
                  :src="coverSrc!"
                  class="w-full h-full object-contain transition-opacity duration-200"
                  :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
                  :alt="detail.title ?? ''"
                  @load="coverLoaded = true"
                  @error="coverFailed = true"
                />
              </div>

              <!-- Info -->
              <div class="flex-1 min-w-0 pr-2">
                <h2 class="text-sm font-bold leading-snug line-clamp-3">
                  {{ detail.title ?? 'Untitled' }}
                </h2>
                <p v-if="detail.subtitle" class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {{ detail.subtitle }}
                </p>
                <div v-if="providerLinks.length" class="mt-2 flex items-center gap-1">
                  <a
                    v-for="link in providerLinks"
                    :key="link.key"
                    :href="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="`Open in ${link.label}`"
                    class="inline-flex size-6 items-center justify-center rounded border transition-colors hover:bg-muted/60"
                    :style="providerLinkStyle(link.key)"
                  >
                    <img
                      v-if="!providerIconErrors[link.key]"
                      :src="link.iconUrl"
                      :alt="link.label"
                      class="size-3.5 rounded-[2px] object-contain"
                      loading="lazy"
                      @error="providerIconErrors[link.key] = true"
                    />
                    <span v-else class="text-[8px] font-bold leading-none text-foreground/90">{{ link.fallback }}</span>
                  </a>
                </div>
                <p v-if="authorLine" class="text-xs text-foreground/80 mt-2">{{ authorLine }}</p>
                <p v-if="seriesLine" class="text-xs text-muted-foreground mt-0.5 italic">{{ seriesLine }}</p>
                <div v-if="detail.rating != null" class="mt-2 flex items-center gap-1">
                  <Star
                    v-for="star in ratingStars"
                    :key="star"
                    class="size-3"
                    :class="detail.rating >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'"
                  />
                  <span class="text-[10px] text-muted-foreground ml-1">{{ detail.rating }}/5</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Body: scrollable meta + description -->
          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <template v-if="loading">
              <div class="flex gap-1.5">
                <Skeleton class="h-5 w-12 rounded" />
                <Skeleton class="h-5 w-16 rounded" />
                <Skeleton class="h-5 w-10 rounded" />
              </div>
              <Skeleton class="h-3 w-1/2" />
              <Skeleton class="h-32 w-full rounded" />
            </template>

            <template v-else-if="detail">
              <!-- Format badges + meta chips -->
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="fmt in knownFormats"
                  :key="fmt"
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
                  :style="formatBadgeStyle(fmt)"
                >
                  {{ fmt }}
                </span>
                <span v-if="detail.pageCount" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {{ detail.pageCount }} pages
                </span>
                <span v-if="detail.publishedYear" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {{ detail.publishedYear }}
                </span>
                <span
                  v-if="detail.language"
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {{ detail.language }}
                </span>
              </div>

              <!-- Publisher -->
              <p v-if="detail.publisher" class="text-xs text-muted-foreground">
                {{ detail.publisher }}
              </p>

              <!-- Primary file summary -->
              <div v-if="primaryFile" class="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                <p class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Primary File</p>
                <p class="text-xs text-foreground mt-1 truncate">{{ primaryFile.filename ?? `File #${primaryFile.id}` }}</p>
                <div class="mt-1.5 flex items-center gap-1.5">
                  <span
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
                    :style="formatBadgeStyle(primaryFile.format ?? '?')"
                  >
                    {{ (primaryFile.format ?? '?').toUpperCase() }}
                  </span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {{ formatBytes(primaryFile.sizeBytes) }}
                  </span>
                </div>
              </div>

              <!-- ISBN -->
              <dl v-if="detail.isbn13 || detail.isbn10" class="grid grid-cols-1 gap-y-2 border-t pt-4">
                <div v-if="detail.isbn13" class="min-w-0">
                  <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-13</dt>
                  <dd class="text-xs text-foreground mt-0.5 font-mono">{{ detail.isbn13 }}</dd>
                </div>
                <div v-if="detail.isbn10" class="min-w-0">
                  <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-10</dt>
                  <dd class="text-xs text-foreground mt-0.5 font-mono">{{ detail.isbn10 }}</dd>
                </div>
              </dl>

              <!-- Genres -->
              <div v-if="detail.genres.length">
                <div class="flex flex-wrap gap-1.5 overflow-hidden transition-all" :style="genresExpanded ? {} : { maxHeight: '78px' }">
                  <span v-for="genre in detail.genres" :key="genre" class="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {{ genre }}
                  </span>
                </div>
                <button
                  v-if="detail.genres.length > 5"
                  class="text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
                  @click="toggleGenres"
                >
                  {{ genresExpanded ? 'Show less' : 'Show more' }}
                </button>
              </div>

              <!-- Collections -->
              <div v-if="detail.collections.length" class="border-t pt-4">
                <p class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Collections</p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="col in detail.collections"
                    :key="col.id"
                    class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                  >
                    <Folder class="size-2.5 shrink-0" />
                    {{ col.name }}
                  </span>
                </div>
              </div>

              <!-- Description -->
              <div class="border-t pt-4">
                <div v-if="detail.description">
                  <div
                    class="text-sm leading-relaxed text-foreground/80 transition-all"
                    :class="descriptionExpanded ? '' : 'line-clamp-4'"
                    v-html="detail.description"
                  />
                  <button
                    class="text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
                    @click="descriptionExpanded = !descriptionExpanded"
                  >
                    {{ descriptionExpanded ? 'Show less' : 'Show more' }}
                  </button>
                </div>
                <p v-else class="text-xs text-muted-foreground italic">No description available.</p>
              </div>
            </template>
          </div>

          <!-- Footer: actions -->
          <div class="p-4 border-t shrink-0 flex gap-2">
            <button
              class="flex flex-1 items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="!primaryFile"
              :aria-label="isPrimaryAudio ? 'Listen' : 'Read'"
              @click="openBook"
            >
              <Headphones v-if="isPrimaryAudio" class="size-4" />
              <BookOpen v-else class="size-4" />
              <span class="hidden sm:inline">{{ isPrimaryAudio ? 'Listen' : 'Read' }}</span>
            </button>
            <button
              class="flex flex-1 items-center justify-center text-primary-foreground gap-2 h-9 rounded-md bg-sky-600 text-sm font-medium hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600 transition-colors"
              aria-label="Details"
              @click="openDetails"
            >
              <ExternalLink class="size-4" />
              <span class="hidden sm:inline">Details</span>
            </button>
            <Tooltip v-if="hasPermission('library_edit_metadata')">
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
                  @click="editMetadata"
                >
                  <Pencil class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit metadata</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
                  @click="emit('action', 'add-to-collection')"
                >
                  <FolderPlus class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add to collection</TooltipContent>
            </Tooltip>
            <Tooltip v-if="hasPermission('library_delete_books')">
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center h-9 px-3 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  @click="emit('action', 'delete')"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- Cover lightbox -->
    <DialogRoot :open="coverLightboxOpen" @update:open="coverLightboxOpen = $event">
      <DialogPortal>
        <DialogOverlay
          class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogTitle class="sr-only">{{ detail?.title ? `${detail.title} cover preview` : 'Book cover preview' }}</DialogTitle>
          <DialogDescription class="sr-only">Enlarged cover image preview dialog.</DialogDescription>
          <img v-if="detail" :src="coverSrc!" :alt="detail.title ?? ''" class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain" />
          <DialogClose
            class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X class="size-4" />
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </TooltipProvider>
</template>
