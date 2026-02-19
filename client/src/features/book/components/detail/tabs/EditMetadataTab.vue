<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Search, Star } from 'lucide-vue-next'
import type { BookDetail } from '@projectx/types'
import ChipInput from '@/components/ui/ChipInput.vue'
import CoverEditorPanel from './CoverEditorPanel.vue'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'
import type { MetadataPatch } from '../../../composables/useMetadataDiff'
import { useMetadataEditor } from '../../../composables/useMetadataEditor'
import { useAuthorSearch } from '../../../composables/useAuthorSearch'
import { useTagSearch } from '../../../composables/useTagSearch'

const props = defineProps<{ book: BookDetail }>()
const emit = defineEmits<{ saved: [BookDetail]; coverChanged: ['extracted' | 'custom' | null] }>()

const { form, saving, error, isDirty, load, reset, save } = useMetadataEditor()
const { search: searchAuthors } = useAuthorSearch()
const { search: searchTags } = useTagSearch()

const coverPanel = ref<InstanceType<typeof CoverEditorPanel> | null>(null)
const searchOpen = ref(false)

const providerIdFields = [
  { field: 'googleBooksId' as const, label: 'Google Books' },
  { field: 'goodreadsId' as const, label: 'Goodreads' },
  { field: 'amazonId' as const, label: 'Amazon' },
  { field: 'hardcoverId' as const, label: 'Hardcover' },
  { field: 'openLibraryId' as const, label: 'OpenLibrary' },
]

function setIntField(field: 'publishedYear' | 'pageCount', e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') { form[field] = null; return }
  const n = parseInt(val, 10)
  form[field] = isNaN(n) ? null : n
}

function setFloatField(field: 'seriesIndex', e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val === '') { form[field] = null; return }
  const n = parseFloat(val)
  form[field] = isNaN(n) ? null : n
}

onMounted(() => load(props.book))
watch(() => props.book.id, () => load(props.book))

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
</script>

<template>
  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Left: Cover panel -->
    <div class="w-full lg:w-52 lg:shrink-0 lg:sticky lg:top-6">
      <CoverEditorPanel ref="coverPanel" :book="props.book" @cover-changed="(src) => emit('coverChanged', src)" />
    </div>

    <!-- Right: Form -->
    <div class="flex-1 min-w-0 space-y-5">
      <!-- Action bar -->
      <div class="flex items-center justify-between min-h-[2rem]">
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <span v-else />
        <div class="flex gap-2">
          <button
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="searchOpen = true"
          >
            <Search class="size-3.5" />
            Search online
          </button>
          <button
            class="h-8 px-4 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="reset"
          >
            Cancel
          </button>
          <button
            class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
            :disabled="!isDirty || saving"
            @click="submit"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <!-- Title -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</label>
        <input
          v-model="form.title"
          class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
          placeholder="Book title"
        />
      </div>

      <!-- Subtitle -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtitle</label>
        <input
          v-model="form.subtitle"
          class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
          placeholder="Subtitle"
        />
      </div>

      <!-- Authors + Tags -->
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Authors</label>
          <ChipInput v-model="form.authors" placeholder="Add author..." :search-fn="searchAuthors" />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tags</label>
          <ChipInput v-model="form.tags" placeholder="Add tag..." :search-fn="searchTags" />
        </div>
      </div>

      <!-- Series -->
      <div class="grid grid-cols-3 gap-4">
        <div class="col-span-2 space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Series</label>
          <input
            v-model="form.seriesName"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Series name"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Index</label>
          <input
            :value="form.seriesIndex ?? ''"
            type="number"
            step="0.1"
            min="0"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="1"
            @input="setFloatField('seriesIndex', $event)"
          />
        </div>
      </div>

      <!-- Publisher + Year + Language -->
      <div class="grid grid-cols-3 gap-4">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Publisher</label>
          <input
            v-model="form.publisher"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="Publisher"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Published Year</label>
          <input
            :value="form.publishedYear ?? ''"
            type="number"
            min="1"
            max="2100"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="2024"
            @input="setIntField('publishedYear', $event)"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Language</label>
          <input
            v-model="form.language"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="en"
            maxlength="10"
          />
        </div>
      </div>

      <!-- Page count + ISBNs -->
      <div class="grid grid-cols-3 gap-4">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Page Count</label>
          <input
            :value="form.pageCount ?? ''"
            type="number"
            min="1"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="300"
            @input="setIntField('pageCount', $event)"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">ISBN-13</label>
          <input
            v-model="form.isbn13"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="9780000000000"
            maxlength="13"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">ISBN-10</label>
          <input
            v-model="form.isbn10"
            class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
            placeholder="0000000000"
            maxlength="10"
          />
        </div>
      </div>

      <!-- Provider IDs -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider IDs</label>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div v-for="{ field, label } in providerIdFields" :key="field" class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground w-24 shrink-0">{{ label }}</span>
            <input
              v-model="form[field]"
              class="flex-1 h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-mono outline-none focus:ring-1 focus:ring-ring transition-shadow"
              :placeholder="label + ' ID'"
            />
          </div>
        </div>
      </div>

      <!-- Rating -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rating</label>
        <div class="flex items-center gap-0.5" @mouseleave="hoverRating = null">
          <button
            v-for="star in 5"
            :key="star"
            type="button"
            class="p-1 transition-colors"
            :title="`Rate ${star}`"
            @mouseenter="hoverRating = star"
            @click="setRating(star)"
          >
            <Star class="size-5" :class="(displayRating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'" />
          </button>
          <button
            v-if="form.rating"
            type="button"
            class="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="form.rating = null"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Description -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
        <textarea
          v-model="form.description"
          rows="8"
          class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow resize-y"
          placeholder="Book description..."
        />
      </div>
    </div>
  </div>

  <MetadataSearchDrawer
    v-if="searchOpen"
    :book="props.book"
    @close="searchOpen = false"
    @apply="handleApply"
  />
</template>
