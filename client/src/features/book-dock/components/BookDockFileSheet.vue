<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { X, BookOpen, Check, Trash2, Sparkles, ArrowLeft, Wand2, AlertCircle } from '@lucide/vue'
import type { BookDockFile, BookDockMetadata, MetadataCandidate, MetadataSource, MetadataProviderKey } from '@bookorbit/types'
import BookDockStatusBadge from './BookDockStatusBadge.vue'
import MetadataSearchPanel from '@/features/book/components/detail/tabs/MetadataSearchPanel.vue'
import MetadataDiffPanel from '@/features/book/components/detail/tabs/MetadataDiffPanel.vue'
import { useBookDockDetail } from '../composables/useBookDockDetail'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useMetadataSearch } from '@/features/book/composables/useMetadataSearch'
import type { MetadataPatch } from '@/features/book/composables/useMetadataDiff'
import { formatBytes } from '@/lib/formatting'
import { toDisplayCoverUrl } from '@/features/book/lib/metadata-fetch'

const props = defineProps<{ file: BookDockFile }>()

const emit = defineEmits<{
  close: []
  discarded: []
  updated: [BookDockFile]
}>()

const { saved, saveError, saveMetadata, setTarget, discardFile, coverUrl } = useBookDockDetail()
const { libraries, fetchLibraries: fetchLibs } = useLibraries()

const meta = computed(() => props.file.selectedMetadata ?? props.file.embeddedMetadata ?? ({} as BookDockMetadata))

const metaView = ref<'editor' | 'search' | 'diff'>('editor')
const selectedCandidate = ref<MetadataCandidate | null>(null)
const diffSource = ref<'search' | 'fetched'>('search')

const sheetWidthClass = computed(() => (metaView.value === 'editor' ? 'sm:w-md lg:w-lg' : 'sm:w-3/4 sm:max-w-4xl'))

const targetLibraryId = ref<number | null>(null)
const targetFolderId = ref<number | null>(null)

const selectedLibrary = computed(() => libraries.value.find((l) => l.id === targetLibraryId.value))
const folders = computed(() => selectedLibrary.value?.folders ?? [])

const form = reactive({
  title: '',
  subtitle: '',
  authors: '',
  description: '',
  publisher: '',
  publishedYear: '',
  language: '',
  isbn13: '',
  isbn10: '',
  seriesName: '',
  seriesIndex: '',
  genres: '',
})
const selectedCoverUrl = ref('')

watch(
  () => props.file.id,
  () => {
    const m = meta.value
    form.title = m.title ?? ''
    form.subtitle = m.subtitle ?? ''
    form.authors = m.authors?.join(', ') ?? ''
    form.description = m.description ?? ''
    form.publisher = m.publisher ?? ''
    form.publishedYear = m.publishedYear != null ? String(m.publishedYear) : ''
    form.language = m.language ?? ''
    form.isbn13 = m.isbn13 ?? ''
    form.isbn10 = m.isbn10 ?? ''
    form.seriesName = m.seriesName ?? ''
    form.seriesIndex = m.seriesIndex != null ? String(m.seriesIndex) : ''
    form.genres = m.genres?.join(', ') ?? ''
    selectedCoverUrl.value = m.coverUrl ?? ''
    metaView.value = 'editor'

    targetLibraryId.value = props.file.targetLibraryId ?? libraries.value[0]?.id ?? null
    const lib = libraries.value.find((l) => l.id === targetLibraryId.value)
    targetFolderId.value = props.file.targetFolderId ?? lib?.folders?.[0]?.id ?? null
  },
  { immediate: true },
)

watch(
  () => libraries.value,
  (libs) => {
    if (!libs.length) return
    if (targetLibraryId.value === null) {
      targetLibraryId.value = props.file.targetLibraryId ?? libs[0]?.id ?? null
    }
    if (targetFolderId.value === null) {
      const lib = libs.find((l) => l.id === targetLibraryId.value)
      targetFolderId.value = props.file.targetFolderId ?? lib?.folders?.[0]?.id ?? null
    }
  },
)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function buildMetadataPatchFromForm(): Partial<BookDockMetadata> {
  return {
    title: form.title || undefined,
    subtitle: form.subtitle || undefined,
    authors: form.authors
      ? form.authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : undefined,
    description: form.description || undefined,
    publisher: form.publisher || undefined,
    publishedYear: form.publishedYear ? ((n) => (isNaN(n) ? undefined : n))(parseInt(form.publishedYear, 10)) : undefined,
    language: form.language || undefined,
    isbn13: form.isbn13 || undefined,
    isbn10: form.isbn10 || undefined,
    seriesName: form.seriesName || undefined,
    seriesIndex: form.seriesIndex ? ((n) => (isNaN(n) ? undefined : n))(parseFloat(form.seriesIndex)) : undefined,
    genres: form.genres
      ? form.genres
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      : undefined,
    coverUrl: selectedCoverUrl.value || undefined,
  }
}

