<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Bookmark, BookOpen, Highlighter, Trash2, TriangleAlert } from '@lucide/vue'
import { ANNOTATION_COLOR_FILTER_OPTIONS } from '@bookorbit/types'
import type { TocItem } from '../composables/useToc'
import type { Bookmark as BookmarkType } from '../composables/useBookmarks'
import type { Annotation } from '../composables/useAnnotations'
import { stripFragment, findNearestCfi, formatCfiLocation, formatDate, getCfiSortKey } from '../utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  chapters: TocItem[]
  bookmarks: BookmarkType[]
  annotations: Annotation[]
  currentCfi: string | null
  locationMetaByCfi: Record<string, { chapterTitle: string | null; percentage: number | null }>
  activeHref: string
  expandedHrefs: Set<string>
}>()

const emit = defineEmits<{
  close: []
  navigateChapter: [href: string]
  navigateBookmark: [cfi: string]
  navigateAnnotation: [cfi: string]
  navigateAnnotationChapter: [chapterIndex: number]
  deleteBookmark: [id: number]
  deleteAnnotation: [id: number]
  toggleExpand: [href: string]
}>()

type Tab = 'chapters' | 'bookmarks' | 'highlights'
const activeTab = ref<Tab>('chapters')
const scrollContainer = ref<HTMLElement | null>(null)
type SortMode = 'location' | 'newest' | 'oldest'
const bookmarkQuery = ref('')
const bookmarkSort = ref<SortMode>('location')
const highlightQuery = ref('')
const highlightSort = ref<SortMode>('location')
const highlightColorFilter = ref('all')
const highlightChapterFilter = ref('all')
const highlightNotesOnly = ref(false)

const HIGHLIGHT_COLOR_META = Object.fromEntries(ANNOTATION_COLOR_FILTER_OPTIONS.map((color) => [color.hex, { label: color.label }])) as Record<
  string,
  { label: string }
>

function getHighlightColorLabel(color: string): string {
  const normalized = color.trim().toUpperCase()
  return HIGHLIGHT_COLOR_META[normalized]?.label ?? `Custom (${normalized})`
}

