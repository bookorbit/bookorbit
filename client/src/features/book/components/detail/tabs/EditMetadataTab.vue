<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronDown, HardDriveUpload, Loader2, Lock, LockOpen, RefreshCw, Sparkles, Star, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BookDetail, BookMetadataLockField } from '@projectx/types'
import { FORMAT_TO_GROUP } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ChipInput from '@/components/ui/ChipInput.vue'
import CoverEditorPanel from './CoverEditorPanel.vue'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'
import MetadataFieldLabel from './MetadataFieldLabel.vue'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import { useMetadataEditor } from '../../../composables/useMetadataEditor'
import { type MetadataRefreshPreview, useRefreshMetadata } from '../../../composables/useRefreshMetadata'
import { type FileMetadata, useFileMetadata } from '../../../composables/useFileMetadata'
import { useMetadataLocks } from '../../../composables/useMetadataLocks'
import { useAuthorSearch } from '../../../composables/useAuthorSearch'
import { useNarratorSearch } from '../../../composables/useNarratorSearch'
import { useGenreSearch, useTagSearch } from '../../../composables/useTagSearch'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{
  saved: [BookDetail]
  locksChanged: [BookMetadataLockField[]]
  coverChanged: ['extracted' | 'custom' | null]
}>()

const DIRECT_PATCH_FIELDS = [
  'title',
  'subtitle',
  'description',
  'authors',
  'genres',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'isbn10',
  'isbn13',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'comicvineId',
] as const

const COMIC_FIELD_MAP = {
  issueNumber: 'comicIssueNumber',
  volumeName: 'comicVolumeName',
  storyArcs: 'comicStoryArcs',
  pencillers: 'comicPencillers',
  inkers: 'comicInkers',
  colorists: 'comicColorists',
  letterers: 'comicLetterers',
  coverArtists: 'comicCoverArtists',
  characters: 'comicCharacters',
  teams: 'comicTeams',
  locations: 'comicLocations',
} as const

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isPrimaryComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')
const comicSectionOpen = ref(true)

const { form, saving, error, isDirty, load, reset, save } = useMetadataEditor()
const {
  lockedFields,
  updating: updatingLocks,
  error: lockError,
  areAllLocked,
  load: loadLocks,
  isLocked,
  isUpdating: isUpdatingLock,
  toggle,
  lockAll,
  unlockAll,
} = useMetadataLocks()
const { search: searchAuthors } = useAuthorSearch()
const { search: searchNarrators } = useNarratorSearch()
const { search: searchGenres } = useGenreSearch()
const { search: searchTags } = useTagSearch()
const searchComicMetadata = async (q: string): Promise<string[]> => (q.trim() ? [] : [])

const coverPanel = ref<InstanceType<typeof CoverEditorPanel> | null>(null)
const searchOpen = ref(false)
const providerIdsOpen = ref(true)

const providerIdFields = [
  { field: 'googleBooksId' as const, label: 'Google Books' },
  { field: 'goodreadsId' as const, label: 'Goodreads' },
  { field: 'amazonId' as const, label: 'Amazon' },
  { field: 'hardcoverId' as const, label: 'Hardcover' },
  { field: 'openLibraryId' as const, label: 'OpenLibrary' },
  { field: 'itunesId' as const, label: 'iTunes' },
  { field: 'audibleId' as const, label: 'Audible' },
  { field: 'comicvineId' as const, label: 'ComicVine' },
]

function setIntField(field: 'publishedYear' | 'pageCount' | 'durationSeconds', e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') {
    form[field] = null
    return
  }
  const n = parseInt(val, 10)
  form[field] = isNaN(n) ? null : n
}

function setFloatField(field: 'seriesIndex', e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') {
    form[field] = null
    return
  }
  const n = parseFloat(val)
  form[field] = isNaN(n) ? null : n
}

watch(
  () => props.book,
  (book) => {
    load(book)
    loadLocks(book)
  },
  { immediate: true },
)

const combinedError = computed(() => lockError.value ?? error.value)
const hasLockedFields = computed(() => lockedFields.value.length > 0)

