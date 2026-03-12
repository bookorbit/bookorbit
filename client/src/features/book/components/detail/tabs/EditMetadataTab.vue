<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Loader2, RefreshCw, Sparkles, Star } from 'lucide-vue-next'
import type { BookDetail } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ChipInput from '@/components/ui/ChipInput.vue'
import CoverEditorPanel from './CoverEditorPanel.vue'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import { useMetadataEditor } from '../../../composables/useMetadataEditor'
import { useAuthorSearch } from '../../../composables/useAuthorSearch'
import { useGenreSearch } from '../../../composables/useTagSearch'
import { useRefreshMetadata } from '../../../composables/useRefreshMetadata'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ saved: [BookDetail]; coverChanged: ['extracted' | 'custom' | null] }>()

const { form, saving, error, isDirty, load, reset, save } = useMetadataEditor()
const { search: searchAuthors } = useAuthorSearch()
const { search: searchGenres } = useGenreSearch()

const coverPanel = ref<InstanceType<typeof CoverEditorPanel> | null>(null)
const searchOpen = ref(false)

const providerIdFields = [
  { field: 'googleBooksId' as const, label: 'Google Books' },
  { field: 'goodreadsId' as const, label: 'Goodreads' },
  { field: 'amazonId' as const, label: 'Amazon' },
  { field: 'hardcoverId' as const, label: 'Hardcover' },
  { field: 'openLibraryId' as const, label: 'OpenLibrary' },
  { field: 'itunesId' as const, label: 'iTunes' },
]

