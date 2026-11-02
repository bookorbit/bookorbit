<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, Database, Folder, FolderLock, FolderOpen, HardDrive, Lock, TriangleAlert } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatList, formatNumber } from '@/i18n/formatters'
import { isInside, leafName, type PickerLibrary } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import type { TreeRow } from '../../composables/folder-picker/useFolderPickerTree'

/** `pinned`: a copy shown above the list while its folder scrolls past, not a tree item of its own. */
const props = defineProps<{ row: TreeRow; pinned?: boolean }>()

const { t } = useI18n()
const picker = useFolderPickerContext()

const path = computed(() => props.row.path)
const name = computed(() => props.row.entry.name || leafName(path.value))
const status = computed(() => picker.selection.status(path.value))
const summary = computed(() => picker.data.summaries.get(path.value))
const canOpen = computed(() => picker.tree.hasChildren(path.value))
const finding = computed(() => picker.tree.findResults.value !== null)
const open = computed(() => canOpen.value && (finding.value || picker.tree.expanded.value.has(path.value)))
const focused = computed(() => picker.tree.focus.value === path.value)
const tabbable = computed(() => !props.pinned && picker.tree.tabStop.value === path.value)
const mixedCount = computed(() => (status.value ? 0 : picker.selection.selected.value.filter((folder) => isInside(folder, path.value)).length))
const quietName = computed(() => ['included', 'ownCovered', 'denied', 'appData'].includes(status.value?.kind ?? ''))
const denied = computed(() => status.value?.kind === 'denied')
const checked = computed(() => ['selected', 'included', 'own', 'ownCovered'].includes(status.value?.kind ?? ''))
const here = computed<PickerLibrary[]>(() => picker.libraries.value.filter((library) => library.folders.includes(path.value)))
const below = computed<PickerLibrary[]>(() =>
  open.value ? [] : picker.libraries.value.filter((library) => library.folders.some((folder) => isInside(folder, path.value))),
)
const books = computed(() => picker.booksIn(path.value))

const tint = computed(() => {
  if (picker.flash.value === path.value) return 'bg-primary/25'
  if (focused.value) return 'bg-primary/12'
  if (status.value?.kind === 'selected') return 'bg-primary/6'
  return 'hover:bg-muted/60'
})

const icon = computed(() => {
  if (denied.value) return { component: FolderLock, class: 'text-muted-foreground' }
  if (props.row.entry.appData) return { component: Database, class: 'text-muted-foreground' }
  if (props.row.entry.mount) return { component: HardDrive, class: 'text-primary' }
  return { component: open.value ? FolderOpen : Folder, class: 'text-primary' }
})

const nameParts = computed(() => {
  const query = picker.findQuery.value.trim()
  const index = finding.value && query ? name.value.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (index < 0) return null
  return [name.value.slice(0, index), name.value.slice(index, index + query.length), name.value.slice(index + query.length)]
})

const countLabel = computed(() => {
  if (!summary.value || books.value === null || books.value === 0) return ''
  const value = formatNumber(books.value)
  return summary.value.truncated ? t('library.folderBrowser.count.atLeast', { count: value }) : value
})

function onExpand() {
  picker.tree.setExpanded(path.value, !open.value)
}

function onFocus() {
  picker.focusFolder(path.value)
}

async function onToggle(event: MouseEvent) {
  const box = event.currentTarget as HTMLInputElement
  picker.toggleFolder(path.value, event)
  // A refused or unchanged tick leaves the box as the browser flipped it; Vue patches only changed values.
  await nextTick()
  box.checked = checked.value
  box.indeterminate = mixedCount.value > 0
}

function onDoubleClick() {
  picker.toggleFolder(path.value)
}
</script>