async function submit() {
  if (coverPanel.value?.hasPending) {
    const ok = await coverPanel.value.confirm()
    if (ok) emit('coverChanged', 'custom')
  }
  const updated = await save(props.book.id)
  if (updated) emit('saved', updated)
}

const hoverRating = ref<number | null>(null)
const displayRating = computed(() => hoverRating.value ?? form.rating)

function setRating(star: number) {
  form.rating = form.rating === star ? null : star
}

function clearRating() {
  form.rating = null
}

function toggleComicSection() {
  comicSectionOpen.value = !comicSectionOpen.value
}

function trackLockedField(field: BookMetadataLockField, skippedFields: BookMetadataLockField[]) {
  if (!skippedFields.includes(field)) {
    skippedFields.push(field)
  }
}

function applyDirectPatchField(field: (typeof DIRECT_PATCH_FIELDS)[number], value: unknown, skippedFields: BookMetadataLockField[]): boolean {
  if (value === undefined) return false
  if (isLocked(field)) {
    trackLockedField(field, skippedFields)
    return false
  }
  form[field] = value as never
  return true
}

function applyComicPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  if (!formPatch.comicMetadata) return 0
  let updated = 0
  for (const [comicKey, formKey] of Object.entries(COMIC_FIELD_MAP) as [
    keyof typeof COMIC_FIELD_MAP,
    (typeof COMIC_FIELD_MAP)[keyof typeof COMIC_FIELD_MAP],
  ][]) {
    const value = formPatch.comicMetadata[comicKey]
    if (value === undefined) continue
    if (isLocked(formKey)) {
      trackLockedField(formKey, skippedFields)
      continue
    }
    form[formKey] = value as never
    updated++
  }
  return updated
}

function applyAudioPatch(formPatch: MetadataPatch, skippedFields: BookMetadataLockField[]): number {
  let updated = 0
  if (formPatch.narrators !== undefined) {
    if (isLocked('narrators')) {
      trackLockedField('narrators', skippedFields)
    } else {
      form.narrators = formPatch.narrators
      updated++
    }
  }
  if (formPatch.durationSeconds !== undefined) {
    if (isLocked('durationSeconds')) {
      trackLockedField('durationSeconds', skippedFields)
    } else {
      form.durationSeconds = formPatch.durationSeconds
      updated++
    }
  }
  if (formPatch.abridged !== undefined) {
    if (isLocked('abridged')) {
      trackLockedField('abridged', skippedFields)
    } else {
      form.abridged = formPatch.abridged
      updated++
    }
  }
  return updated
}

function applyPatchToForm(formPatch: MetadataPatch, coverUrl: string | undefined): { skippedFields: BookMetadataLockField[]; updatedCount: number } {
  const skippedFields: BookMetadataLockField[] = []
  let updatedCount = 0
  for (const field of DIRECT_PATCH_FIELDS) {
    if (applyDirectPatchField(field, formPatch[field], skippedFields)) updatedCount++
  }
  updatedCount += applyComicPatch(formPatch, skippedFields)
  updatedCount += applyAudioPatch(formPatch, skippedFields)

  if (coverUrl) {
    if (isLocked('cover')) {
      trackLockedField('cover', skippedFields)
    } else {
      coverPanel.value?.setUrl(coverUrl)
      updatedCount++
    }
  }

  return { skippedFields, updatedCount }
}

function showApplyResult(skippedFields: BookMetadataLockField[], updatedCount: number) {
  if (skippedFields.length === 0) return
  const skippedPart = `Skipped ${skippedFields.length} locked field${skippedFields.length === 1 ? '' : 's'}`
  const updatedPart = `updated ${updatedCount} field${updatedCount === 1 ? '' : 's'}`
  toast.info(`${skippedPart}, ${updatedPart}`)
}

function handleApply({ formPatch, coverUrl }: { formPatch: MetadataPatch; coverUrl?: string }) {
  const { skippedFields, updatedCount } = applyPatchToForm(formPatch, coverUrl)
  showApplyResult(skippedFields, updatedCount)
}

