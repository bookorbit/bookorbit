<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Command, Highlighter, Loader2, Rows2, Rows3, Search, SlidersHorizontal, Trash2, X } from '@lucide/vue'
import type { AnnotationItem } from '@bookorbit/types'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import AnnotationFiltersPanel from '@/features/annotations/components/AnnotationFiltersPanel.vue'
import { colorLabel } from '@/features/annotations/lib/filter-options'
import type { HighlightGroup } from '@/features/book/lib/highlight-groups'
import HighlightRow from './HighlightRow.vue'

type Density = 'compact' | 'comfortable'
type SortKey = 'position' | 'newest' | 'oldest'

const props = defineProps<{
  groups: HighlightGroup[]
  total: number
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  notesCount: number
  reviewCount: number
  selectedIds: Set<number>
  activeId: number | null
  density: Density
  jumpableIds: Set<number>
  hasActiveFilters: boolean
  filterCount: number
}>()

const search = defineModel<string>('search', { required: true })
const sortKey = defineModel<SortKey>('sortKey', { required: true })
const onlyNotes = defineModel<boolean>('onlyNotes', { required: true })
const onlyNeedsReview = defineModel<boolean>('onlyNeedsReview', { required: true })
const colors = defineModel<string[]>('colors', { required: true })
const dateFrom = defineModel<string>('dateFrom', { required: true })
const dateTo = defineModel<string>('dateTo', { required: true })

const emit = defineEmits<{
  open: [number]
  toggleSelect: [number]
  jump: [AnnotationItem]
  editNote: [number]
  restyle: [number]
  trash: [number]
  loadMore: []
  toggleDensity: []
  showShortcuts: []
  selectAll: []
  clearSelection: []
  bulkColor: [string]
  bulkTrash: []
  clearFilters: []
  resetAll: []
}>()

const { t } = useI18n()

const scroller = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const SORT_OPTIONS = computed(() => [
  { value: 'position' as const, label: t('book.detail.highlights.sort.position') },
  { value: 'newest' as const, label: t('book.detail.highlights.sort.newest') },
  { value: 'oldest' as const, label: t('book.detail.highlights.sort.oldest') },
])

const BULK_COLORS = ANNOTATION_HIGHLIGHT_COLORS

const selectionCount = computed(() => props.selectedIds.size)
const shownCount = computed(() => props.groups.reduce((sum, group) => sum + group.items.length, 0))
const isEmpty = computed(() => !props.loading && shownCount.value === 0)
const searching = computed(() => search.value.trim() !== '')

function groupLabel(group: HighlightGroup): string {
  if (group.label == null) return t('book.detail.highlights.uncategorized')
  if (group.mode === 'colour') return colorLabel(group.label)
  if (group.mode === 'day') {
    const date = new Date(`${group.label}T00:00:00`)
    return Number.isNaN(date.getTime()) ? group.label : formatLocaleDate(date, { year: 'numeric', month: 'long', day: 'numeric' })
  }
  return group.label
}