const highlightColorOptions = computed(() =>
  Array.from(new Set(props.annotations.map((ann) => ann.color)))
    .map((hex) => ({ hex, label: getHighlightColorLabel(hex) }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)
const highlightChapterOptions = computed(() =>
  Array.from(new Set(props.annotations.map((ann) => getContextChapter(ann)).filter((value): value is string => !!value))).sort((a, b) =>
    a.localeCompare(b),
  ),
)

const filteredAndSortedBookmarks = computed(() => {
  const q = bookmarkQuery.value.trim().toLowerCase()
  const filtered = props.bookmarks.filter((bm) => {
    if (!q) return true
    const haystack = `${bm.title ?? ''} ${getBookmarkContextLine(bm)} ${formatCfiLocation(bm.cfi) ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
  return sortByMode(filtered, bookmarkSort.value)
})

const filteredAndSortedHighlights = computed(() => {
  const q = highlightQuery.value.trim().toLowerCase()
  const filtered = props.annotations.filter((ann) => {
    if (highlightColorFilter.value !== 'all' && ann.color !== highlightColorFilter.value) return false
    const chapterLabel = getContextChapter(ann)
    if (highlightChapterFilter.value !== 'all' && chapterLabel !== highlightChapterFilter.value) return false
    if (highlightNotesOnly.value && !ann.note?.trim()) return false
    if (!q) return true
    const haystack = `${ann.text} ${ann.note ?? ''} ${chapterLabel ?? ''} ${getHighlightContextLine(ann)}`.toLowerCase()
    return haystack.includes(q)
  })
  return sortByMode(filtered, highlightSort.value)
})

const activeBookmarkId = computed(() => findNearestCfi(filteredAndSortedBookmarks.value, props.currentCfi)?.id ?? null)
const activeAnnotationId = computed(() => findNearestCfi(filteredAndSortedHighlights.value, props.currentCfi)?.id ?? null)
const activeRowSelectorByTab: Record<Tab, string> = {
  chapters: '[data-reader-active-row="chapter"]',
  bookmarks: '[data-reader-active-row="bookmark"]',
  highlights: '[data-reader-active-row="highlight"]',
}

async function scrollActiveSidebarRow() {
  await nextTick()
  const activeRow = scrollContainer.value?.querySelector<HTMLElement>(activeRowSelectorByTab[activeTab.value])
  if (!activeRow || typeof activeRow.scrollIntoView !== 'function') return
  activeRow.scrollIntoView({ block: 'center', inline: 'nearest' })
}

watch(
  () => [activeTab.value, props.activeHref, props.currentCfi, props.chapters, props.bookmarks, props.annotations, props.expandedHrefs] as const,
  () => {
    void scrollActiveSidebarRow()
  },
  { immediate: true, flush: 'post' },
)

function getLocationLabel(cfi: string | null | undefined): string {
  return formatCfiLocation(cfi) ?? 'Location unavailable'
}

function getContextChapter(item: { cfi: string | null | undefined; chapterTitle?: string | null }): string | null {
  const fromMap = item.cfi ? props.locationMetaByCfi[item.cfi]?.chapterTitle : null
  const fromItem = item.chapterTitle ?? null
  return fromMap || fromItem || null
}

function getContextPercent(cfi: string | null | undefined): string | null {
  if (!cfi) return null
  const percentage = props.locationMetaByCfi[cfi]?.percentage
  if (typeof percentage !== 'number') return null
  return `${percentage}%`
}

function joinContext(parts: Array<string | null>): string {
  const usable = parts.filter((value): value is string => Boolean(value))
  return usable.join(' - ')
}

function getBookmarkContextLine(bm: BookmarkType): string {
  const context = joinContext([getContextChapter(bm), getContextPercent(bm.cfi)])
  return context || getLocationLabel(bm.cfi)
}

function getHighlightContextLine(ann: Annotation): string {
  const context = joinContext([getContextChapter(ann), getContextPercent(ann.cfi)])
  return context || getLocationLabel(ann.cfi)
}

function toCreatedAt(row: { createdAt: string }): number {
  const value = Date.parse(row.createdAt)
  return Number.isFinite(value) ? value : 0
}

function toLocationKey(row: { cfi: string | null | undefined }): bigint | null {
  return getCfiSortKey(row.cfi)
}

function sortByMode<T extends { cfi: string | null | undefined; createdAt: string }>(items: T[], mode: SortMode): T[] {
  const sorted = [...items]
  if (mode === 'newest') {
    sorted.sort((a, b) => toCreatedAt(b) - toCreatedAt(a))
    return sorted
  }
  if (mode === 'oldest') {
    sorted.sort((a, b) => toCreatedAt(a) - toCreatedAt(b))
    return sorted
  }
  sorted.sort((a, b) => {
    const aKey = toLocationKey(a)
    const bKey = toLocationKey(b)
    if (aKey != null && bKey != null) return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    if (aKey != null) return -1
    if (bKey != null) return 1
    return toCreatedAt(a) - toCreatedAt(b)
  })
  return sorted
}

function navigateBookmark(cfi: string | null | undefined) {
  if (!cfi) return
  emit('navigateBookmark', cfi)
}

function navigateAnnotation(ann: Annotation) {
  if (ann.cfi) {
    emit('navigateAnnotation', ann.cfi)
    return
  }
  if (ann.chapterIndex != null) {
    emit('navigateAnnotationChapter', ann.chapterIndex)
  }
}

function isApproximateAnnotation(ann: Annotation): boolean {
  return ann.cfi == null
}

function deleteBookmark(id: number) {
  emit('deleteBookmark', id)
}

function deleteAnnotation(id: number) {
  emit('deleteAnnotation', id)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex">
    <div
      class="sidebar-panel w-[19rem] sm:w-[20rem] md:w-[21.5rem] lg:w-[22.5rem] h-full bg-card text-card-foreground flex flex-col shadow-2xl border-r border-border"
      @click.stop
    >
      <div class="flex items-stretch border-b border-border shrink-0">
        <button
          v-for="tab in [
            { id: 'chapters', icon: BookOpen, label: 'Chapters' },
            { id: 'bookmarks', icon: Bookmark, label: 'Bookmarks' },
            { id: 'highlights', icon: Highlighter, label: 'Highlights' },
          ] as const"
          :key="tab.id"
          class="flex-1 flex items-center justify-center gap-1 py-2.5 text-[13px] relative transition-colors"
          :class="activeTab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" :size="16" />
          {{ tab.label }}
          <span v-if="activeTab === tab.id" class="absolute bottom-0 inset-x-0 h-0.5 bg-primary rounded-t-full" />
        </button>
      </div>

      <div ref="scrollContainer" class="flex-1 overflow-y-auto">
        <template v-if="activeTab === 'chapters'">
          <TocList
            :items="chapters"
            :activeHref="activeHref"
            :expandedHrefs="expandedHrefs"
            :depth="0"
            @navigate="emit('navigateChapter', $event)"
            @toggleExpand="emit('toggleExpand', $event)"
          />
          <div v-if="chapters.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No chapters found</div>
        </template>

        <template v-if="activeTab === 'bookmarks'">
          <div v-if="bookmarks.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No bookmarks yet</div>
          <template v-else>
            <div class="sticky top-0 z-10 border-b border-border/70 bg-card/95 backdrop-blur px-3 py-3 space-y-2">
              <input
                v-model="bookmarkQuery"
                type="text"
                placeholder="Search bookmarks..."
                class="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
              />
              <div class="flex items-center gap-2">
                <select
                  v-model="bookmarkSort"
                  class="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none focus:border-primary"
                >
                  <option value="location">Reading order</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                <span class="text-[11px] text-muted-foreground tabular-nums">{{ filteredAndSortedBookmarks.length }}</span>
              </div>
            </div>
            <ul v-if="filteredAndSortedBookmarks.length > 0" class="divide-y divide-border">
              <li
                v-for="bm in filteredAndSortedBookmarks"
                :key="bm.id"
                class="flex items-start gap-2.5 px-3 py-2.5 group transition-colors"
                :class="bm.id === activeBookmarkId ? 'bg-primary/10 ring-1 ring-primary/25' : 'hover:bg-muted/50'"
                :data-reader-active-row="bm.id === activeBookmarkId ? 'bookmark' : undefined"
              >
                <button type="button" class="flex flex-1 min-w-0 items-start gap-2.5 text-left cursor-pointer" @click="navigateBookmark(bm.cfi)">
                  <Bookmark :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
                  <div class="flex-1 min-w-0">
                    <p class="text-[13px] font-medium leading-snug truncate">{{ bm.title || 'Bookmark' }}</p>
                    <p class="text-[11px] text-muted-foreground mt-0.5">{{ getBookmarkContextLine(bm) }}</p>
                    <p class="text-[11px] text-muted-foreground mt-0.5">{{ formatDate(bm.createdAt) }}</p>
                  </div>
                </button>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                      @click.stop="deleteBookmark(bm.id)"
                    >
                      <Trash2 :size="13" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete bookmark</TooltipContent>
                </Tooltip>
              </li>
            </ul>
            <div v-else class="px-4 py-8 text-center text-sm text-muted-foreground">No bookmarks match your filters</div>
          </template>
        </template>

        <template v-if="activeTab === 'highlights'">
          <div v-if="annotations.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">No highlights yet</div>
          <template v-else>
            <div class="sticky top-0 z-10 border-b border-border/70 bg-card/95 backdrop-blur px-3 py-3 space-y-2">
              <input
                v-model="highlightQuery"
                type="text"
                placeholder="Search highlights..."
                class="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
              />
              <div class="grid grid-cols-2 gap-2">
                <select
                  v-model="highlightSort"
                  class="h-8 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none focus:border-primary"
                >
                  <option value="location">Reading order</option>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                <select
                  v-model="highlightColorFilter"
                  class="h-8 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none focus:border-primary"
                >
                  <option value="all">All colors</option>
                  <option v-for="color in highlightColorOptions" :key="color.hex" :value="color.hex">{{ color.label }}</option>
                </select>
                <select
                  v-model="highlightChapterFilter"
                  class="col-span-2 h-8 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground outline-none focus:border-primary"
                >
                  <option value="all">All chapters</option>
                  <option v-for="chapter in highlightChapterOptions" :key="chapter" :value="chapter">{{ chapter }}</option>
                </select>
              </div>
              <label class="flex items-center gap-2 text-xs text-muted-foreground">
                <input v-model="highlightNotesOnly" type="checkbox" class="h-3.5 w-3.5 rounded border-border accent-primary" />
                Notes only
                <span class="ml-auto tabular-nums">{{ filteredAndSortedHighlights.length }}</span>
              </label>
            </div>

            <ul v-if="filteredAndSortedHighlights.length > 0" class="divide-y divide-border">
              <li
                v-for="ann in filteredAndSortedHighlights"
                :key="ann.id"
                class="px-3 py-2.5 group transition-colors"
                :class="ann.id === activeAnnotationId ? 'bg-primary/10 ring-1 ring-primary/25' : 'hover:bg-muted/50'"
                :data-reader-active-row="ann.id === activeAnnotationId ? 'highlight' : undefined"
              >
                <div class="flex items-start gap-2">
                  <button type="button" class="flex flex-1 min-w-0 items-start gap-2 text-left cursor-pointer" @click="navigateAnnotation(ann)">
                    <span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: ann.color }" />
                    <div class="flex-1 min-w-0">
                      <p class="text-[13px] leading-relaxed line-clamp-3">{{ ann.text }}</p>
                      <p class="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Tooltip v-if="isApproximateAnnotation(ann)">
                          <TooltipTrigger as-child>
                            <TriangleAlert :size="11" class="shrink-0 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>Synced from device; exact position unavailable, jumps to the chapter</TooltipContent>
                        </Tooltip>
                        <span>{{ getHighlightContextLine(ann) }}</span>
                      </p>
                      <p class="text-[11px] text-muted-foreground mt-0.5">{{ formatDate(ann.createdAt) }}</p>
                      <p v-if="ann.note" class="text-[11px] text-muted-foreground mt-1 italic">{{ ann.note }}</p>
                    </div>
                  </button>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                        @click.stop="deleteAnnotation(ann.id)"
                      >
                        <Trash2 :size="13" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete highlight</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            </ul>
            <div v-else class="px-4 py-8 text-center text-sm text-muted-foreground">No highlights match your filters</div>
          </template>
        </template>
      </div>
    </div>
    <div class="flex-1" @click="emit('close')" />
  </div>
</template>

<script lang="ts">
import { defineComponent, h, type VNode, type Component } from 'vue'
import { ChevronDown, ChevronRight } from '@lucide/vue'

interface LocalTocItem {
  label: string
  href: string
  subitems?: LocalTocItem[]
}

const TocList = defineComponent({
  name: 'TocList',
  props: {
    items: { type: Array as () => LocalTocItem[], required: true },
    activeHref: { type: String, required: true },
    expandedHrefs: { type: Object as () => Set<string>, required: true },
    depth: { type: Number, default: 0 },
  },
  emits: ['navigate', 'toggleExpand'],
  setup(props, { emit }) {
    function isActive(href: string): boolean {
      return stripFragment(props.activeHref) === stripFragment(href)
    }

    return (): VNode =>
      h(
        'ul',
        { class: 'py-1' },
        props.items.map((item) => {
          const hasChildren = item.subitems && item.subitems.length > 0
          const expanded = props.expandedHrefs.has(item.href)
          const active = isActive(item.href)

          return h('li', { key: item.href }, [
            h(
              'button',
              {
                class: [
                  'w-full text-left flex items-center gap-1 px-3 py-1.5 text-[13px] leading-snug transition-colors hover:bg-muted/50',
                  active ? 'text-primary font-medium bg-primary/8' : 'text-foreground',
                ],
                'data-reader-active-row': active ? 'chapter' : undefined,
                'aria-current': active ? 'location' : undefined,
                style: { paddingLeft: `${12 + props.depth * 10}px` },
                onClick: () => {
                  emit('navigate', item.href)
                },
              },
              [
                hasChildren
                  ? h(
                      'span',
                      {
                        class: 'shrink-0',
                        onClick: (e: Event) => {
                          e.stopPropagation()
                          emit('toggleExpand', item.href)
                        },
                      },
                      [expanded ? h(ChevronDown as Component, { size: 14 }) : h(ChevronRight as Component, { size: 12 })],
                    )
                  : h('span', { class: 'w-3.5 shrink-0' }),
                h('span', { class: 'truncate' }, item.label),
              ],
            ),
            hasChildren && expanded
              ? h(TocList as Component, {
                  items: item.subitems!,
                  activeHref: props.activeHref,
                  expandedHrefs: props.expandedHrefs,
                  depth: props.depth + 1,
                  onNavigate: (href: string) => emit('navigate', href),
                  onToggleExpand: (href: string) => emit('toggleExpand', href),
                })
              : null,
          ])
        }),
      )
  },
})
</script>

<style scoped>
.sidebar-panel {
  animation: slideInFromLeft 0.25s ease;
}

@keyframes slideInFromLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
</style>