const { refreshing: autoFilling, previewRefresh } = useRefreshMetadata()
const { loading: loadingFromFile, loadFromFile } = useFileMetadata()

function buildPreviewPatch(preview: MetadataRefreshPreview): MetadataPatch {
  return {
    title: preview.title,
    subtitle: preview.subtitle,
    description: preview.description,
    authors: preview.authors,
    genres: preview.genres,
    publisher: preview.publisher,
    publishedYear: preview.publishedYear,
    language: preview.language,
    pageCount: preview.pageCount,
    seriesName: preview.seriesName,
    seriesIndex: preview.seriesIndex,
    googleBooksId: preview.googleBooksId,
    goodreadsId: preview.goodreadsId,
    amazonId: preview.amazonId,
    hardcoverId: preview.hardcoverId,
    openLibraryId: preview.openLibraryId,
    itunesId: preview.itunesId,
    audibleId: preview.audibleId,
    comicvineId: preview.comicvineId,
    comicMetadata: preview.comicMetadata,
    narrators: preview.audioMetadata?.narrators,
    durationSeconds: preview.audioMetadata?.durationSeconds ?? undefined,
    abridged: preview.audioMetadata?.abridged ?? undefined,
  }
}

async function autoFill() {
  const preview = await previewRefresh(props.book.id)
  if (!preview) return

  if (Object.keys(preview).length === 0) {
    toast.info('No new metadata found')
    return
  }

  const { skippedFields, updatedCount } = applyPatchToForm(buildPreviewPatch(preview), preview.coverUrl)
  showApplyResult(skippedFields, updatedCount)
}

function applyFileMetadataToForm(meta: FileMetadata): number {
  let count = 0
  const directFields = [
    'title',
    'subtitle',
    'description',
    'publisher',
    'publishedYear',
    'language',
    'pageCount',
    'seriesName',
    'seriesIndex',
    'isbn10',
    'isbn13',
    'authors',
    'genres',
  ] as const
  for (const field of directFields) {
    if (meta[field] !== undefined) {
      form[field] = meta[field] as never
      count++
    }
  }
  if (meta.comicMetadata) {
    for (const [comicKey, formKey] of Object.entries(COMIC_FIELD_MAP) as [
      keyof typeof COMIC_FIELD_MAP,
      (typeof COMIC_FIELD_MAP)[keyof typeof COMIC_FIELD_MAP],
    ][]) {
      const value = meta.comicMetadata[comicKey]
      if (value !== undefined) {
        form[formKey] = value as never
        count++
      }
    }
  }
  return count
}

async function handleLoadFromFile() {
  const meta = await loadFromFile(props.book.id)
  if (!meta) {
    toast.error('Failed to load metadata from file')
    return
  }
  const count = applyFileMetadataToForm(meta)
  toast.info(count > 0 ? `Loaded ${count} field${count === 1 ? '' : 's'} from file` : 'No metadata found in file')
}

async function handleLockToggle(field: BookMetadataLockField) {
  const updated = await toggle(props.book.id, field)
  if (updated) emit('locksChanged', updated.lockedFields)
}

function handleCoverLockToggle() {
  handleLockToggle('cover')
}

async function handleLockAll() {
  const updated = await lockAll(props.book.id)
  if (updated) emit('locksChanged', updated.lockedFields)
}

async function handleUnlockAll() {
  const updated = await unlockAll(props.book.id)
  if (updated) emit('locksChanged', updated.lockedFields)
}

function handleCoverChanged(source: 'extracted' | 'custom' | null) {
  emit('coverChanged', source)
}
</script>

