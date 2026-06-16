<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FORMAT_TO_GROUP, type BookCard } from '@bookorbit/types'
import { Library } from 'lucide-vue-next'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverPlaceholder from './BookCoverPlaceholder.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { useCoverVersions } from '../composables/useCoverVersions'
import { useDisplaySettings, type GridCardLabelField } from '@/composables/useDisplaySettings'
import { fetchAuthors } from '@/features/author/api/author'

const MAX_COLLAPSED_STACK_COVERS = 3
const STACK_COVER_STEP_PCT = 8

const props = defineProps<{
  book: BookCard
  showLabel?: boolean
}>()

const route = useRoute()
const router = useRouter()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const { coverUrl } = useCoverVersions()
const { seriesCardCoverMode, gridCardPrimaryLabel, gridCardSecondaryLabel, cardInfoMode, cardOverlays } = useDisplaySettings()

const collapsed = computed(() => props.book.collapsedSeries!)
const seriesName = computed(() => props.book.seriesName ?? '')
const authorLine = computed(() => props.book.authors.join(', ') || null)
const authorQuery = computed(() => props.book.authors[0] ?? null)
const hoverTitleClampClass = computed(() => (coverAspectRatio.value === '1/1' ? 'line-clamp-1' : 'line-clamp-2'))
const showHoverText = computed(() => cardInfoMode.value === 'hover-overlay')
const overlayBackground = computed(() => (cardInfoMode.value === 'hover-overlay' ? 'bg-black/70' : 'bg-black/20'))
const showProgressBar = computed(() => cardOverlays.value.includes('progress-bar'))
const progressPercent = computed(() => {
  const { bookCount, readCount } = collapsed.value
  if (bookCount <= 0) return 0
  return Math.min(100, Math.max(0, (readCount / bookCount) * 100))
})

const isMosaic = computed(() => seriesCardCoverMode.value === 'mosaic')
const isStack = computed(() => seriesCardCoverMode.value === 'stack')

const allCoverIds = computed(() => collapsed.value.coverBookIds.filter((bookId) => bookId > 0))
const mosaicCoverIds = computed(() => allCoverIds.value.slice(0, 4))
const tileCount = computed(() => Math.max(mosaicCoverIds.value.length, 1))
const failedCovers = ref(new Set<number>())
const loadedCovers = ref(new Set<number>())
const activeStackCoverIds = computed(() => allCoverIds.value.filter((bookId) => !failedCovers.value.has(bookId)))
const stackCoverIds = computed(() => activeStackCoverIds.value.slice(0, MAX_COLLAPSED_STACK_COVERS))

const resolvedCoverId = computed<number | null>(() => {
  const c = collapsed.value
  const fallback = mosaicCoverIds.value[0] ?? null
  switch (seriesCardCoverMode.value) {
    case 'first-volume':
      return c.firstVolumeBookId ?? fallback
    case 'latest-volume':
      return c.latestVolumeBookId ?? fallback
    case 'first-unread':
      return c.firstUnreadBookId ?? c.firstVolumeBookId ?? fallback
    default:
      return null
  }
})

const singleCoverFailed = ref(false)
const singleCoverLoaded = ref(false)

watch(resolvedCoverId, () => {
  singleCoverFailed.value = false
  singleCoverLoaded.value = false
})
watch(
  allCoverIds,
  (ids) => {
    const activeIds = new Set(ids)
    failedCovers.value = new Set([...failedCovers.value].filter((id) => activeIds.has(id)))
    loadedCovers.value = new Set([...loadedCovers.value].filter((id) => activeIds.has(id)))
  },
  { immediate: true },
)
const primaryFile = computed(() => props.book.files.find((file) => file.role === 'primary') ?? props.book.files[0] ?? null)
const isAudiobook = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')

function handleCoverLoad(bookId: number) {
  loadedCovers.value = new Set([...loadedCovers.value, bookId])
}

function handleCoverError(bookId: number) {
  loadedCovers.value = new Set([...loadedCovers.value].filter((id) => id !== bookId))
  failedCovers.value = new Set([...failedCovers.value, bookId])
}

function handleSingleCoverLoad() {
  singleCoverLoaded.value = true
  singleCoverFailed.value = false
}

function handleSingleCoverError() {
  singleCoverLoaded.value = false
  singleCoverFailed.value = true
}

function handleClick() {
  openSeriesDetails()
}