<template>
  <div
    class="flex items-center gap-1.5 rounded-md pe-2 transition-colors duration-500"
    :class="[picker.phone.value ? 'h-11 ps-1' : 'h-8 ps-1.5', tint]"
    :role="pinned ? undefined : 'treeitem'"
    :aria-level="pinned ? undefined : row.depth + 1"
    :aria-expanded="!pinned && canOpen ? open : undefined"
    :aria-selected="pinned ? undefined : checked"
    :data-path="pinned ? undefined : path"
  >
    <span
      v-for="level in row.depth"
      :key="level"
      class="relative w-[18px] shrink-0 self-stretch before:absolute before:inset-y-0 before:start-[8px] before:w-px before:bg-border"
      aria-hidden="true"
    />
    <button
      v-if="canOpen"
      type="button"
      tabindex="-1"
      class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      :aria-label="open ? t('library.folderBrowser.tree.collapse', { name }) : t('library.folderBrowser.tree.expand', { name })"
      @click="onExpand"
    >
      <ChevronDown v-if="open" :size="14" />
      <ChevronRight v-else :size="14" />
    </button>
    <span v-else class="size-5 shrink-0" />
    <input
      type="checkbox"
      tabindex="-1"
      class="size-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
      :checked="checked"
      :disabled="status?.block"
      :indeterminate="mixedCount > 0"
      :aria-label="t('library.folderBrowser.tree.select', { name })"
      @click="onToggle"
    />
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 items-center gap-2 text-start focus-visible:outline-none"
      :tabindex="tabbable ? 0 : -1"
      :data-row-focus="pinned ? undefined : ''"
      @click="onFocus"
      @dblclick="onDoubleClick"
    >
      <component :is="icon.component" :size="15" class="shrink-0" :class="icon.class" aria-hidden="true" />
      <span
        class="min-w-0 truncate text-[13px]"
        :class="[quietName ? 'text-muted-foreground' : 'text-foreground', focused ? 'font-medium' : '']"
        :title="path"
      >
        <template v-if="nameParts"
          >{{ nameParts[0] }}<mark class="rounded-[2px] bg-primary/25 text-foreground">{{ nameParts[1] }}</mark
          >{{ nameParts[2] }}</template
        >
        <template v-else>{{ name }}</template>
      </span>
      <span
        v-for="library in here"
        :key="library.id ?? 'self'"
        class="inline-flex shrink-0 items-center gap-1 rounded-[5px] border px-1.5 text-[11px] font-medium leading-[18px]"
        :class="library.self ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'"
        :title="t('library.folderBrowser.tree.readsThis', { name: library.name })"
      >
        <AppIcon :icon="library.icon" fallback="Library" :size="11" />
        <template v-if="!picker.phone.value">{{ library.self ? t('library.folderBrowser.tree.thisLibrary') : library.name }}</template>
      </span>
      <span
        v-if="below.length"
        class="flex shrink-0 items-center gap-0.5 text-muted-foreground"
        :title="t('library.folderBrowser.tree.librariesInside', { names: formatList(below.map((library) => library.name)), count: below.length })"
      >
        <AppIcon v-for="library in below.slice(0, 4)" :key="library.id ?? 'self'" :icon="library.icon" fallback="Library" :size="12" />
      </span>
      <span v-if="mixedCount" class="shrink-0 text-[11px] font-medium text-primary">{{
        t('library.folderBrowser.tree.inside', { count: mixedCount })
      }}</span>
      <span v-if="status?.kind === 'selected' && status.warn" class="shrink-0 text-warning" :title="picker.describeOverlap(path, status)">
        <TriangleAlert :size="14" />
      </span>
      <span
        v-else-if="denied"
        class="inline-flex max-w-44 shrink-0 items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-[11px] leading-[calc(1/0.75)] font-medium text-destructive"
      >
        <Lock :size="11" class="shrink-0" />
        <span class="truncate">{{ t('library.folderBrowser.tree.noAccess') }}</span>
      </span>
      <span v-else-if="row.entry.appData" class="shrink-0 rounded-[5px] border border-border px-1.5 text-[11px] leading-[18px] text-muted-foreground">
        {{ t('library.folderBrowser.tree.appData') }}
      </span>
    </button>
    <span class="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
      <template v-if="!denied && !row.entry.appData">
        <span v-if="!summary" class="inline-block h-2 w-7 animate-pulse rounded-full bg-muted align-middle" aria-hidden="true" />
        <template v-else>{{ countLabel }}</template>
      </template>
    </span>
  </div>
</template>
