<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Loader2, MoreHorizontal, Rows2, Rows3, RotateCcw, Search, SlidersHorizontal, StickyNote, Trash2, X } from '@lucide/vue'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubBookFacet } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import AnnotationFiltersPanel from '../AnnotationFiltersPanel.vue'
import AnnotationBookCombobox from '../AnnotationBookCombobox.vue'
import { STYLE_OPTIONS } from '../../lib/filter-options'
import AnnotationGroupRule from './AnnotationGroupRule.vue'
import { dayKey } from '../../lib/hub-groups'
import type { StreamGroup, StreamViewOption } from '../../lib/stream-groups'
import type { HubChip } from '../../lib/hub-chips'

const props = defineProps<{
  /** Already grouped by the page, which owns the axes it offers. */
  groups: StreamGroup[]
  loadedCount: number
  total: number
  view: string
  viewOptions: StreamViewOption[]
  /** False on a page that is already about one book, so the margin leads with the chapter. */
  showBook: boolean
  stacked: boolean
  compact: boolean
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  trashed: boolean
  notesOnly: boolean
  needsReviewOnly: boolean
  noteCount: number
  reviewCount: number
  filtered: boolean
  chips: HubChip[]
  selectionCount: number
  /** Only the library hub filters by book; a book page leaves this out. */
  searchBooks?: (q: string) => Promise<AnnotationHubBookFacet[]>
  /** The per-book route carries no style filter, so it does not offer the control. */
  showStyleFilter?: boolean
  /** True while the group rule already names the chapter, so the margin stops repeating it. */
  chapterInRule?: boolean
}>()

const search = defineModel<string>('search', { required: true })
const colors = defineModel<string[]>('colors', { required: true })
const dateFrom = defineModel<string>('dateFrom', { required: true })
const dateTo = defineModel<string>('dateTo', { required: true })
const styleFilter = defineModel<string>('styleFilter', { default: 'all' })
const bookFilter = defineModel<number | 'all'>('bookFilter', { default: 'all' })
const bookFilterLabel = defineModel<string | null>('bookFilterLabel', { default: null })

const emit = defineEmits<{
  'update:view': [value: string]
  toggleNotes: []
  toggleReview: []
  toggleDensity: []
  removeChip: [id: string]
  clearTrash: []
  resetFilters: []
  loadMore: []
  export: [format: 'md' | 'csv' | 'json']
  selectAll: []
  clearSelection: []
  bulkColor: [color: string]
  bulkTrash: []
  bulkRestore: []
}>()

const { t } = useI18n()

const groups = computed(() => props.groups)
const isEmpty = computed(() => props.groups.every((group) => group.items.length === 0))
const remaining = computed(() => Math.max(0, props.total - props.loadedCount))
const bulkColors = computed(() => ANNOTATION_HIGHLIGHT_COLORS.slice(0, 6))

/**
 * The date rail prints a day once per run, and inside a book group the margin prints a
 * chapter once per run. Both are decided here, where the previous row is known.
 */
function isFirstOfDay(groupIndex: number, itemIndex: number): boolean {
  const group = groups.value[groupIndex]
  if (!group) return true
  const previous = group.items[itemIndex - 1]
  if (!previous) return true
  return dayKey(previous.createdAt) !== dayKey(group.items[itemIndex]!.createdAt)
}

function isFirstOfChapter(groupIndex: number, itemIndex: number): boolean {
  const group = groups.value[groupIndex]
  if (!group) return true
  const previous = group.items[itemIndex - 1]
  if (!previous) return true
  return (previous.chapterTitle ?? '') !== (group.items[itemIndex]!.chapterTitle ?? '')
}

function handleViewChange(event: Event) {
  emit('update:view', (event.target as HTMLSelectElement).value)
}

function handleClearSearch() {
  search.value = ''
}

function handleToggleNotes() {
  emit('toggleNotes')
}

function handleToggleReview() {
  emit('toggleReview')
}

function handleToggleDensity() {
  emit('toggleDensity')
}

function handleLoadMore() {
  emit('loadMore')
}

function handleResetFilters() {
  emit('resetFilters')
}

function handleClearBookFilter() {
  bookFilter.value = 'all'
  bookFilterLabel.value = null
}

function handleClearTrash() {
  emit('clearTrash')
}

function handleSelectAll() {
  emit('selectAll')
}

function handleClearSelection() {
  emit('clearSelection')
}

function handleBulkTrash() {
  emit('bulkTrash')
}

function handleBulkRestore() {
  emit('bulkRestore')
}

function handleExportMarkdown() {
  emit('export', 'md')
}

function handleExportCsv() {
  emit('export', 'csv')
}

function handleExportJson() {
  emit('export', 'json')
}