function onFieldChange() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const updated = await saveMetadata(props.file.id, buildMetadataPatchFromForm())
    if (updated) emit('updated', updated)
  }, 1000)
}

async function onLibraryChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  const id = Number.isFinite(raw) && raw > 0 ? raw : null
  targetLibraryId.value = id
  const lib = libraries.value.find((l) => l.id === targetLibraryId.value)
  targetFolderId.value = lib?.folders?.[0]?.id ?? null
  const updated = await setTarget(props.file.id, targetLibraryId.value, targetFolderId.value)
  if (updated) emit('updated', updated)
}

async function onFolderChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  targetFolderId.value = Number.isFinite(raw) && raw > 0 ? raw : null
  const updated = await setTarget(props.file.id, targetLibraryId.value, targetFolderId.value)
  if (updated) emit('updated', updated)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

async function handleDiscard() {
  await discardFile(props.file.id)
  emit('discarded')
}

const {
  filteredResults,
  providerCounts,
  isStreaming,
  hasSearched,
  providers,
  selectedProviders,
  loadProviders,
  search,
  toggleProvider,
  selectFieldRuleProviders,
  clearProviderFilter,
} = useMetadataSearch()

const searchDefaults = computed(() => ({
  title: form.title || undefined,
  author: form.authors?.split(',')[0]?.trim() || undefined,
  isbn: form.isbn13 || form.isbn10 || undefined,
}))

const currentSource = computed<MetadataSource>(() => ({
  title: form.title || null,
  subtitle: form.subtitle || null,
  description: form.description || null,
  publisher: form.publisher || null,
  publishedYear: form.publishedYear ? ((n) => (isNaN(n) ? null : n))(parseInt(form.publishedYear, 10)) : null,
  language: form.language || null,
  pageCount: null,
  seriesName: form.seriesName || null,
  seriesIndex: form.seriesIndex ? ((n) => (isNaN(n) ? null : n))(parseFloat(form.seriesIndex)) : null,
  isbn10: form.isbn10 || null,
  isbn13: form.isbn13 || null,
  authors: form.authors
    ? form.authors
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : [],
  genres: form.genres
    ? form.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
    : [],
  narrators: [],
  durationSeconds: null,
  abridged: null,
  hardcoverEditionId: null,
  communityRatings: [],
}))

function openSearch() {
  metaView.value = 'search'
  loadProviders()
}

function handleSearchSubmit(params: { title: string; author: string; isbn: string }) {
  search(params)
}

function selectCandidate(candidate: MetadataCandidate) {
  selectedCandidate.value = candidate
  diffSource.value = 'search'
  metaView.value = 'diff'
}

function backFromDiff() {
  if (diffSource.value === 'fetched') {
    metaView.value = 'editor'
  } else {
    metaView.value = 'search'
  }
  selectedCandidate.value = null
}