function openSeriesDetails() {
  if (props.book.seriesId == null) return
  void router.push({ name: 'series-detail', params: { seriesId: props.book.seriesId }, query: { from: route.fullPath } })
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

function handleLabelClick(field: GridCardLabelField) {
  if (field === 'author') {
    void openAuthorDetails()
    return
  }
  openSeriesDetails()
}

function handlePrimaryLabelClick() {
  handleLabelClick(gridCardPrimaryLabel.value)
}

function handleSecondaryLabelClick() {
  handleLabelClick(gridCardSecondaryLabel.value)
}

function tileClass(index: number): string {
  if (tileCount.value <= 1) return 'col-span-2 row-span-2'
  if (tileCount.value === 2) return 'row-span-2'
  if (tileCount.value === 3 && index === 0) return 'row-span-2'
  return ''
}

const stackCoverStyles = computed(() =>
  stackCoverIds.value.map((_, index) => {
    const coverWidth = 100 - STACK_COVER_STEP_PCT * Math.max(0, stackCoverIds.value.length - 1)

    return {
      right: `${STACK_COVER_STEP_PCT * index}%`,
      bottom: `${STACK_COVER_STEP_PCT * index}%`,
      width: `${coverWidth}%`,
      aspectRatio: coverAspectRatio.value,
      zIndex: 100 - index,
      boxShadow:
        index === 0
          ? '0 18px 34px -20px rgba(15, 23, 42, 0.72), 0 8px 14px -12px rgba(15, 23, 42, 0.28)'
          : '0 14px 26px -20px rgba(15, 23, 42, 0.58), 0 6px 12px -12px rgba(15, 23, 42, 0.22)',
      transformOrigin: 'center',
      transform: 'translateY(0) scale(1)',
      transition: 'transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 220ms ease',
      willChange: 'transform',
    }
  }),
)

function resolveSeriesLabel(field: GridCardLabelField): string | null {
  if (field === 'hidden') return null
  if (field === 'author') return authorLine.value?.trim() || null
  return seriesName.value?.trim() || null
}

const primaryLabelText = computed(() => resolveSeriesLabel(gridCardPrimaryLabel.value))
const secondaryLabelText = computed(() => resolveSeriesLabel(gridCardSecondaryLabel.value))
</script>

<template>
  <div class="flex flex-col @container cursor-pointer" @click="handleClick">
    <!-- Cover -->
    <div class="group">
      <BookCoverSurface
        class="relative w-full rounded-sm overflow-hidden transition-[box-shadow,transform] duration-150 will-change-transform group-hover:scale-[1.02]"
        :class="isStack ? 'book-cover-surface--spine-fitted' : ''"
        interactive
        :disable-spine="isAudiobook"
        :is-comic="isComic"
        :style="{ aspectRatio: coverAspectRatio, ...(isStack ? { backgroundColor: 'transparent', boxShadow: 'none' } : {}) }"
      >
        <div v-if="isStack" class="absolute inset-0 isolate overflow-hidden" data-testid="series-cover-stack">
          <div class="absolute inset-x-[12%] bottom-[5%] h-5 rounded-full bg-black/12 blur-2xl opacity-45" />
          <div
            v-for="(bookId, i) in stackCoverIds"
            :key="bookId"
            class="absolute overflow-hidden rounded-md"
            :style="stackCoverStyles[i] ?? {}"
            data-testid="series-stack-cover"
          >
            <BookCoverArtwork
              :src="coverUrl(bookId)"
              :has-cover="true"
              :title="seriesName"
              :author-line="authorLine"
              :seed="`series-${bookId}`"
              alt=""
              loading="lazy"
              decoding="async"
              :spine="!isAudiobook"
              :is-comic="isComic"
              @error="() => handleCoverError(bookId)"
            />

            <template v-if="i === 0">
              <div
                class="absolute right-1.5 top-1.5 z-20 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white group-hover:opacity-0 transition-opacity duration-150"
                data-testid="series-count-badge"
              >
                {{ collapsed.bookCount }}
              </div>
            </template>
          </div>
          <div
            v-if="stackCoverIds.length === 0"
            class="absolute inset-x-[24%] bottom-[6%] top-[6%] overflow-hidden rounded-md shadow-[0_12px_28px_-18px_rgba(15,23,42,0.7)]"
            data-testid="series-cover-stack-fallback"
          >
            <BookCoverPlaceholder title="" author-line="" :is-audio="false" seed="series-empty" />
          </div>
        </div>

        <!-- Single cover mode -->
        <div v-else-if="!isMosaic && resolvedCoverId != null" class="absolute inset-0" data-testid="series-single-cover">
          <div
            class="absolute inset-0 transition-opacity duration-200 ease-out"
            :class="singleCoverLoaded && !singleCoverFailed ? 'opacity-0 pointer-events-none' : 'opacity-100'"
            aria-hidden="true"
          >
            <BookCoverPlaceholder title="" author-line="" :is-audio="false" :seed="`series-${resolvedCoverId}`" />
          </div>
          <img
            v-if="!singleCoverFailed"
            :src="coverUrl(resolvedCoverId)"
            class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out"
            :class="singleCoverLoaded ? 'opacity-100' : 'opacity-0'"
            loading="lazy"
            alt=""
            @load="handleSingleCoverLoad"
            @error="handleSingleCoverError"
          />
          <span v-if="!singleCoverLoaded && !singleCoverFailed" class="absolute inset-0 z-[1] animate-pulse bg-foreground/5" />
        </div>

        <!-- Adaptive cover mosaic -->
        <div v-else class="absolute inset-0 grid grid-cols-2 grid-rows-2">
          <template v-for="(bookId, i) in mosaicCoverIds" :key="bookId">
            <div class="relative overflow-hidden" :class="tileClass(i)" data-testid="series-cover-tile">
              <div
                class="absolute inset-0 transition-opacity duration-200 ease-out"
                :class="loadedCovers.has(bookId) && !failedCovers.has(bookId) ? 'opacity-0 pointer-events-none' : 'opacity-100'"
                aria-hidden="true"
              >
                <BookCoverPlaceholder title="" author-line="" :is-audio="false" :seed="`series-${bookId}`" />
              </div>
              <img
                v-if="!failedCovers.has(bookId)"
                :src="coverUrl(bookId)"
                class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out"
                :class="loadedCovers.has(bookId) ? 'opacity-100' : 'opacity-0'"
                loading="lazy"
                alt=""
                @load="() => handleCoverLoad(bookId)"
                @error="() => handleCoverError(bookId)"
              />
              <span v-if="!loadedCovers.has(bookId) && !failedCovers.has(bookId)" class="absolute inset-0 z-[1] animate-pulse bg-foreground/5" />
            </div>
          </template>
          <div v-if="mosaicCoverIds.length === 0" class="relative overflow-hidden" :class="tileClass(0)" data-testid="series-cover-fallback">
            <BookCoverPlaceholder title="" author-line="" :is-audio="false" seed="series-empty" />
          </div>
        </div>

        <!-- Count badge -->
        <div
          v-if="!isStack"
          class="absolute right-1.5 top-1.5 z-10 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white group-hover:opacity-0 transition-opacity duration-150"
          data-testid="series-count-badge"
        >
          {{ collapsed.bookCount }}
        </div>

        <!-- Series type badge -->
        <div
          v-if="!isStack"
          class="absolute bottom-1.5 left-1.5 z-10 rounded-sm bg-black/70 p-1 text-white group-hover:opacity-0 transition-opacity duration-150"
          data-testid="series-type-badge"
        >
          <Library :size="10" />
        </div>

        <!-- Hover overlay -->
        <div
          v-if="!isStack"
          class="absolute inset-0 flex flex-col p-2 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-active:pointer-events-auto"
          :class="overlayBackground"
        >
          <div class="flex-1 flex items-center justify-center">
            <button
              class="size-[30cqi] flex items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-all duration-300 scale-75 group-hover:scale-100"
              data-testid="series-hover-action"
              @click.stop="handleClick"
            >
              <Library class="size-[16cqi]" />
            </button>
          </div>
          <div v-if="showHoverText" class="shrink-0 flex flex-col">
            <p class="text-xs font-semibold text-white leading-tight" :class="hoverTitleClampClass">
              {{ seriesName }}
            </p>
            <p v-if="authorLine" class="text-[10px] text-white/70 truncate mt-0.5">
              {{ authorLine }}
            </p>
          </div>
        </div>

        <!-- Read progress bar -->
        <div v-if="!isStack && showProgressBar" class="absolute bottom-0 left-0 right-0 h-[3px] z-20 bg-white/20" data-testid="series-progress-bar">
          <div class="h-full bg-primary" :style="{ width: `${progressPercent}%` }" data-testid="series-progress-fill" />
        </div>
      </BookCoverSurface>
    </div>

    <div v-if="props.showLabel && cardInfoMode === 'below-cover' && (primaryLabelText || secondaryLabelText)" class="grid-card-label">
      <button
        v-if="primaryLabelText"
        type="button"
        class="grid-card-label__primary"
        data-testid="grid-card-label-primary"
        @click.stop="handlePrimaryLabelClick"
      >
        {{ primaryLabelText }}
      </button>
      <button
        v-if="secondaryLabelText"
        type="button"
        class="grid-card-label__secondary"
        data-testid="grid-card-label-secondary"
        @click.stop="handleSecondaryLabelClick"
      >
        {{ secondaryLabelText }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.grid-card-label {
  padding-top: 4px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.grid-card-label__primary {
  font-size: 0.75rem;
  line-height: 1.25rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--foreground);
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 0;
  width: 100%;
}

.grid-card-label__primary:hover {
  text-decoration: underline;
}

.grid-card-label__secondary {
  font-size: 0.675rem;
  line-height: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted-foreground);
  margin-top: 2px;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 0;
  width: 100%;
}

.grid-card-label__secondary:hover {
  text-decoration: underline;
}
</style>
