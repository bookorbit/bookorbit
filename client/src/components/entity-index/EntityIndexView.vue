<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpDown, Plus, Search, X } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import AppIcon from '@/components/AppIcon.vue'
import { formatNumber } from '@/i18n/formatters'

export interface EntityIndexItem {
  id: number
  displayOrder: number
  name: string
  icon?: string | null
  bookCount?: number | null
}

type SortField = 'custom' | 'name' | 'bookCount'
type SortDirection = 'asc' | 'desc'

const props = withDefaults(
  defineProps<{
    title: string
    titleIcon: string
    items: EntityIndexItem[]
    routeName: string
    fallbackIcon: string
    searchPlaceholder: string
    emptyTitle: string
    emptyHint: string
    loading?: boolean
    canAdd?: boolean
    addLabel?: string
  }>(),
  { loading: false, canAdd: false, addLabel: undefined },
)

const emit = defineEmits<{ add: [] }>()

const { t } = useI18n()

const SORT_FIELDS: SortField[] = ['custom', 'name', 'bookCount']
const SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc']

const query = ref('')
const sort = ref<SortField>('custom')
const order = ref<SortDirection>('asc')

const sortLabels = computed<Record<SortField, string>>(() => ({
  custom: t('components.entityIndex.sort.custom'),
  name: t('components.entityIndex.sort.name'),
  bookCount: t('components.entityIndex.sort.bookCount'),
}))

const isDefaultSort = computed(() => sort.value === 'custom' && order.value === 'asc')
const isFiltering = computed(() => query.value.trim().length > 0)

const matchedItems = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return props.items
  return props.items.filter((item) => item.name.toLocaleLowerCase().includes(needle))
})

const sortedItems = computed(() => {
  const direction = order.value === 'asc' ? 1 : -1
  const field = sort.value
  return [...matchedItems.value].sort((a, b) => {
    if (field === 'name') return a.name.localeCompare(b.name) * direction
    if (field === 'bookCount') return ((a.bookCount ?? 0) - (b.bookCount ?? 0)) * direction
    return (a.displayOrder - b.displayOrder) * direction
  })
})

const resultSummary = computed(() =>
  isFiltering.value
    ? t('components.entityIndex.resultCount', { shown: formatNumber(sortedItems.value.length), total: formatNumber(props.items.length) })
    : formatNumber(props.items.length),
)

function setSortField(field: SortField) {
  sort.value = field
  order.value = 'asc'
}

function setSortOrder(direction: SortDirection) {
  order.value = direction
}

function resetSort() {
  sort.value = 'custom'
  order.value = 'asc'
}

function clearQuery() {
  query.value = ''
}

function handleAdd() {
  emit('add')
}

function itemRoute(id: number) {
  return { name: props.routeName, params: { id } }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <AppIcon :icon="titleIcon" :fallback="fallbackIcon" :size="18" class="shrink-0 text-primary" />
        <h1 class="min-w-0 truncate text-lg font-semibold text-foreground">{{ title }}</h1>
        <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ resultSummary }}</span>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex h-8 w-48 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 sm:w-64">
          <Search :size="13" aria-hidden="true" class="shrink-0 text-muted-foreground" />
          <label class="sr-only" :for="`entity-index-search-${routeName}`">{{ searchPlaceholder }}</label>
          <input
            :id="`entity-index-search-${routeName}`"
            v-model="query"
            type="text"
            :placeholder="searchPlaceholder"
            class="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            v-if="isFiltering"
            class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            :aria-label="t('components.entityIndex.clearSearch')"
            @click="clearQuery"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </div>

        <Popover>
          <PopoverTrigger
            class="flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
            :class="!isDefaultSort ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-muted'"
          >
            <ArrowUpDown :size="13" aria-hidden="true" />
            <span>{{ sortLabels[sort] }}</span>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-56 p-2">
            <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('components.entityIndex.sortBy') }}</div>
            <div class="flex flex-col gap-0.5">
              <button
                v-for="field in SORT_FIELDS"
                :key="field"
                class="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                :class="sort === field ? 'font-medium text-foreground' : 'text-muted-foreground'"
                @click="setSortField(field)"
              >
                {{ sortLabels[field] }}
                <span v-if="sort === field" class="text-xs text-primary">{{ order === 'asc' ? '↑' : '↓' }}</span>
              </button>
            </div>
            <div class="my-2 border-t border-border" />
            <div class="flex gap-1">
              <button
                v-for="direction in SORT_DIRECTIONS"
                :key="direction"
                class="flex-1 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                :class="order === direction ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'"
                @click="setSortOrder(direction)"
              >
                {{ direction === 'asc' ? t('components.entityIndex.ascending') : t('components.entityIndex.descending') }}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <button
          v-if="!isDefaultSort"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          :aria-label="t('common.resetSortAria')"
          @click="resetSort"
        >
          <X :size="13" aria-hidden="true" />
        </button>

        <button
          v-if="canAdd"
          class="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="handleAdd"
        >
          <Plus :size="13" aria-hidden="true" />
          <span>{{ addLabel }}</span>
        </button>
      </div>
    </div>

    <main class="min-h-0 flex-1 overflow-y-auto pr-2">
      <div v-if="loading && items.length === 0" class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        <div v-for="index in 12" :key="`skeleton-${index}`" class="h-24 animate-pulse rounded-lg bg-muted/50" />
      </div>

      <div v-else-if="sortedItems.length === 0" class="flex flex-col items-center justify-center gap-2 py-24 text-center">
        <p class="text-sm font-medium text-foreground">{{ isFiltering ? t('components.entityIndex.noMatches') : emptyTitle }}</p>
        <p class="text-xs text-muted-foreground">{{ isFiltering ? t('components.entityIndex.noMatchesHint') : emptyHint }}</p>
      </div>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        <RouterLink
          v-for="item in sortedItems"
          :key="item.id"
          :to="itemRoute(item.id)"
          class="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon :icon="item.icon || fallbackIcon" :fallback="fallbackIcon" :size="18" />
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-sm font-medium text-foreground">{{ item.name }}</span>
            <span v-if="typeof item.bookCount === 'number'" class="text-xs text-muted-foreground tabular-nums">
              {{ t('components.entityIndex.bookCount', { count: item.bookCount }) }}
            </span>
          </span>
        </RouterLink>
      </div>
    </main>
  </div>
</template>
