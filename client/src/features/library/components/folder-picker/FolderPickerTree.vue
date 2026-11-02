<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { formatNumber } from '@/i18n/formatters'
import { normalizeFolderPath } from '../../composables/folder-paths'
import { ancestorsWithin, isInside, parentPath } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import type { TreeRow } from '../../composables/folder-picker/useFolderPickerTree'
import FolderPickerNewFolderRow from './FolderPickerNewFolderRow.vue'
import FolderPickerToolbar from './FolderPickerToolbar.vue'
import FolderPickerTreeRow from './FolderPickerTreeRow.vue'
import PickerKbd from './PickerKbd.vue'

const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const picker = useFolderPickerContext()
const tree = picker.tree

const scroller = ref<{ $el: HTMLElement } | null>(null)
const toolbar = ref<InstanceType<typeof FolderPickerToolbar> | null>(null)
const sticky = ref<TreeRow[]>([])
const rowHeight = computed(() => (picker.phone.value ? 44 : 32))
const padTop = computed(() => (picker.phone.value ? 4 : 6))
const finding = computed(() => tree.findResults.value !== null)
const rowIndex = computed(() => new Map(tree.rows.value.map((row, index) => [row.key, index])))
const rootListing = computed(() => picker.data.listings.get(tree.root.value))

function scrollerElement(): HTMLElement | null {
  return scroller.value?.$el ?? null
}

/** While a long folder scrolls past, its parents stay pinned above it. */
function updateSticky() {
  const element = scrollerElement()
  if (!element || element.scrollTop <= padTop.value) {
    sticky.value = []
    return
  }
  const rows = tree.rows.value
  let chain: TreeRow[] = []
  for (let pass = 0; pass < 2; pass++) {
    const row = rows[Math.max(0, Math.floor((element.scrollTop + chain.length * rowHeight.value - padTop.value) / rowHeight.value))]
    if (!row || row.type !== 'folder') break
    chain = ancestorsWithin(row.path, tree.root.value)
      .map((path) => rowIndex.value.get(path))
      .filter((index): index is number => index !== undefined)
      .map((index) => rows[index]!)
      .slice(-3)
  }
  sticky.value = chain
  // Pinned parents are often far above the rows on screen, whose counts are the only ones asked for.
  if (chain.length) picker.data.requestSummaries(chain.map((row) => row.path))
}

function onUpdate(startIndex: number, endIndex: number) {
  const rows = tree.rows.value.slice(Math.max(0, startIndex - 10), endIndex + 10)
  picker.data.requestSummaries(rows.filter((row) => row.type === 'folder').map((row) => row.path))
}

/** Keeps a row on screen without jumping: scrolls only as far as needed, clear of the pinned parents. */
function ensureVisible(path: string) {
  const element = scrollerElement()
  const index = rowIndex.value.get(normalizeFolderPath(path))
  if (!element || index === undefined) return
  const top = padTop.value + index * rowHeight.value
  const pinned = sticky.value.length * rowHeight.value
  if (top - pinned < element.scrollTop) element.scrollTop = Math.max(0, top - pinned)
  else if (top + rowHeight.value > element.scrollTop + element.clientHeight) element.scrollTop = top + rowHeight.value - element.clientHeight
}

/** Puts a folder's row at the top, below any pinned parents, as the picker opens on it. */
function scrollToTop(path: string) {
  const element = scrollerElement()
  const index = rowIndex.value.get(normalizeFolderPath(path))
  if (!element || index === undefined) return
  element.scrollTop = Math.max(0, padTop.value + index * rowHeight.value - Math.min(index, 3) * rowHeight.value)
}

/** A scrolled-to row renders a frame or two later, so the focus waits for it. */
async function focusRow(path: string) {
  ensureVisible(path)
  const selector = `[data-path="${CSS.escape(normalizeFolderPath(path))}"] [data-row-focus]`
  await nextTick()
  for (let frame = 0; frame < 4; frame++) {
    const button = scrollerElement()?.querySelector<HTMLElement>(selector)
    if (button) return button.focus({ preventScroll: true })
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

function folderRows(): string[] {
  return tree.rows.value.filter((row) => row.type === 'folder').map((row) => row.path)
}

/** Keys act on the row whose name has the focus; any other control in the list keeps its own keys. */
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const item = target.matches('[data-row-focus]') ? target.closest<HTMLElement>('[role="treeitem"][data-path]') : null
  const current = item?.dataset.path
  if (!current) return
  const paths = folderRows()
  const index = paths.indexOf(current)
  const rtl = getComputedStyle(item).direction === 'rtl'
  const key = rtl && event.key === 'ArrowLeft' ? 'ArrowRight' : rtl && event.key === 'ArrowRight' ? 'ArrowLeft' : event.key
  let next: string | null = null
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!paths.length) return
    next = paths[index < 0 ? 0 : Math.max(0, Math.min(paths.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))]!
  } else if (key === 'ArrowRight') {
    if (tree.hasChildren(current) && !tree.expanded.value.has(current) && !finding.value) tree.setExpanded(current, true)
    else next = tree.visibleChildren(current)[0]?.path ?? null
  } else if (key === 'ArrowLeft') {
    if (tree.expanded.value.has(current) && !finding.value) tree.setExpanded(current, false)
    else if (parentPath(current) !== tree.root.value && isInside(current, tree.root.value)) next = parentPath(current)
  } else if (key === ' ' || key === 'Enter') {
    tree.focus.value = current
    picker.toggleFolder(current, event)
  } else {
    return
  }
  event.preventDefault()
  if (next) {
    tree.focus.value = normalizeFolderPath(next)
    void focusRow(next)
  }
}

