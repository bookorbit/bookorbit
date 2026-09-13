<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, LoaderCircle, Search } from '@lucide/vue'
import { findActivePdfBookmarkIndex, type FlatPdfBookmark } from '../pdf-viewer-utils'

const props = defineProps<{
  bookmarks: FlatPdfBookmark[]
  loading: boolean
  currentPage: number
}>()

const emit = defineEmits<{
  navigate: [entry: FlatPdfBookmark]
}>()

const { t } = useI18n()

const query = ref('')
const collapsed = ref(new Set<number>())
const listEl = ref<HTMLElement | null>(null)

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const activeIndex = computed(() => findActivePdfBookmarkIndex(props.bookmarks, props.currentPage))

const hasChildrenByIndex = computed(() =>
  props.bookmarks.map((entry, index) => {
    const next = props.bookmarks[index + 1]
    return next !== undefined && next.depth > entry.depth
  }),
)

/** Ancestors are the nearest preceding entries at each shallower depth. */
function ancestorsOf(index: number): number[] {
  const entry = props.bookmarks[index]
  if (!entry) return []
  const result: number[] = []
  let depth = entry.depth
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    const candidate = props.bookmarks[cursor]
    if (!candidate || candidate.depth >= depth) continue
    result.push(cursor)
    depth = candidate.depth
  }
  return result
}

const visibleRows = computed(() => {
  const search = normalizedQuery.value
  if (search) {
    return props.bookmarks
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => (entry.bookmark.title ?? '').toLowerCase().includes(search))
      .map(({ entry, index }) => ({ entry, index, expandable: false, isCollapsed: false }))
  }

  const rows: { entry: FlatPdfBookmark; index: number; expandable: boolean; isCollapsed: boolean }[] = []
  let hideBelowDepth = Number.POSITIVE_INFINITY
  for (const [index, entry] of props.bookmarks.entries()) {
    if (entry.depth > hideBelowDepth) continue
    hideBelowDepth = Number.POSITIVE_INFINITY
    const isCollapsed = collapsed.value.has(index)
    rows.push({ entry, index, expandable: hasChildrenByIndex.value[index] === true, isCollapsed })
    if (isCollapsed) hideBelowDepth = entry.depth
  }
  return rows
})

function indentStyle(depth: number) {
  return { paddingInlineStart: `${Math.min(depth, 6) * 14}px` }
}

function pageLabel(entry: FlatPdfBookmark): number | null {
  return entry.pageIndex === null ? null : entry.pageIndex + 1
}

function toggleBranch(index: number) {
  const next = new Set(collapsed.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  collapsed.value = next
}

function handleNavigate(entry: FlatPdfBookmark) {
  emit('navigate', entry)
}

async function scrollActiveIntoView() {
  await nextTick()
  const active = listEl.value?.querySelector<HTMLElement>('[data-pdf-active-bookmark]')
  active?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

// Keep the entry for the current page reachable even if the reader collapsed its branch.
watch(
  activeIndex,
  (index) => {
    if (index === null) return
    const hidden = ancestorsOf(index).filter((ancestor) => collapsed.value.has(ancestor))
    if (hidden.length === 0) return
    const next = new Set(collapsed.value)
    for (const ancestor of hidden) next.delete(ancestor)
    collapsed.value = next
  },
  { immediate: true },
)

watch([activeIndex, normalizedQuery], () => void scrollActiveIntoView(), { immediate: true, flush: 'post' })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="props.bookmarks.length > 0" class="shrink-0 border-b border-border p-3">
      <div class="relative">
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          :placeholder="t('reader.pdf.sidebar.filterOutline')"
          :aria-label="t('reader.pdf.sidebar.filterOutline')"
          class="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>

    <div v-if="props.loading" class="flex h-32 items-center justify-center text-muted-foreground" role="status" aria-live="polite">
      <LoaderCircle :size="22" class="animate-spin" />
      <span class="sr-only">{{ t('reader.pdf.sidebar.loadingOutline') }}</span>
    </div>
    <p v-else-if="props.bookmarks.length === 0" class="px-3 py-8 text-center text-xs text-muted-foreground">
      {{ t('reader.pdf.sidebar.noOutline') }}
    </p>
    <p v-else-if="visibleRows.length === 0" class="px-3 py-8 text-center text-xs text-muted-foreground">
      {{ t('reader.pdf.sidebar.noOutlineMatch') }}
    </p>
    <div v-else ref="listEl" class="min-h-0 flex-1 overflow-y-auto p-2">
      <div v-for="row in visibleRows" :key="row.index" class="relative flex items-start rounded-md" :style="indentStyle(row.entry.depth)">
        <button
          v-if="row.expandable"
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-expanded="!row.isCollapsed"
          :aria-label="
            row.isCollapsed
              ? t('reader.pdf.sidebar.expandSection', { title: row.entry.bookmark.title })
              : t('reader.pdf.sidebar.collapseSection', { title: row.entry.bookmark.title })
          "
          @click="toggleBranch(row.index)"
        >
          <ChevronDown :size="14" class="transition-transform" :class="row.isCollapsed ? '-rotate-90 rtl:rotate-90' : ''" />
        </button>
        <span v-else aria-hidden="true" class="size-7 shrink-0" />

        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="row.index === activeIndex ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground'"
          :aria-current="row.index === activeIndex ? 'location' : undefined"
          :data-pdf-active-bookmark="row.index === activeIndex ? '' : undefined"
          @click="handleNavigate(row.entry)"
        >
          <span v-if="row.index === activeIndex" aria-hidden="true" class="absolute inset-y-1 start-0 w-0.5 rounded-full bg-primary" />
          <span class="line-clamp-2 min-w-0 flex-1 break-words">{{ row.entry.bookmark.title }}</span>
          <span v-if="pageLabel(row.entry) !== null" class="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {{ pageLabel(row.entry) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
