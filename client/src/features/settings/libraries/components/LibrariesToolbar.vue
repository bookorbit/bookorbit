<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { isLibrarySortField, LIBRARY_SORT_FIELDS, type LibrarySortField } from '../lib/library-sort'

defineProps<{
  query: string
  sortBy: LibrarySortField
  libraryCount: number
  folderCount: number
  totalBooks: number
  totalSizeBytes: number
  statsPending: boolean
}>()

const emit = defineEmits<{ 'update:query': [value: string]; 'update:sortBy': [value: LibrarySortField] }>()

const { t } = useI18n()

/** The default order is the sidebar's display order, and the label says so. */
const sortOptions = computed(() =>
  LIBRARY_SORT_FIELDS.map((value) => ({
    value,
    label: t(value === 'default' ? 'settings.admin.libraries.sort.sidebar' : `settings.admin.libraries.sort.${value}`),
  })),
)

function handleQueryInput(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function clearQuery() {
  emit('update:query', '')
}

function handleSortChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (isLibrarySortField(value)) emit('update:sortBy', value)
}
</script>

<template>
  <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
    <label class="relative block min-w-0 lg:w-64">
      <span class="sr-only">{{ t('settings.admin.libraries.filterLabel') }}</span>
      <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        class="input-field h-9 w-full ps-9 pe-9"
        :value="query"
        :placeholder="t('settings.admin.libraries.filterPlaceholder')"
        @input="handleQueryInput"
      />
      <button
        v-if="query"
        type="button"
        class="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('settings.admin.libraries.filterClear')"
        @click="clearQuery"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </label>

    <label class="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <span class="shrink-0">{{ t('settings.admin.libraries.sortLabel') }}</span>
      <select class="select-field h-9" :value="sortBy" @change="handleSortChange">
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </label>

    <!-- The figures carry the weight; the units stay quiet beside them. -->
    <p
      data-testid="libraries-totals"
      class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground lg:ms-auto lg:justify-end"
    >
      <span
        ><span class="font-semibold tabular-nums text-foreground">{{ formatNumber(libraryCount) }}</span>
        {{ t('settings.admin.libraries.librariesUnit', { count: libraryCount }) }}</span
      >
      <span class="opacity-50" aria-hidden="true">&middot;</span>
      <span
        ><span class="font-semibold tabular-nums text-foreground">{{ formatNumber(folderCount) }}</span>
        {{ t('settings.admin.libraries.foldersUnit', { count: folderCount }) }}</span
      >
      <template v-if="!statsPending">
        <span class="opacity-50" aria-hidden="true">&middot;</span>
        <span
          ><span class="font-semibold tabular-nums text-foreground">{{ formatNumber(totalBooks) }}</span>
          {{ t('settings.admin.libraries.booksUnit', { count: totalBooks }) }}</span
        >
        <span class="opacity-50" aria-hidden="true">&middot;</span>
        <i18n-t keypath="settings.admin.libraries.onDiskUnit" tag="span" scope="global">
          <template #size
            ><span class="font-semibold tabular-nums text-foreground">{{ formatBytes(totalSizeBytes) }}</span></template
          >
        </i18n-t>
      </template>
    </p>
  </div>
</template>