async function handleApply(patch: { formPatch: MetadataPatch; coverUrl?: string }) {
  const p = patch.formPatch
  if ('title' in p) form.title = p.title ?? ''
  if ('subtitle' in p) form.subtitle = p.subtitle ?? ''
  if ('description' in p) form.description = p.description ?? ''
  if ('publisher' in p) form.publisher = p.publisher ?? ''
  if ('publishedYear' in p) form.publishedYear = p.publishedYear == null ? '' : String(p.publishedYear)
  if ('language' in p) form.language = p.language ?? ''
  if ('isbn13' in p) form.isbn13 = p.isbn13 ?? ''
  if ('isbn10' in p) form.isbn10 = p.isbn10 ?? ''
  if ('seriesName' in p) form.seriesName = p.seriesName ?? ''
  if ('seriesIndex' in p) form.seriesIndex = p.seriesIndex == null ? '' : String(p.seriesIndex)
  if ('authors' in p) form.authors = (p.authors ?? []).join(', ')
  if ('genres' in p) form.genres = (p.genres ?? []).join(', ')

  if (patch.coverUrl !== undefined) {
    selectedCoverUrl.value = patch.coverUrl
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const updated = await saveMetadata(props.file.id, buildMetadataPatchFromForm())
  if (updated) emit('updated', updated)

  metaView.value = 'editor'
  selectedCandidate.value = null
}

const hasFetchedMetadata = computed(() => {
  const f = props.file.fetchedMetadata
  if (!f) return false
  return Object.values(f).some((v) => v !== undefined && v !== null && v !== '')
})

const backendBookDockCoverUrl = computed(() => `${coverUrl(props.file.id)}?v=${new Date(props.file.updatedAt).getTime()}`)
const displaySelectedCoverUrl = computed(() => toDisplayCoverUrl(selectedCoverUrl.value))
const currentBookDockCoverUrl = computed(() => displaySelectedCoverUrl.value || backendBookDockCoverUrl.value)
const currentBookDockCoverFallbackUrl = computed(() => (displaySelectedCoverUrl.value ? backendBookDockCoverUrl.value : null))

function onCurrentBookDockCoverError(event: Event) {
  const img = event.target as HTMLImageElement
  const fallback = currentBookDockCoverFallbackUrl.value
  if (!fallback) {
    img.style.display = 'none'
    return
  }

  const resolvedFallback = new URL(fallback, window.location.origin).href
  const currentSrc = img.currentSrc || img.src
  if (currentSrc !== resolvedFallback) {
    img.src = fallback
    return
  }

  img.style.display = 'none'
}

function openFetchedDiff() {
  const f = props.file.fetchedMetadata
  if (!f) return
  selectedCandidate.value = {
    provider: 'auto' as MetadataProviderKey,
    providerId: '',
    title: f.title ?? '',
    subtitle: f.subtitle,
    authors: f.authors,
    description: f.description,
    publisher: f.publisher,
    publishedYear: f.publishedYear,
    language: f.language,
    pageCount: f.pageCount,
    isbn10: f.isbn10,
    isbn13: f.isbn13,
    seriesName: f.seriesName,
    seriesIndex: f.seriesIndex,
    genres: f.genres,
    coverUrl: f.coverUrl,
  }
  diffSource.value = 'fetched'
  metaView.value = 'diff'
}

onMounted(() => {
  fetchLibs()
  loadProviders()
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex">
    <div class="hidden sm:block flex-1 bg-black/50 backdrop-blur-sm" @click="$emit('close')" />

    <div
      class="relative flex flex-col w-full h-full bg-background sm:border-l border-border shadow-2xl overflow-hidden transition-[width,max-width] duration-300"
      :class="sheetWidthClass"
    >
      <div class="h-px w-full bg-linear-to-r from-transparent via-primary to-transparent shrink-0 opacity-60" />

      <button
        class="absolute top-3 right-3 z-10 size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        @click="$emit('close')"
      >
        <X class="size-4" />
      </button>

      <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 pr-12">
        <div class="relative size-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          <img
            :src="currentBookDockCoverUrl"
            alt=""
            class="size-full object-cover"
            @load="($event.target as HTMLImageElement).style.display = ''"
            @error="onCurrentBookDockCoverError"
          />
          <BookOpen class="size-5 text-muted-foreground absolute" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">{{ file.fileName }}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <BookDockStatusBadge :status="file.status" />
            <span class="text-xs text-muted-foreground uppercase">{{ file.format }}</span>
            <span class="text-xs text-muted-foreground">{{ formatBytes(file.fileSize) }}</span>
          </div>
        </div>
        <div v-if="saved" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <Check class="size-3.5" />
          Saved
        </div>
      </div>

      <!-- Metadata editor view -->
      <template v-if="metaView === 'editor'">
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p v-if="file.errorMessage" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ file.errorMessage }}</p>

          <div v-if="saveError" class="flex items-center gap-2 p-2.5 rounded-lg border border-red-500/30 bg-red-500/5">
            <AlertCircle class="size-3.5 text-red-500 shrink-0" />
            <p class="flex-1 text-xs text-red-600 dark:text-red-400">{{ saveError }}</p>
            <button class="shrink-0 text-red-400 hover:text-red-600 transition-colors" @click="saveError = null">
              <X class="size-3.5" />
            </button>
          </div>

          <div v-if="hasFetchedMetadata" class="flex items-center gap-2.5 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <Wand2 class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p class="flex-1 text-sm text-amber-700 dark:text-amber-300">
              {{ file.metadataEditedAt ? 'Provider metadata found - bulk apply will skip this file (you have edits)' : 'Provider metadata found' }}
            </p>
            <button
              class="shrink-0 flex items-center gap-1.5 h-7 px-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-all active:scale-95"
              @click="openFetchedDiff"
            >
              Review
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">Title</span>
              <input
                v-model="form.title"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">Subtitle</span>
              <input
                v-model="form.subtitle"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">Authors (comma-separated)</span>
              <input
                v-model="form.authors"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">Publisher</span>
              <input
                v-model="form.publisher"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">Year</span>
              <input
                v-model="form.publishedYear"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">Language</span>
              <input
                v-model="form.language"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">ISBN-13</span>
              <input
                v-model="form.isbn13"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">ISBN-10</span>
              <input
                v-model="form.isbn10"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">Series</span>
              <input
                v-model="form.seriesName"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">Series #</span>
              <input
                v-model="form.seriesIndex"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">Genres (comma-separated)</span>
              <input
                v-model="form.genres"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">Description</span>
              <textarea
                v-model="form.description"
                rows="3"
                class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                @input="onFieldChange"
              />
            </label>
          </div>

          <div class="space-y-3 pt-1">
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Destination Library</span>
              <select
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="targetLibraryId ?? ''"
                @change="onLibraryChange"
              >
                <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Destination Folder</span>
              <select
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="targetFolderId ?? ''"
                @change="onFolderChange"
              >
                <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
              </select>
            </label>
          </div>

          <p class="text-xs text-muted-foreground">Added {{ formatDate(file.createdAt) }}</p>
        </div>

        <div class="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
            @click="handleDiscard"
          >
            <Trash2 class="size-3.5" />
            Discard
          </button>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-primary-foreground text-sm font-medium transition-all active:scale-95"
              style="
                background: linear-gradient(to right, var(--primary), color-mix(in oklch, var(--primary) 65%, oklch(0.7 0.25 280)));
                box-shadow: 0 2px 10px color-mix(in oklch, var(--primary) 45%, transparent);
              "
              @click="openSearch"
            >
              <Sparkles class="size-3.5" />
              Search
            </button>
            <button
              class="relative h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              @click="$emit('close')"
            >
              Done
            </button>
          </div>
        </div>
      </template>

      <!-- Metadata search view -->
      <template v-else-if="metaView === 'search'">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <button
            class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            @click="metaView = 'editor'"
          >
            <ArrowLeft class="size-4" />
          </button>
          <Sparkles class="size-3.5 text-primary" />
          <span class="text-sm font-medium">Search Metadata</span>
        </div>
        <div class="flex-1 min-h-0">
          <MetadataSearchPanel
            :search-defaults="searchDefaults"
            :providers="providers"
            :filtered-results="filteredResults"
            :provider-counts="providerCounts"
            :selected-providers="selectedProviders"
            :is-streaming="isStreaming"
            :has-searched="hasSearched"
            @search="handleSearchSubmit"
            @toggle-provider="toggleProvider"
            @clear-filter="clearProviderFilter"
            @select-field-rules="selectFieldRuleProviders"
            @select="selectCandidate"
          />
        </div>
      </template>

      <!-- Metadata diff view -->
      <template v-else-if="metaView === 'diff' && selectedCandidate">
        <div class="flex-1 min-h-0">
          <MetadataDiffPanel
            :current="currentSource"
            :candidates="diffSource === 'fetched' ? [selectedCandidate] : filteredResults"
            :initial-candidate="selectedCandidate"
            :filtered-results="diffSource === 'fetched' ? [selectedCandidate] : filteredResults"
            :providers="providers"
            :back-label="diffSource === 'fetched' ? 'Back' : 'Results'"
            :current-cover-url="currentBookDockCoverUrl"
            :provider-ids="(file.fetchedMetadataSources as any) ?? undefined"
            @back="backFromDiff"
            @apply="handleApply"
          />
        </div>
      </template>
    </div>
  </div>
</template>