function handleOpen(id: number) {
  emit('open', id)
}
function handleToggleSelect(id: number) {
  emit('toggleSelect', id)
}
function handleJump(annotation: AnnotationItem) {
  emit('jump', annotation)
}
function handleEditNote(id: number) {
  emit('editNote', id)
}
function handleRestyle(id: number) {
  emit('restyle', id)
}
function handleTrash(id: number) {
  emit('trash', id)
}
function handleToggleDensity() {
  emit('toggleDensity')
}
function handleShowShortcuts() {
  emit('showShortcuts')
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
function handleClearFilters() {
  emit('clearFilters')
}
function handleResetAll() {
  emit('resetAll')
}
function handleClearSearch() {
  search.value = ''
}
function handleToggleNotes() {
  onlyNotes.value = !onlyNotes.value
}
function handleToggleReview() {
  onlyNeedsReview.value = !onlyNeedsReview.value
}
function handleShowAll() {
  onlyNotes.value = false
  onlyNeedsReview.value = false
}

/** Scrolls the open highlight into view when the inspector moves without the list being clicked. */
watch(
  () => props.activeId,
  (id) => {
    if (id == null) return
    requestAnimationFrame(() => {
      scroller.value?.querySelector<HTMLElement>(`[data-annotation="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  },
)

watch(sentinel, (element) => {
  observer?.disconnect()
  if (!element) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) emit('loadMore')
    },
    { root: scroller.value, rootMargin: '400px' },
  )
  observer.observe(element)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.highlights.stream.title')"
  >
    <div
      v-if="selectionCount > 0"
      class="flex min-h-[34px] flex-none flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-primary/10 px-3 py-1.5 2xl:h-[34px] 2xl:flex-nowrap 2xl:py-0"
    >
      <span class="whitespace-nowrap text-[11.5px] font-bold text-foreground">{{
        t('book.detail.highlights.bulk.selected', { count: selectionCount })
      }}</span>
      <button
        type="button"
        class="inline-flex h-6 items-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors pointer-coarse:h-9 hover:bg-muted hover:text-foreground"
        @click="handleSelectAll"
      >
        {{ t('book.detail.highlights.bulk.selectAll', { count: shownCount }) }}
      </button>
      <span class="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
      <div class="flex flex-wrap gap-1" role="group" :aria-label="t('book.detail.highlights.bulk.recolour')">
        <button
          v-for="option in BULK_COLORS"
          :key="option.hex"
          type="button"
          class="size-[15px] rounded-full ring-1 ring-black/25 transition-transform pointer-coarse:size-7 hover:scale-110"
          :style="{ background: option.hex }"
          :title="t('book.detail.highlights.bulk.recolourTo', { colour: option.label })"
          :aria-label="t('book.detail.highlights.bulk.recolourTo', { colour: option.label })"
          @click="() => emit('bulkColor', option.hex)"
        />
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/40 px-2 text-[11px] font-medium text-destructive transition-colors pointer-coarse:h-9 hover:bg-destructive/10"
          @click="handleBulkTrash"
        >
          <Trash2 :size="11" />
          {{ t('book.detail.highlights.trash') }}
        </button>
        <button
          type="button"
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors pointer-coarse:size-9 hover:bg-muted hover:text-foreground"
          :aria-label="t('book.detail.highlights.bulk.clear')"
          @click="handleClearSelection"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <header
      v-else
      class="flex min-h-[34px] flex-none flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-1.5 2xl:h-[34px] 2xl:flex-nowrap 2xl:py-0"
    >
      <div
        class="flex h-6 min-w-0 max-w-40 flex-1 items-center gap-1.5 rounded-md border bg-muted/50 px-2 pointer-coarse:h-9 sm:max-w-[8rem] 2xl:max-w-[17rem]"
        :class="searching ? 'border-primary/50 bg-primary/8' : 'border-border'"
      >
        <Search :size="12" class="shrink-0 text-muted-foreground" />
        <input
          v-model="search"
          type="search"
          class="h-full w-full min-w-0 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="t('book.detail.highlights.stream.searchPlaceholder', { count: total })"
        />
      </div>

      <div class="flex h-6 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 pointer-coarse:h-9" role="group">
        <button
          type="button"
          class="h-[18px] rounded px-2.5 text-[10.5px] font-semibold transition-colors pointer-coarse:h-8"
          :class="
            !onlyNotes && !onlyNeedsReview ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'
          "
          :aria-pressed="!onlyNotes && !onlyNeedsReview"
          @click="handleShowAll"
        >
          {{ t('book.detail.highlights.stream.all') }}
        </button>
        <button
          type="button"
          class="inline-flex h-[18px] items-center gap-1 rounded px-2.5 text-[10.5px] font-semibold transition-colors pointer-coarse:h-8"
          :class="onlyNotes ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="onlyNotes"
          @click="handleToggleNotes"
        >
          {{ t('book.detail.highlights.stream.notes') }}
          <b class="font-bold tabular-nums">{{ notesCount }}</b>
        </button>
        <button
          v-if="reviewCount > 0"
          type="button"
          class="inline-flex h-[18px] items-center gap-1 rounded px-2.5 text-[10.5px] font-semibold transition-colors pointer-coarse:h-8"
          :class="onlyNeedsReview ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="onlyNeedsReview"
          @click="handleToggleReview"
        >
          <span class="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          {{ t('book.detail.highlights.stream.review') }}
          <b class="font-bold tabular-nums">{{ reviewCount }}</b>
        </button>
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <label class="sr-only" for="highlights-sort">{{ t('annotations.toolbar.sortOrder') }}</label>
        <select
          id="highlights-sort"
          v-model="sortKey"
          class="h-6 rounded-md border border-border bg-muted/50 px-1.5 text-[11px] font-medium text-muted-foreground transition-colors pointer-coarse:h-9 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="hidden size-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors pointer-fine:grid hover:bg-muted hover:text-foreground"
              :aria-label="t('book.detail.highlights.stream.density')"
              @click="handleToggleDensity"
            >
              <Rows3 v-if="density === 'compact'" :size="12" />
              <Rows2 v-else :size="12" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.highlights.stream.density') }}</TooltipContent>
        </Tooltip>

        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="relative grid size-6 place-items-center rounded-md border text-muted-foreground transition-colors pointer-coarse:size-9 hover:bg-muted hover:text-foreground"
              :class="filterCount > 0 ? 'border-primary/50 bg-primary/12 text-primary' : 'border-border'"
              :aria-label="t('annotations.toolbar.filters')"
            >
              <SlidersHorizontal :size="12" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-80">
            <AnnotationFiltersPanel v-model:colors="colors" v-model:date-from="dateFrom" v-model:date-to="dateTo" @clear-all="handleClearFilters" />
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="hidden size-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors pointer-fine:grid hover:bg-muted hover:text-foreground"
              :aria-label="t('book.detail.highlights.shortcuts.title')"
              @click="handleShowShortcuts"
            >
              <Command :size="12" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('book.detail.highlights.shortcuts.title') }}</TooltipContent>
        </Tooltip>
      </div>
    </header>

    <div v-if="hasActiveFilters" class="flex flex-none flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
      <span class="text-[11px] text-muted-foreground">{{ t('book.detail.highlights.stream.matchCount', { shown: total, total: total }) }}</span>
      <span
        v-if="searching"
        class="inline-flex h-5 items-center gap-1.5 rounded-md border border-border bg-muted/50 pl-2 pr-1 text-[10.5px] text-foreground"
      >
        {{ t('book.detail.highlights.stream.textChip', { query: search }) }}
        <button
          type="button"
          class="grid size-3.5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="t('annotations.filters.clearAll')"
          @click="handleClearSearch"
        >
          <X :size="9" />
        </button>
      </span>
      <button
        type="button"
        class="ml-auto text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        @click="handleResetAll"
      >
        {{ t('annotations.filters.clearAll') }}
      </button>
    </div>

    <div ref="scroller" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2.5 pt-1 [scrollbar-gutter:stable]">
      <div v-if="isEmpty" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
        <span class="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Highlighter :size="18" />
        </span>
        <p class="text-[12.5px] font-semibold text-foreground">{{ t('book.detail.highlights.empty.noMatch') }}</p>
        <button
          type="button"
          class="mt-1 inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="handleResetAll"
        >
          {{ t('book.detail.highlights.empty.resetFilters') }}
        </button>
      </div>

      <template v-for="group in groups" :key="group.key">
        <div
          class="sticky top-0 z-[3] flex h-[26px] items-center gap-2 bg-gradient-to-b from-card from-[74%] to-transparent pt-2 first:h-[22px] first:pt-0.5"
        >
          <span class="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
            <span v-if="group.colour" class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: group.colour }" aria-hidden="true" />
            <span v-if="group.index != null" class="font-bold text-muted-foreground tabular-nums">{{ group.index }}</span>
            <span class="truncate">{{ groupLabel(group) }}</span>
          </span>
          <span class="h-px flex-1 bg-border" aria-hidden="true" />
          <span class="whitespace-nowrap text-[9.5px] font-bold text-muted-foreground tabular-nums">
            {{ t('book.detail.highlights.stream.marks', group.total) }}
          </span>
        </div>

        <HighlightRow
          v-for="annotation in group.items"
          :key="annotation.id"
          :data-annotation="annotation.id"
          class="border-t border-border/50 first:border-t-0"
          :annotation="annotation"
          :selected="selectedIds.has(annotation.id)"
          :active="activeId === annotation.id"
          :density="density"
          :can-jump="jumpableIds.has(annotation.id)"
          :picking="selectionCount > 0"
          @open="handleOpen"
          @toggle-select="handleToggleSelect"
          @jump="handleJump"
          @edit-note="handleEditNote"
          @restyle="handleRestyle"
          @trash="handleTrash"
        />
      </template>

      <div v-if="hasMore" ref="sentinel" class="flex h-10 flex-none items-center justify-center text-[11px] text-muted-foreground">
        <Loader2 v-if="loadingMore" class="size-3.5 animate-spin motion-reduce:animate-none" />
        <span v-else>{{ t('book.detail.highlights.stream.loadingMore') }}</span>
      </div>
    </div>
  </section>
</template>
