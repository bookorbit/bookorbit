<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search, X } from '@lucide/vue'
import { Permission, type BookCard } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { bookFormatCodes } from '@/features/book/lib/book-formats'
import { Input } from '@/components/ui/input'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useMergeBookPicker } from '@/features/book/composables/useMergeBookPicker'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'

const props = defineProps<{
  /** The open book's library: its results come first. Every library the user may merge in is searched. */
  libraryId: number
  /** Books already in the merge; never offered again. */
  excludeIds: number[]
  /** The picked books. The host keeps the cards, so they stay listed when the picker is shown again. */
  modelValue: BookCard[]
  max: number
}>()

const emit = defineEmits<{ 'update:modelValue': [books: BookCard[]] }>()

const { t } = useI18n()
const picker = useMergeBookPicker()
const { libraries } = useLibraries()
const { hasLibraryPermission } = useLibraryPermissions()
const inputId = `merge-picker-${useId()}`
const hintId = `${inputId}-hint`
const headingId = `${inputId}-library`

interface ResultGroup {
  key: string
  libraryId: number | null
  name: string
  books: BookCard[]
}

const excluded = computed(() => new Set(props.excludeIds))
const libraryNames = computed(() => new Map(libraries.value.map((library) => [library.id, library.name])))
// The server refuses a book in a library the user cannot edit, so such books are not offered.
const results = computed(() =>
  picker.results.value.filter((book) => !excluded.value.has(book.id) && hasLibraryPermission(Permission.LibraryMergeBooks, book.libraryId, 'editor')),
)
/** The open book's library first, then the others in the sidebar's order, each under its own name. */
const groups = computed<ResultGroup[]>(() => {
  const order = new Map(libraries.value.map((library, index) => [library.id, index]))
  const byLibrary = new Map<number | null, BookCard[]>()
  for (const book of results.value) {
    const id = book.libraryId ?? null
    byLibrary.set(id, [...(byLibrary.get(id) ?? []), book])
  }
  const rank = (id: number | null): number => (id === props.libraryId ? -1 : id === null ? Number.MAX_SAFE_INTEGER : (order.get(id) ?? order.size))
  return [...byLibrary.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, books]) => ({ key: String(id), libraryId: id, name: libraryName(id), books }))
})
const picked = computed(() => props.modelValue)
const pickedIds = computed(() => new Set(props.modelValue.map((book) => book.id)))
const atLimit = computed(() => props.modelValue.length >= props.max)
const showEmpty = computed(
  () => picker.query.value.trim().length > 0 && !picker.searching.value && !picker.failed.value && results.value.length === 0,
)

function handleInput(value: string | number): void {
  picker.search(null, String(value))
}

function libraryName(id: number | null): string {
  return (id !== null ? libraryNames.value.get(id) : undefined) ?? t('book.merge.crossLibrary.unknownLibrary')
}

function isPicked(id: number): boolean {
  return pickedIds.value.has(id)
}

function bookFormats(book: BookCard): string {
  return formatList(bookFormatCodes(book.files))
}

function toggle(book: BookCard): void {
  if (isPicked(book.id)) {
    remove(book.id)
    return
  }
  if (atLimit.value) return
  emit('update:modelValue', [...props.modelValue, book])
}

function remove(id: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((existing) => existing.id !== id),
  )
}
</script>

<template>
  <div class="space-y-3">
    <p :id="hintId" class="text-sm text-muted-foreground">{{ t('book.merge.crossLibrary.picker.hint') }}</p>

    <div class="space-y-1.5">
      <label :for="inputId" class="text-xs font-medium text-muted-foreground">{{ t('book.merge.crossLibrary.picker.searchLabel') }}</label>
      <div class="relative">
        <Search :size="14" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          :id="inputId"
          :model-value="picker.query.value"
          type="search"
          class="ps-9"
          autocomplete="off"
          :placeholder="t('book.merge.picker.searchPlaceholder')"
          :aria-describedby="hintId"
          @update:model-value="handleInput"
        />
      </div>
    </div>

    <div v-if="picked.length > 0" class="space-y-1.5">
      <p class="text-xs font-medium text-muted-foreground">{{ t('book.merge.picker.selected', { count: picked.length }) }}</p>
      <ul class="flex flex-wrap gap-1.5">
        <li
          v-for="book in picked"
          :key="book.id"
          class="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 ps-2.5 pe-1 text-xs text-foreground"
          data-testid="merge-picker-picked"
        >
          <span class="max-w-48 truncate">{{ book.title || t('book.untitled') }}</span>
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded-full text-foreground hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('book.merge.picker.remove', { title: book.title || t('book.untitled') })"
            @click="remove(book.id)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <p class="text-xs text-muted-foreground">{{ t('book.merge.picker.limit', { max }) }}</p>

    <div aria-live="polite">
      <p v-if="picker.searching.value" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('common.loading') }}
      </p>
      <p v-else-if="picker.failed.value" class="text-sm text-destructive" role="alert">{{ t('book.merge.picker.failed') }}</p>
      <p v-else-if="showEmpty" class="text-sm text-muted-foreground">{{ t('book.merge.picker.empty') }}</p>
      <p v-else-if="picker.query.value.trim().length === 0 && picked.length === 0" class="text-sm text-muted-foreground">
        {{ t('book.merge.crossLibrary.picker.prompt') }}
      </p>
    </div>

    <div v-if="results.length > 0" class="space-y-3" data-testid="merge-picker-results">
      <section
        v-for="(group, index) in groups"
        :key="group.key"
        class="space-y-1.5"
        :aria-labelledby="`${headingId}-${index}`"
        data-testid="merge-picker-group"
      >
        <h4 :id="`${headingId}-${index}`" class="text-xs font-semibold break-words text-foreground" dir="auto">{{ group.name }}</h4>
        <ul class="space-y-1.5">
          <li v-for="book in group.books" :key="book.id">
            <label
              class="flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              :class="[
                isPicked(book.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
                atLimit && !isPicked(book.id) ? 'cursor-not-allowed' : '',
              ]"
            >
              <input
                type="checkbox"
                class="shrink-0 accent-primary focus-visible:outline-none"
                :checked="isPicked(book.id)"
                :disabled="atLimit && !isPicked(book.id)"
                @change="toggle(book)"
              />
              <span class="relative h-12 w-8 shrink-0 overflow-hidden rounded-xs bg-muted">
                <BookCoverImage v-if="book.hasCover" :book-id="book.id" :version="book.coverVersion" class="size-full object-cover" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-foreground">{{ book.title || t('book.untitled') }}</span>
                <span v-if="book.authors.length > 0" class="block truncate text-xs text-muted-foreground">{{ formatList(book.authors) }}</span>
                <span class="flex flex-wrap gap-x-2 text-[0.7rem] text-muted-foreground">
                  <span dir="auto">{{ t('book.merge.crossLibrary.picker.library', { library: group.name }) }}</span>
                  <span v-if="bookFormats(book)">{{ bookFormats(book) }}</span>
                </span>
              </span>
            </label>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