function onShowSystem() {
  tree.showSystem.value = true
}

function onRetry() {
  emit('retry')
}

function moreLabel(path: string): string {
  return t('library.folderBrowser.tree.moreFolders', { count: formatNumber(picker.data.listings.get(path)?.entries.length ?? 0) })
}

watch(
  () => [tree.rows.value.length, picker.phone.value],
  () => void nextTick(updateSticky),
)

// The scroller is re-created when the list swaps for an empty state, so the listener follows it.
let scrollTarget: HTMLElement | null = null
watch(
  scroller,
  () => {
    scrollTarget?.removeEventListener('scroll', updateSticky)
    scrollTarget = scrollerElement()
    scrollTarget?.addEventListener('scroll', updateSticky, { passive: true })
  },
  { flush: 'post' },
)
onBeforeUnmount(() => scrollTarget?.removeEventListener('scroll', updateSticky))

function focusField(prefill?: string) {
  toolbar.value?.focusField(prefill)
}

defineExpose({ focusRow, ensureVisible, scrollToTop, focusField })
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <FolderPickerToolbar ref="toolbar" />
    <p
      v-if="finding && picker.findQuery.value.trim()"
      class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground"
      role="status"
    >
      {{ t('library.folderBrowser.field.findSummary', { count: tree.findResults.value!.length, query: picker.findQuery.value.trim() }) }}
      <i18n-t v-if="tree.findResults.value!.length" keypath="library.folderBrowser.field.findEnter" tag="span" scope="global">
        <template #key><PickerKbd>↵</PickerKbd></template>
      </i18n-t>
      <span v-if="tree.findTruncated.value">{{ t('library.folderBrowser.field.findTruncated', { count: tree.findResults.value!.length }) }}</span>
    </p>
    <div class="relative min-h-0 flex-1">
      <!-- A visual copy of rows that are in the tree below; hidden from assistive technology so they are not read twice. -->
      <div
        v-if="sticky.length"
        class="absolute inset-x-0 top-0 z-10 border-b border-border bg-background py-px shadow-[0_6px_12px_-10px_rgb(0_0_0/0.5)]"
        :class="picker.phone.value ? 'px-1' : 'px-2'"
        aria-hidden="true"
      >
        <FolderPickerTreeRow v-for="row in sticky" :key="row.key" :row="row" pinned />
      </div>
      <div
        v-if="picker.data.placesFailed.value"
        class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-muted-foreground"
        role="alert"
      >
        <p>{{ t('library.folderBrowser.tree.placesFailed') }}</p>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          @click="onRetry"
        >
          {{ t('library.folderBrowser.tree.retry') }}
        </button>
      </div>
      <p v-else-if="rootListing && rootListing.state !== 'ok'" class="px-6 py-10 text-center text-sm text-muted-foreground" role="alert">
        {{ t('library.folderBrowser.tree.unreadable', { path: tree.root.value }) }}
      </p>
      <p v-else-if="finding && !tree.rows.value.length" class="px-4 py-8 text-center text-sm text-muted-foreground">
        {{ t('library.folderBrowser.field.findNone') }}
      </p>
      <RecycleScroller
        v-else
        ref="scroller"
        :items="tree.rows.value"
        :item-size="rowHeight"
        key-field="key"
        emit-update
        class="h-full overflow-y-auto"
        :class="picker.phone.value ? 'px-1 py-1' : 'px-2 py-1.5'"
        role="tree"
        :aria-label="t('library.folderBrowser.tree.label')"
        aria-multiselectable="true"
        @update="onUpdate"
        @keydown="onKeydown"
      >
        <template #default="{ item }">
          <FolderPickerNewFolderRow v-if="item.type === 'new'" :row="item" />
          <div
            v-else-if="item.type === 'loading'"
            class="flex items-center gap-1.5 pe-2"
            :class="picker.phone.value ? 'h-11 ps-1' : 'h-8 ps-1.5'"
            role="presentation"
          >
            <span v-for="level in item.depth" :key="level" class="w-[18px] shrink-0" />
            <span class="size-5 shrink-0" />
            <span class="inline-block h-2 w-32 animate-pulse rounded-full bg-muted" />
            <span class="sr-only">{{ t('library.folderBrowser.tree.loading') }}</span>
          </div>
          <div
            v-else-if="item.type === 'more'"
            class="flex items-center gap-1.5 pe-2 text-xs text-muted-foreground"
            :class="picker.phone.value ? 'h-11 ps-1' : 'h-8 ps-1.5'"
            role="presentation"
          >
            <span v-for="level in item.depth" :key="level" class="w-[18px] shrink-0" />
            <span class="size-5 shrink-0" />
            <span class="min-w-0 truncate" :title="moreLabel(item.path)">{{ moreLabel(item.path) }}</span>
          </div>
          <FolderPickerTreeRow v-else :row="item" />
        </template>
        <template #after>
          <button
            v-if="!finding && tree.hiddenSystemCount.value"
            type="button"
            class="ms-7 mt-1 flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="onShowSystem"
          >
            <EyeOff :size="13" aria-hidden="true" />
            {{ t('library.folderBrowser.tree.systemHidden', { count: tree.hiddenSystemCount.value, path: tree.root.value }) }}
          </button>
        </template>
      </RecycleScroller>
    </div>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
