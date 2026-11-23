<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search, X } from '@lucide/vue'
import { Permission, type BookCard, type BookEditionSuggestion } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { bookFormatCodes } from '@/features/book/lib/book-formats'
import { Input } from '@/components/ui/input'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useMergeBookPicker } from '@/features/book/composables/useMergeBookPicker'
import { useEditionSuggestions } from '@/features/book/composables/useEditionSuggestions'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { hasLinkedBooks } from '@/features/book/lib/book-link'
import { cardEditionDetail } from '@/features/book/lib/book-editions'

const props = defineProps<{
  /** The open book and the books already linked with it; never offered again. */
  excludeIds: number[]
  modelValue: number[]
  max: number
  /** The open book, whose likely other editions are listed before anything is typed. */
  suggestForId?: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [ids: number[]]
  /** The picked books' cards, so the sheet can count the groups they bring along. */
  'update:cards': [cards: BookCard[]]
}>()

type PickerRow = { book: BookCard; suggestion: BookEditionSuggestion | null }

const { t } = useI18n()
const picker = useMergeBookPicker()
const editionSuggestions = useEditionSuggestions(computed(() => props.suggestForId ?? null))
const { hasLibraryPermission } = useLibraryPermissions()
const { libraries } = useLibraries()
const inputId = `link-picker-${useId()}`
const hintId = `${inputId}-hint`
const suggestionsHeadingId = `${inputId}-suggestions`
/** Picked books stay listed after the search moves on, so their cards are kept here. */
const pickedCards = ref(new Map<number, BookCard>())

const excluded = computed(() => new Set(props.excludeIds))
const libraryNames = computed(() => new Map(libraries.value.map((library) => [library.id, library.name])))
// The server refuses a book in a library the user cannot edit, so such books are not offered.
function offerable(book: BookCard): boolean {
  return !excluded.value.has(book.id) && hasLibraryPermission(Permission.LibraryEditMetadata, book.libraryId, 'editor')
}
const results = computed(() => picker.results.value.filter(offerable))
const suggestions = computed(() => editionSuggestions.suggestions.value.filter((suggestion) => offerable(suggestion.book)))
const searching = computed(() => picker.query.value.trim().length > 0)
/** Suggestions fill the list until a search replaces them. */
const rows = computed((): PickerRow[] =>
  searching.value
    ? results.value.map((book) => ({ book, suggestion: null }))
    : suggestions.value.map((suggestion) => ({ book: suggestion.book, suggestion })),
)
const showSuggestions = computed(() => !searching.value && suggestions.value.length > 0)
const loadingSuggestions = computed(() => !searching.value && editionSuggestions.loading.value)
const picked = computed(() => props.modelValue.map((id) => pickedCards.value.get(id)).filter((book): book is BookCard => book !== undefined))
const atLimit = computed(() => props.modelValue.length >= props.max)
const showEmpty = computed(
  () => picker.query.value.trim().length > 0 && !picker.searching.value && !picker.failed.value && results.value.length === 0,
)

function handleInput(value: string | number): void {
  picker.search(null, String(value))
}

function isPicked(id: number): boolean {
  return props.modelValue.includes(id)
}

function libraryName(book: BookCard): string | null {
  return book.libraryId != null ? (libraryNames.value.get(book.libraryId) ?? null) : null
}

function suggestionKind(suggestion: BookEditionSuggestion): string {
  return suggestion.kind === 'other_format' ? t('book.editions.suggestions.otherFormat') : t('book.editions.suggestions.otherEdition')
}

function suggestionReason(suggestion: BookEditionSuggestion): string {
  const sameWork = suggestion.reasons.includes('same_work')
  const titleAuthor = suggestion.reasons.includes('title_author')
  if (sameWork && titleAuthor) return t('book.editions.suggestions.sameWorkAndTitle')
  return sameWork ? t('book.editions.suggestions.sameWork') : t('book.editions.suggestions.titleAuthor')
}

function editionDetail(book: BookCard): string | null {
  return cardEditionDetail(book)
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
  pickedCards.value = new Map(pickedCards.value).set(book.id, book)
  const ids = [...props.modelValue, book.id]
  emit('update:modelValue', ids)
  emitCards(ids)
}