function handleClearFilters() {
  emit('resetFilters')
}
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
    <!-- Selection replaces the header rather than adding a row, so it costs nothing at rest. -->
    <div v-if="selectionCount > 0" class="flex h-[42px] flex-none items-center gap-2 overflow-x-auto border-b border-border bg-primary/10 px-3">
      <span class="shrink-0 text-[11.5px] font-bold text-foreground">{{ t('annotations.bulk.countSelected', { count: selectionCount }) }}</span>
      <span class="h-4 w-px shrink-0 bg-border" />
      <div v-if="!trashed" class="flex shrink-0 gap-1">
        <button
          v-for="color in bulkColors"
          :key="color.hex"
          type="button"
          class="size-[15px] rounded-full border border-black/25 transition-transform hover:scale-110"
          :style="{ backgroundColor: color.hex }"
          :aria-label="t('annotations.bulk.recolorTo', { color: color.label })"
          @click="emit('bulkColor', color.hex)"
        />
      </div>
      <Button variant="outline" size="sm" class="h-7 shrink-0 px-2.5 text-[11px]" @click="handleSelectAll">{{
        t('annotations.bulk.selectPage')
      }}</Button>
      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <Button v-if="trashed" variant="outline" size="sm" class="h-7 px-2.5 text-[11px]" @click="handleBulkRestore">
          {{ t('annotations.hub.bulkRestore') }}
        </Button>
        <Button v-else variant="destructive" size="sm" class="h-7 gap-1.5 px-2.5 text-[11px]" @click="handleBulkTrash">
          <Trash2 :size="11" />
          {{ t('annotations.hub.bulkTrash') }}
        </Button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.bulk.clear')"
          @click="handleClearSelection"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <div v-else class="flex flex-none flex-wrap items-center gap-2 border-b border-border px-3 py-2 xl:h-[42px] xl:flex-nowrap xl:py-0">
      <label
        class="flex h-7 min-w-0 basis-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 sm:basis-0 sm:flex-1 xl:max-w-[24rem]"
        :class="search ? 'border-primary/55 bg-primary/[0.08]' : 'border-border'"
      >
        <Search :size="13" class="shrink-0 text-muted-foreground" />
        <input
          v-model="search"
          type="search"
          :placeholder="t('annotations.toolbar.searchPlaceholder')"
          :aria-label="t('annotations.toolbar.searchPlaceholder')"
          class="h-full w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          v-if="search"
          type="button"
          class="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.bulk.clear')"
          @click="handleClearSearch"
        >
          <X :size="9" />
        </button>
      </label>

      <div class="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors"
          :class="notesOnly ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="notesOnly"
          @click="handleToggleNotes"
        >
          <StickyNote :size="11" />
          {{ t('annotations.hub.notes') }}
          <b class="font-bold">{{ formatNumber(noteCount) }}</b>
        </button>
        <button
          v-if="reviewCount > 0"
          type="button"
          class="inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors"
          :class="needsReviewOnly ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="needsReviewOnly"
          @click="handleToggleReview"
        >
          <span class="size-1.5 rounded-full bg-[var(--pill-repaired)]" />
          {{ t('annotations.hub.review') }}
          <b class="font-bold">{{ formatNumber(reviewCount) }}</b>
        </button>
      </div>

      <label class="sr-only" for="hub-view">{{ t('annotations.hub.viewLabel') }}</label>
      <select
        id="hub-view"
        :value="view"
        class="h-7 shrink-0 rounded-md border border-border bg-muted/40 px-2 text-[11.5px] font-semibold text-muted-foreground outline-none"
        @change="handleViewChange"
      >
        <option v-for="option in viewOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>

      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <span v-if="filtered" class="whitespace-nowrap text-[10.5px] font-semibold text-primary">
          {{ t('annotations.hub.matchCount', { shown: formatNumber(loadedCount), total: formatNumber(total) }) }}
        </span>
        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="relative grid size-7 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground"
              :aria-label="t('annotations.toolbar.filters')"
            >
              <SlidersHorizontal :size="12" />
              <span
                v-if="chips.length > 0"
                class="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground"
              >
                {{ chips.length }}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-80">
            <AnnotationFiltersPanel v-model:colors="colors" v-model:date-from="dateFrom" v-model:date-to="dateTo" @clear-all="handleClearFilters">
              <template #extra>
                <label v-if="searchBooks" class="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  {{ t('annotations.hub.book') }}
                  <AnnotationBookCombobox v-model="bookFilter" v-model:selected-label="bookFilterLabel" :search-fn="searchBooks" />
                </label>
                <label v-if="showStyleFilter" class="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  {{ t('annotations.hub.style') }}
                  <select v-model="styleFilter" class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </template>
            </AnnotationFiltersPanel>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground"
          :aria-label="compact ? t('annotations.toolbar.switchToComfortable') : t('annotations.toolbar.switchToCompact')"
          @click="handleToggleDensity"
        >
          <component :is="compact ? Rows3 : Rows2" :size="12" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground"
              :aria-label="t('annotations.hub.export')"
            >
              <Download :size="12" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="handleExportMarkdown">{{ t('annotations.hub.exportMarkdown') }}</DropdownMenuItem>
            <DropdownMenuItem @click="handleExportCsv">{{ t('annotations.hub.exportCsv') }}</DropdownMenuItem>
            <DropdownMenuItem @click="handleExportJson">{{ t('annotations.hub.exportJson') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground"
              :aria-label="t('annotations.hub.moreActions')"
            >
              <MoreHorizontal :size="12" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="handleSelectAll">{{ t('annotations.bulk.selectPage') }}</DropdownMenuItem>
            <DropdownMenuItem v-if="filtered" @click="handleResetFilters">{{ t('annotations.hub.empty.resetFilters') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div
      v-if="trashed || chips.length > 0 || bookFilterLabel || notesOnly || needsReviewOnly"
      class="flex flex-none flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5"
    >
      <span
        v-if="trashed"
        class="inline-flex h-[19px] items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        <Trash2 :size="10" />
        {{ t('annotations.hub.tabs.trash') }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.bulk.clear')"
          @click="handleClearTrash"
        >
          <X :size="9" />
        </button>
      </span>
      <span
        v-if="needsReviewOnly"
        class="inline-flex h-[19px] items-center gap-1.5 rounded-md border border-[var(--pill-repaired)]/40 bg-[var(--pill-repaired)]/10 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        <span class="size-2 rounded-full bg-[var(--pill-repaired)]" />
        {{ t('annotations.hub.needsReview') }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.chips.removeFilter', { label: t('annotations.hub.needsReview') })"
          @click="handleToggleReview"
        >
          <X :size="9" />
        </button>
      </span>
      <span
        v-if="notesOnly"
        class="inline-flex h-[19px] items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        <StickyNote :size="10" />
        {{ t('annotations.hub.notes') }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.chips.removeFilter', { label: t('annotations.hub.notes') })"
          @click="handleToggleNotes"
        >
          <X :size="9" />
        </button>
      </span>
      <span
        v-for="chip in chips"
        :key="chip.id"
        class="inline-flex h-[19px] items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        <span v-if="chip.swatch" class="size-2 rounded-full" :style="{ backgroundColor: chip.swatch }" />
        {{ chip.label }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.bulk.clear')"
          @click="emit('removeChip', chip.id)"
        >
          <X :size="9" />
        </button>
      </span>
      <span
        v-if="bookFilterLabel"
        class="inline-flex h-[19px] items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        {{ bookFilterLabel }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('annotations.chips.removeFilter', { label: bookFilterLabel })"
          @click="handleClearBookFilter"
        >
          <X :size="9" />
        </button>
      </span>
      <button
        v-if="filtered"
        type="button"
        class="ml-auto inline-flex h-[19px] items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        @click="handleResetFilters"
      >
        <RotateCcw :size="10" />
        {{ t('annotations.chips.clearAll') }}
      </button>
    </div>

    <div class="min-h-0 flex-1 px-3 pt-1.5 sm:px-5 xl:overflow-y-auto xl:[scrollbar-gutter:stable]">
      <!-- Never a skeleton on refetch: filters and group changes reload constantly. -->
      <div v-if="loading && isEmpty" class="flex flex-col gap-2 py-2">
        <div v-for="index in 6" :key="index" class="h-20 animate-shimmer rounded-lg bg-muted" />
      </div>

      <div v-else-if="isEmpty" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p class="text-[12.5px] font-semibold text-foreground">
          {{ filtered ? t('annotations.hub.empty.noMatch') : t('annotations.hub.empty.trashEmpty') }}
        </p>
        <p class="max-w-[34ch] text-[11.5px] leading-relaxed text-muted-foreground">{{ t('annotations.hub.empty.noMatchHint') }}</p>
        <Button v-if="filtered" variant="outline" size="sm" class="mt-1 gap-1.5" @click="handleResetFilters">
          <RotateCcw :size="11" />
          {{ t('annotations.hub.empty.resetFilters') }}
        </Button>
      </div>

      <div v-else class="mx-auto w-full" :class="stacked ? '' : 'max-w-[66rem]'">
        <template v-for="(group, groupIndex) in groups" :key="group.key">
          <AnnotationGroupRule :group="group" />
          <slot
            v-for="(item, itemIndex) in group.items"
            name="entry"
            :item="item"
            :show-day="isFirstOfDay(groupIndex, itemIndex)"
            :show-book="showBook && group.book == null"
            :show-chapter="!chapterInRule && isFirstOfChapter(groupIndex, itemIndex)"
          />
        </template>

        <div v-if="hasMore" class="flex justify-center py-4">
          <Button variant="outline" size="sm" :disabled="loadingMore" class="gap-1.5" @click="handleLoadMore">
            <Loader2 v-if="loadingMore" :size="12" class="animate-spin" />
            {{ t('annotations.hub.loadMore', { count: remaining }) }}
          </Button>
        </div>
      </div>
    </div>
  </section>
</template>
