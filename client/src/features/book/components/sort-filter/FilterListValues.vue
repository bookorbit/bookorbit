<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Search } from '@lucide/vue'
import { ListboxContent, ListboxFilter, ListboxItem, ListboxRoot, type AcceptableValue } from 'reka-ui'
import {
  AUTHOR_GENDERS,
  BOOK_FORMATS,
  PLAIN_EPUB_FILTER_FORMAT,
  READ_ALONG_FORMAT_PRIORITY,
  READ_STATUSES,
  withReadAlongFormatPriority,
  type RuleField,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatNumber } from '@/i18n/formatters'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { fieldLabel, filterValueLabel } from '@/features/book/lib/filter-labels'
import { normalizeSearch } from './field-listbox'

/**
 * A field's values as a checklist. Short, known lists (read status, format, library, collection)
 * show whole with counts where the app has them; open-ended ones (authors, series, genres) search
 * the server as you type. Values already chosen stay pinned at the top.
 */
const props = defineProps<{
  field: RuleField
  modelValue: string[]
  /** Book counts per value, where the host knows them, such as a library's format counts. */
  counts?: Record<string, number>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

interface ValueOption {
  value: string
  label: string
  count?: number
}

const ENDPOINTS: Partial<Record<RuleField, string>> = {
  author: '/api/v1/metadata/authors',
  genre: '/api/v1/metadata/genres',
  tag: '/api/v1/metadata/tags',
  series: '/api/v1/metadata/series',
  publisher: '/api/v1/metadata/publishers',
  language: '/api/v1/metadata/languages',
}
/** The languages endpoint answers a blank query with every language, so its list shows before anything is typed. */
const LISTS_ON_BLANK: RuleField[] = ['language']
const ROW_CAP = 80
const SEARCH_DEBOUNCE_MS = 200

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const { collections, fetchCollections } = useCollections()

const FILTER_FORMATS = withReadAlongFormatPriority(BOOK_FORMATS).flatMap((format) =>
  format === READ_ALONG_FORMAT_PRIORITY ? [format, PLAIN_EPUB_FILTER_FORMAT] : [format],
)

const query = ref('')
const pinned = ref<string[]>([...props.modelValue])
const results = ref<string[]>([])
const endpoint = computed(() => ENDPOINTS[props.field] ?? null)

const fixedOptions = computed<ValueOption[] | null>(() => {
  switch (props.field) {
    case 'authorGender':
      return AUTHOR_GENDERS.map((gender) => ({ value: gender, label: filterValueLabel('authorGender', gender) }))
    case 'readStatus':
      return READ_STATUSES.map((status) => ({ value: status, label: filterValueLabel('readStatus', status) }))
    case 'format':
      return FILTER_FORMATS.map((format) => ({
        value: format,
        label: filterValueLabel('format', format),
        count: props.counts?.[format],
      }))
    case 'library':
      return [...libraries.value]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((library) => ({ value: library.name, label: library.name, count: library.bookCount }))
    case 'collection':
      return [...collections.value]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((collection) => ({ value: collection.name, label: collection.name, count: collection.bookCount }))
    default:
      return null
  }
})

const searchable = computed(() => endpoint.value !== null || (fixedOptions.value?.length ?? 0) > 8)
const searching = computed(() => query.value.trim().length > 0)

function optionFor(value: string): ValueOption {
  return fixedOptions.value?.find((option) => option.value === value) ?? { value, label: filterValueLabel(props.field, value) }
}

const options = computed<ValueOption[]>(() => {
  const needle = normalizeSearch(query.value.trim())
  const matches = (option: ValueOption) => !needle || normalizeSearch(option.label).includes(needle)
  const pinnedOptions = pinned.value.map(optionFor).filter(matches)
  const pinnedSet = new Set(pinned.value)
  const rest = fixedOptions.value
    ? fixedOptions.value.filter((option) => !pinnedSet.has(option.value) && matches(option))
    : results.value.filter((value) => !pinnedSet.has(value)).map(optionFor)
  return [...pinnedOptions, ...rest]
})

const shown = computed(() => options.value.slice(0, ROW_CAP))
const hidden = computed(() => Math.max(0, options.value.length - ROW_CAP))
const awaitingQuery = computed(() => endpoint.value !== null && !searching.value && !LISTS_ON_BLANK.includes(props.field))

let timer: ReturnType<typeof setTimeout> | null = null
let latestRequest = 0

async function search(q: string) {
  const url = endpoint.value
  if (!url) return
  const requestId = ++latestRequest
  try {
    const res = await api(`${url}?q=${encodeURIComponent(q)}`)
    if (requestId !== latestRequest || !res.ok) return
    const data = (await res.json()) as { name: string }[]
    results.value = data.map((item) => item.name)
  } catch {
    if (requestId === latestRequest) results.value = []
  }
}

watch(query, (value) => {
  // Re-pin on every search so values ticked a moment ago move to the top instead of jumping under the pointer.
  pinned.value = [...props.modelValue]
  if (!endpoint.value) return
  if (timer) clearTimeout(timer)
  const q = value.trim()
  if (!q && !LISTS_ON_BLANK.includes(props.field)) {
    latestRequest++
    results.value = []
    return
  }
  timer = setTimeout(() => void search(q), SEARCH_DEBOUNCE_MS)
})

onMounted(() => {
  if (props.field === 'library') void fetchLibraries()
  if (props.field === 'collection') void fetchCollections()
  if (LISTS_ON_BLANK.includes(props.field)) void search('')
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  latestRequest = -1
})

function handleUpdate(value: AcceptableValue | AcceptableValue[] | undefined) {
  emit('update:modelValue', Array.isArray(value) ? value.map(String) : [])
}

const searchPlaceholder = computed(() => {
  const key = `book.filter.valueSearch.${props.field}`
  const label = t(key)
  return label === key ? t('common.search') : label
})
</script>

<template>
  <ListboxRoot :model-value="modelValue" multiple highlight-on-hover class="flex min-h-0 flex-col gap-2" @update:model-value="handleUpdate">
    <label
      v-if="searchable"
      class="flex h-8 shrink-0 items-center gap-[7px] rounded-[calc(var(--radius)-3px)] border border-border bg-background px-[9px] focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-primary/15 max-sm:h-10"
    >
      <Search :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <ListboxFilter
        v-model="query"
        auto-focus
        type="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        class="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground max-sm:text-[15px]"
      />
    </label>
    <ListboxContent
      :aria-label="t('book.filter.valuesOf', { field: fieldLabel(field) })"
      class="-mx-1 max-h-[270px] min-h-0 overflow-y-auto overscroll-contain px-1 outline-none max-sm:max-h-none"
    >
      <ListboxItem
        v-for="option in shown"
        :key="option.value"
        :value="option.value"
        class="group/value flex min-h-8 w-full cursor-pointer items-center gap-[9px] rounded-[calc(var(--radius)-4px)] px-2 text-start text-[13px] text-foreground outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground max-sm:min-h-[42px] max-sm:text-[14.5px]"
      >
        <span
          class="grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] border-input bg-background text-primary-foreground group-data-[state=checked]/value:border-primary group-data-[state=checked]/value:bg-primary"
          aria-hidden="true"
        >
          <Check :size="11" :stroke-width="3" class="opacity-0 group-data-[state=checked]/value:opacity-100" />
        </span>
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
        <span v-if="option.count != null" class="ms-auto text-xs text-muted-foreground tabular-nums">{{ formatNumber(option.count) }}</span>
      </ListboxItem>
    </ListboxContent>
    <p v-if="awaitingQuery" class="px-2 text-xs text-muted-foreground">
      {{ modelValue.length > 0 ? t('book.filter.typeToFind') : t('book.filter.typeToSearch') }}
    </p>
    <p v-else-if="searching && shown.length === 0" class="px-2 py-3 text-center text-[12.5px] text-muted-foreground">
      {{ t('book.filter.nothingMatches', { query: query.trim() }) }}
    </p>
    <p v-else-if="hidden > 0" class="px-2 text-center text-[12.5px] text-muted-foreground">
      {{ t('book.filter.moreValues', { count: formatNumber(hidden) }) }}
    </p>
  </ListboxRoot>
</template>