<template>
  <div class="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start">
    <!-- Left: Cover panel -->
    <div class="w-full pb-3 border-b border-border lg:border-b-0 lg:pb-0 lg:w-48 lg:shrink-0 lg:sticky lg:top-6">
      <CoverEditorPanel
        ref="coverPanel"
        :book="props.book"
        :locked="isLocked('cover')"
        @cover-changed="handleCoverChanged"
        @toggle-lock="handleCoverLockToggle"
      />
    </div>

    <!-- Right: Form -->
    <div class="flex-1 min-w-0 space-y-2.5 sm:space-y-3.5">
      <!-- Action bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-h-8">
        <p v-if="combinedError" class="text-sm text-destructive">{{ combinedError }}</p>
        <span v-else class="hidden sm:inline" />
        <div class="flex items-center justify-center sm:justify-start gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 py-0.5">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="loadingFromFile || !primaryFile"
                @click="handleLoadFromFile"
              >
                <Loader2 v-if="loadingFromFile" class="size-3.5 animate-spin" />
                <HardDriveUpload v-else class="size-3.5" />
                <span class="hidden sm:inline">Load from file</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{
              loadingFromFile ? 'Loading...' : !primaryFile ? 'No primary file available' : 'Load metadata from the primary book file'
            }}</TooltipContent>
          </Tooltip>

          <div class="flex-none w-px h-4 bg-border mx-0.5" />

          <button
            class="flex-none search-online-btn flex items-center gap-1.5 h-8 px-3 sm:px-3.5 rounded-lg text-primary-foreground text-sm font-medium transition-all"
            @click="searchOpen = true"
          >
            <Sparkles class="size-3.5" />
            <span class="lg:hidden">Search</span>
            <span class="hidden lg:inline">Search online</span>
          </button>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none auto-fill-btn flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                :disabled="autoFilling || areAllLocked"
                @click="autoFill"
              >
                <Loader2 v-if="autoFilling" class="size-3.5 animate-spin" />
                <RefreshCw v-else class="size-3.5" />
                Auto-fill
              </button>
            </TooltipTrigger>
            <TooltipContent>{{
              autoFilling ? 'Fetching metadata...' : areAllLocked ? 'All fields are locked' : 'Auto-fill fields using your metadata preferences'
            }}</TooltipContent>
          </Tooltip>

          <div class="flex-none w-px h-4 bg-border mx-0.5" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="updatingLocks || areAllLocked"
                @click="handleLockAll"
              >
                <Lock class="size-3.5" />
                <span class="hidden sm:inline">Lock all</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Lock all fields</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex-none flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
                :disabled="updatingLocks || !hasLockedFields"
                @click="handleUnlockAll"
              >
                <LockOpen class="size-3.5" />
                <span class="hidden sm:inline">Unlock all</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Unlock all fields</TooltipContent>
          </Tooltip>

          <div class="hidden lg:flex flex-none w-px h-4 bg-border mx-0.5" />

          <button
            class="hidden lg:flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="reset"
          >
            <X class="size-3.5" />
            Cancel
          </button>
          <button
            class="hidden lg:flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="submit"
          >
            <Loader2 v-if="saving" class="size-3.5 animate-spin" />
            <Check v-else class="size-3.5" />
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <!-- Title + Subtitle -->
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <MetadataFieldLabel
          class="sm:col-span-3"
          label="Title"
          field="title"
          :locked="isLocked('title')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.title"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('title')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel label="Subtitle" field="subtitle" :locked="isLocked('subtitle')" :is-updating="isUpdatingLock" @toggle="handleLockToggle">
          <input
            v-model="form.subtitle"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('subtitle')"
          />
        </MetadataFieldLabel>
      </div>

      <!-- Authors | Narrators (audio only) -->
      <div class="grid gap-3" :class="isPrimaryAudio ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'">
        <MetadataFieldLabel label="Authors" field="authors" :locked="isLocked('authors')" :is-updating="isUpdatingLock" @toggle="handleLockToggle">
          <ChipInput v-model="form.authors" :search-fn="searchAuthors" :disabled="isLocked('authors')" control-class="pr-10" />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          v-if="isPrimaryAudio"
          label="Narrators"
          field="narrators"
          :locked="isLocked('narrators')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <ChipInput v-model="form.narrators" :search-fn="searchNarrators" :disabled="isLocked('narrators')" control-class="pr-10" />
        </MetadataFieldLabel>
      </div>

      <!-- Genres -->
      <MetadataFieldLabel label="Genres" field="genres" :locked="isLocked('genres')" :is-updating="isUpdatingLock" @toggle="handleLockToggle">
        <ChipInput v-model="form.genres" :search-fn="searchGenres" :disabled="isLocked('genres')" control-class="pr-10" />
      </MetadataFieldLabel>

      <!-- Tags | Rating -->
      <div class="flex flex-col sm:flex-row items-start gap-3">
        <MetadataFieldLabel
          class="w-full sm:flex-1"
          label="Tags"
          field="tags"
          :locked="isLocked('tags')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <ChipInput v-model="form.tags" :search-fn="searchTags" :disabled="isLocked('tags')" control-class="pr-10" />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="w-full sm:w-auto sm:shrink-0"
          label="Rating"
          field="rating"
          :locked="isLocked('rating')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <div
            class="flex h-8 items-center gap-0.5 rounded-lg border border-input bg-background px-2 py-2 pr-10"
            :class="isLocked('rating') ? 'opacity-50 cursor-not-allowed' : ''"
            @mouseleave="hoverRating = null"
          >
            <Tooltip v-for="star in 5" :key="star">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="p-1.5 sm:p-0.5 transition-colors disabled:opacity-50"
                  :disabled="isLocked('rating')"
                  @mouseenter="hoverRating = star"
                  @click="setRating(star)"
                >
                  <Star
                    class="size-5 sm:size-4"
                    :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60'"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rate {{ star }}</TooltipContent>
            </Tooltip>
            <button
              v-if="form.rating"
              type="button"
              class="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              :disabled="isLocked('rating')"
              @click="clearRating"
            >
              Clear
            </button>
          </div>
        </MetadataFieldLabel>
      </div>

      <!-- Series | Index | Publisher -->
      <div class="grid grid-cols-[1fr_7rem] sm:flex sm:flex-wrap gap-3">
        <MetadataFieldLabel
          class="min-w-0 sm:flex-1 sm:min-w-35"
          label="Series"
          field="seriesName"
          :locked="isLocked('seriesName')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.seriesName"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('seriesName')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-28 sm:shrink-0"
          label="Index"
          field="seriesIndex"
          :locked="isLocked('seriesIndex')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            :value="form.seriesIndex ?? ''"
            type="number"
            step="0.1"
            min="0"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('seriesIndex')"
            @input="setFloatField('seriesIndex', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="col-span-2 sm:flex-1 sm:min-w-30"
          label="Publisher"
          field="publisher"
          :locked="isLocked('publisher')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.publisher"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('publisher')"
          />
        </MetadataFieldLabel>
      </div>

      <!-- Language | Year | Page Count | ISBN-13 | ISBN-10 | Duration (audio) | Abridged (audio) -->
      <div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
        <MetadataFieldLabel
          class="col-span-2 sm:w-32 sm:shrink-0"
          label="Language"
          field="language"
          :locked="isLocked('language')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.language"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            maxlength="10"
            :disabled="isLocked('language')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-28 sm:shrink-0"
          label="Year"
          field="publishedYear"
          :locked="isLocked('publishedYear')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            :value="form.publishedYear ?? ''"
            type="number"
            min="1"
            max="2100"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('publishedYear')"
            @input="setIntField('publishedYear', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:w-28 sm:shrink-0"
          label="Page Count"
          field="pageCount"
          :locked="isLocked('pageCount')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            :value="form.pageCount ?? ''"
            type="number"
            min="1"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('pageCount')"
            @input="setIntField('pageCount', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:flex-1 sm:min-w-22.5"
          label="ISBN-13"
          field="isbn13"
          :locked="isLocked('isbn13')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.isbn13"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            maxlength="13"
            :disabled="isLocked('isbn13')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          class="sm:flex-1 sm:min-w-21.25"
          label="ISBN-10"
          field="isbn10"
          :locked="isLocked('isbn10')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            v-model="form.isbn10"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            maxlength="10"
            :disabled="isLocked('isbn10')"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          v-if="isPrimaryAudio"
          class="sm:w-24 sm:shrink-0"
          label="Duration (s)"
          field="durationSeconds"
          :locked="isLocked('durationSeconds')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <input
            :value="form.durationSeconds ?? ''"
            type="number"
            min="1"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isLocked('durationSeconds')"
            @input="setIntField('durationSeconds', $event)"
          />
        </MetadataFieldLabel>
        <MetadataFieldLabel
          v-if="isPrimaryAudio"
          class="sm:w-20 sm:shrink-0"
          label="Abridged"
          field="abridged"
          :locked="isLocked('abridged')"
          :is-updating="isUpdatingLock"
          @toggle="handleLockToggle"
        >
          <div
            class="flex h-8 items-center rounded-lg border border-input bg-background px-3 pr-10"
            :class="isLocked('abridged') ? 'opacity-50 cursor-not-allowed' : ''"
          >
            <input
              id="abridged-check"
              v-model="form.abridged"
              type="checkbox"
              class="h-4 w-4 rounded border-input accent-primary"
              :disabled="isLocked('abridged')"
            />
            <label for="abridged-check" class="ml-2 text-sm text-foreground select-none">Abridged</label>
          </div>
        </MetadataFieldLabel>
      </div>

      <!-- Provider IDs -->
      <div class="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
          @click="providerIdsOpen = !providerIdsOpen"
        >
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Provider IDs</span>
          <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="providerIdsOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="providerIdsOpen" class="p-3">
          <div class="grid grid-cols-2 sm:flex sm:gap-3 sm:overflow-x-auto gap-2">
            <div v-for="{ field, label } in providerIdFields" :key="field" class="min-w-0 sm:min-w-30 sm:flex-1">
              <MetadataFieldLabel :label="label" :field="field" :locked="isLocked(field)" :is-updating="isUpdatingLock" @toggle="handleLockToggle">
                <input
                  v-model="form[field]"
                  class="w-full h-8 rounded-md border border-input bg-background px-2.5 pr-10 text-xs font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="isLocked(field)"
                />
              </MetadataFieldLabel>
            </div>
          </div>
        </div>
      </div>

      <!-- Comic Details (CBX books only) -->
      <div v-if="isPrimaryComic" class="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
          @click="toggleComicSection"
        >
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Comic Details</span>
          <ChevronDown class="size-3.5 text-muted-foreground transition-transform" :class="comicSectionOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="comicSectionOpen" class="p-3 space-y-3">
          <!-- Issue Number | Volume -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              label="Issue Number"
              field="comicIssueNumber"
              :locked="isLocked('comicIssueNumber')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <input
                v-model="form.comicIssueNumber"
                class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLocked('comicIssueNumber')"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              label="Volume"
              field="comicVolumeName"
              :locked="isLocked('comicVolumeName')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <input
                v-model="form.comicVolumeName"
                class="w-full h-8 rounded-lg border border-input bg-background px-3 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isLocked('comicVolumeName')"
              />
            </MetadataFieldLabel>
          </div>
          <!-- Story Arcs -->
          <MetadataFieldLabel
            label="Story Arcs"
            field="comicStoryArcs"
            :locked="isLocked('comicStoryArcs')"
            :is-updating="isUpdatingLock"
            @toggle="handleLockToggle"
          >
            <ChipInput v-model="form.comicStoryArcs" :search-fn="searchComicMetadata" :disabled="isLocked('comicStoryArcs')" control-class="pr-10" />
          </MetadataFieldLabel>
          <!-- Pencillers | Inkers -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              label="Pencillers"
              field="comicPencillers"
              :locked="isLocked('comicPencillers')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicPencillers"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicPencillers')"
                control-class="pr-10"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              label="Inkers"
              field="comicInkers"
              :locked="isLocked('comicInkers')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput v-model="form.comicInkers" :search-fn="searchComicMetadata" :disabled="isLocked('comicInkers')" control-class="pr-10" />
            </MetadataFieldLabel>
          </div>
          <!-- Colorists | Letterers -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              label="Colorists"
              field="comicColorists"
              :locked="isLocked('comicColorists')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicColorists"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicColorists')"
                control-class="pr-10"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              label="Letterers"
              field="comicLetterers"
              :locked="isLocked('comicLetterers')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicLetterers"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicLetterers')"
                control-class="pr-10"
              />
            </MetadataFieldLabel>
          </div>
          <!-- Cover Artists -->
          <MetadataFieldLabel
            label="Cover Artists"
            field="comicCoverArtists"
            :locked="isLocked('comicCoverArtists')"
            :is-updating="isUpdatingLock"
            @toggle="handleLockToggle"
          >
            <ChipInput
              v-model="form.comicCoverArtists"
              :search-fn="searchComicMetadata"
              :disabled="isLocked('comicCoverArtists')"
              control-class="pr-10"
            />
          </MetadataFieldLabel>
          <!-- Characters | Teams -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetadataFieldLabel
              label="Characters"
              field="comicCharacters"
              :locked="isLocked('comicCharacters')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput
                v-model="form.comicCharacters"
                :search-fn="searchComicMetadata"
                :disabled="isLocked('comicCharacters')"
                control-class="pr-10"
              />
            </MetadataFieldLabel>
            <MetadataFieldLabel
              label="Teams"
              field="comicTeams"
              :locked="isLocked('comicTeams')"
              :is-updating="isUpdatingLock"
              @toggle="handleLockToggle"
            >
              <ChipInput v-model="form.comicTeams" :search-fn="searchComicMetadata" :disabled="isLocked('comicTeams')" control-class="pr-10" />
            </MetadataFieldLabel>
          </div>
          <!-- Locations -->
          <MetadataFieldLabel
            label="Locations"
            field="comicLocations"
            :locked="isLocked('comicLocations')"
            :is-updating="isUpdatingLock"
            @toggle="handleLockToggle"
          >
            <ChipInput v-model="form.comicLocations" :search-fn="searchComicMetadata" :disabled="isLocked('comicLocations')" control-class="pr-10" />
          </MetadataFieldLabel>
        </div>
      </div>

      <!-- Description -->
      <MetadataFieldLabel
        label="Description"
        field="description"
        :locked="isLocked('description')"
        :is-updating="isUpdatingLock"
        multiline
        @toggle="handleLockToggle"
      >
        <textarea
          v-model="form.description"
          rows="6"
          class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isLocked('description')"
        />
      </MetadataFieldLabel>

      <!-- Mobile: sticky Save/Cancel bar -->
      <div class="lg:hidden sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 flex gap-2">
        <button
          class="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
          :disabled="!isDirty || saving"
          @click="reset"
        >
          <X class="size-3.5" />
          Cancel
        </button>
        <button
          class="flex flex-1 items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          :disabled="!isDirty || saving"
          @click="submit"
        >
          <Loader2 v-if="saving" class="size-3.5 animate-spin" />
          <Check v-else class="size-3.5" />
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
  </div>

  <MetadataSearchDrawer v-if="searchOpen" :book="props.book" :locked-fields="lockedFields" @close="searchOpen = false" @apply="handleApply" />
</template>

<style scoped>
.auto-fill-btn {
  background: linear-gradient(to right, oklch(0.75 0.16 75), oklch(0.72 0.18 55));
  color: oklch(0.2 0.04 75);
  box-shadow: 0 2px 8px oklch(0.72 0.18 55 / 0.35);
}
.auto-fill-btn:hover {
  filter: brightness(1.08);
  box-shadow: 0 2px 12px oklch(0.72 0.18 55 / 0.5);
}
.auto-fill-btn:disabled {
  filter: none;
}
.search-online-btn {
  background: linear-gradient(to right, var(--primary), color-mix(in oklch, var(--primary) 65%, oklch(0.7 0.25 280)));
  box-shadow: 0 2px 10px color-mix(in oklch, var(--primary) 45%, transparent);
}
.search-online-btn:hover {
  filter: brightness(1.1);
  box-shadow: 0 2px 14px color-mix(in oklch, var(--primary) 60%, transparent);
}
</style>