function setIntField(field: 'publishedYear' | 'pageCount', e: Event) {
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

onMounted(() => load(props.book))
watch(
  () => props.book.id,
  () => load(props.book),
)

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

function handleApply({ formPatch, coverUrl }: { formPatch: MetadataPatch; coverUrl?: string }) {
  Object.assign(form, formPatch)
  if (coverUrl) coverPanel.value?.setUrl(coverUrl)
}

const { refreshing: autoFilling, previewRefresh } = useRefreshMetadata()

async function autoFill() {
  const preview = await previewRefresh(props.book.id)
  if (!preview) return
  if (preview.title != null) form.title = preview.title
  if (preview.subtitle != null) form.subtitle = preview.subtitle
  if (preview.description != null) form.description = preview.description
  if (preview.authors?.length) form.authors = preview.authors
  if (preview.genres?.length) form.genres = preview.genres
  if (preview.publisher != null) form.publisher = preview.publisher
  if (preview.publishedYear != null) form.publishedYear = preview.publishedYear
  if (preview.language != null) form.language = preview.language
  if (preview.pageCount != null) form.pageCount = preview.pageCount
  if (preview.seriesName != null) form.seriesName = preview.seriesName
  if (preview.seriesIndex != null) form.seriesIndex = preview.seriesIndex
  if (preview.googleBooksId != null) form.googleBooksId = preview.googleBooksId
  if (preview.goodreadsId != null) form.goodreadsId = preview.goodreadsId
  if (preview.amazonId != null) form.amazonId = preview.amazonId
  if (preview.hardcoverId != null) form.hardcoverId = preview.hardcoverId
  if (preview.openLibraryId != null) form.openLibraryId = preview.openLibraryId
  if (preview.itunesId != null) form.itunesId = preview.itunesId
  if (preview.coverUrl) coverPanel.value?.setUrl(preview.coverUrl)
}
</script>

<template>
  <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
    <!-- Left: Cover panel -->
    <div class="w-full lg:w-48 lg:shrink-0 lg:sticky lg:top-6">
      <CoverEditorPanel ref="coverPanel" :book="props.book" @cover-changed="(src) => emit('coverChanged', src)" />
    </div>

    <!-- Right: Form -->
    <div class="flex-1 min-w-0 space-y-3">
      <!-- Action bar -->
      <div class="flex items-center justify-between min-h-[2rem]">
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <span v-else />
        <div class="flex gap-2">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="auto-fill-btn flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                :disabled="autoFilling"
                @click="autoFill"
              >
                <Loader2 v-if="autoFilling" class="size-3.5 animate-spin" />
                <RefreshCw v-else class="size-3.5" />
                Auto-fill
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ autoFilling ? 'Fetching metadata...' : 'Auto-fill fields using your metadata preferences' }}</TooltipContent>
          </Tooltip>
          <button
            class="search-online-btn flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-primary-foreground text-sm font-medium transition-all"
            @click="searchOpen = true"
          >
            <Sparkles class="size-3.5" />
            Search online
          </button>
          <button
            class="h-8 px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="reset"
          >
            Cancel
          </button>
          <button
            class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="submit"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <!-- Title + Subtitle -->
      <div class="grid grid-cols-4 gap-3">
        <div class="col-span-3 space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</label>
          <input
            v-model="form.title"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Book title"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtitle</label>
          <input
            v-model="form.subtitle"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Subtitle"
          />
        </div>
      </div>

      <!-- Authors -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Authors</label>
        <ChipInput v-model="form.authors" placeholder="Add author..." :search-fn="searchAuthors" />
      </div>

      <!-- Genres -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Genres</label>
        <ChipInput v-model="form.genres" placeholder="Add genre..." :search-fn="searchGenres" />
      </div>

      <!-- Series + Index + Rating -->
      <div class="grid grid-cols-6 gap-3">
        <div class="col-span-4 space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Series</label>
          <input
            v-model="form.seriesName"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Series name"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Index</label>
          <input
            :value="form.seriesIndex ?? ''"
            type="number"
            step="0.1"
            min="0"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="1"
            @input="setFloatField('seriesIndex', $event)"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rating</label>
          <div class="flex items-center gap-0.5 h-8" @mouseleave="hoverRating = null">
            <Tooltip v-for="star in 5" :key="star">
              <TooltipTrigger as-child>
                <button type="button" class="p-0.5 transition-colors" @mouseenter="hoverRating = star" @click="setRating(star)">
                  <Star class="size-4" :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rate {{ star }}</TooltipContent>
            </Tooltip>
            <button
              v-if="form.rating"
              type="button"
              class="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="form.rating = null"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <!-- Publisher + Year + Language -->
      <div class="grid grid-cols-3 gap-3">
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Publisher</label>
          <input
            v-model="form.publisher"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Publisher"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Published Year</label>
          <input
            :value="form.publishedYear ?? ''"
            type="number"
            min="1"
            max="2100"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="2024"
            @input="setIntField('publishedYear', $event)"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Language</label>
          <input
            v-model="form.language"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="en"
            maxlength="10"
          />
        </div>
      </div>

      <!-- Page count + ISBNs -->
      <div class="grid grid-cols-3 gap-3">
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Page Count</label>
          <input
            :value="form.pageCount ?? ''"
            type="number"
            min="1"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="300"
            @input="setIntField('pageCount', $event)"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">ISBN-13</label>
          <input
            v-model="form.isbn13"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="9780000000000"
            maxlength="13"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">ISBN-10</label>
          <input
            v-model="form.isbn10"
            class="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="0000000000"
            maxlength="10"
          />
        </div>
      </div>

      <!-- Provider IDs -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider IDs</label>
        <div class="rounded-lg border border-border bg-muted/30 p-3 grid grid-cols-5 gap-3">
          <div v-for="{ field, label } in providerIdFields" :key="field" class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ label }}</label>
            <input
              v-model="form[field]"
              class="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
              :placeholder="label + ' ID'"
            />
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
        <textarea
          v-model="form.description"
          rows="6"
          class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow resize-y"
          placeholder="Book description..."
        />
      </div>
    </div>
  </div>

  <MetadataSearchDrawer v-if="searchOpen" :book="props.book" @close="searchOpen = false" @apply="handleApply" />
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