function remove(id: number): void {
  const ids = props.modelValue.filter((existing) => existing !== id)
  emit('update:modelValue', ids)
  emitCards(ids)
}

function emitCards(ids: number[]): void {
  emit(
    'update:cards',
    ids.map((id) => pickedCards.value.get(id)).filter((card): card is BookCard => card !== undefined),
  )
}
</script>

<template>
  <div class="space-y-3">
    <p :id="hintId" class="text-sm text-muted-foreground">{{ t('book.editions.sheet.pickerHint') }}</p>

    <div class="space-y-1.5">
      <label :for="inputId" class="text-xs font-medium text-muted-foreground">{{ t('book.link.picker.searchLabel') }}</label>
      <div class="relative">
        <Search :size="14" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          :id="inputId"
          :model-value="picker.query.value"
          type="search"
          class="ps-9"
          autocomplete="off"
          :placeholder="t('book.link.picker.searchPlaceholder')"
          :aria-describedby="hintId"
          @update:model-value="handleInput"
        />
      </div>
    </div>

    <div v-if="picked.length > 0" class="space-y-1.5">
      <p class="text-xs font-medium text-muted-foreground">{{ t('book.link.picker.selected', { count: picked.length }) }}</p>
      <ul class="flex flex-wrap gap-1.5">
        <li
          v-for="book in picked"
          :key="book.id"
          class="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 ps-2.5 pe-1 text-xs text-foreground"
        >
          <span class="max-w-48 truncate">{{ book.title || t('book.untitled') }}</span>
          <span v-if="editionDetail(book)" class="max-w-40 truncate text-muted-foreground" dir="auto">{{ editionDetail(book) }}</span>
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded-full text-foreground hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('book.link.picker.remove', { title: book.title || t('book.untitled') })"
            @click="remove(book.id)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <p class="text-xs text-muted-foreground">{{ t('book.link.picker.limit', { max }) }}</p>

    <div aria-live="polite">
      <p v-if="picker.searching.value" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('common.loading') }}
      </p>
      <p v-else-if="picker.failed.value" class="text-sm text-destructive" role="alert">{{ t('book.link.picker.failed') }}</p>
      <p v-else-if="showEmpty" class="text-sm text-muted-foreground">{{ t('book.link.picker.empty') }}</p>
      <p v-else-if="loadingSuggestions" class="flex items-center gap-2 text-sm text-muted-foreground" data-testid="link-picker-suggestions-loading">
        <Loader2 :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('book.editions.suggestions.loading') }}
      </p>
      <p v-else-if="!searching && !showSuggestions && picked.length === 0" class="text-sm text-muted-foreground">
        {{ t('book.link.picker.prompt') }}
      </p>
    </div>

    <h3 v-if="showSuggestions" :id="suggestionsHeadingId" class="text-xs font-medium text-muted-foreground">
      {{ t('book.editions.suggestions.heading') }}
    </h3>
    <ul
      v-if="rows.length > 0"
      class="space-y-1.5"
      :aria-labelledby="showSuggestions ? suggestionsHeadingId : undefined"
      :data-testid="showSuggestions ? 'link-picker-suggestions' : 'link-picker-results'"
    >
      <li v-for="{ book, suggestion } in rows" :key="book.id">
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
            <span v-if="editionDetail(book)" class="block truncate text-xs text-foreground" dir="auto">{{ editionDetail(book) }}</span>
            <span v-if="suggestion" class="flex min-w-0 items-center gap-1.5 text-[0.7rem]" data-testid="link-picker-suggestion-reason">
              <span class="shrink-0 rounded-full bg-primary/10 px-1.5 py-px font-medium text-foreground">{{ suggestionKind(suggestion) }}</span>
              <span class="truncate text-muted-foreground">{{ suggestionReason(suggestion) }}</span>
            </span>
            <span class="flex flex-wrap gap-x-2 text-[0.7rem] text-muted-foreground">
              <span v-if="libraryName(book)" dir="auto">{{ t('book.link.picker.library', { library: libraryName(book) }) }}</span>
              <span v-if="bookFormats(book)">{{ bookFormats(book) }}</span>
              <span v-if="hasLinkedBooks(book)">{{ t('book.editions.sheet.alreadyGrouped') }}</span>
            </span>
          </span>
        </label>
      </li>
    </ul>
  </div>
</template>
