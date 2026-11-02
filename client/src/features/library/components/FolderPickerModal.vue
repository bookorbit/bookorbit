<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { Check, ChevronUp, FolderTree, Info, Undo2, X } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import { useModal } from '@/composables/useModal'
import { formatList } from '@/i18n/formatters'
import { consolidateFolderPaths, normalizeFolderPath } from '../composables/folder-paths'
import { FOLDER_PICKER, type FolderPickerContext } from '../composables/folder-picker/folder-picker-context'
import {
  ancestorsWithin,
  booksAs,
  isAtOrInside,
  isInside,
  leafName,
  parentPath,
  type FolderStatus,
  type PickerLibrary,
} from '../composables/folder-picker/folder-picker-rules'
import { rememberRecentFolders } from '../composables/folder-picker/recent-folders'
import { useFolderPickerData } from '../composables/folder-picker/useFolderPickerData'
import { useFolderPickerSelection } from '../composables/folder-picker/useFolderPickerSelection'
import { useFolderPickerTree } from '../composables/folder-picker/useFolderPickerTree'
import { usePickerPlanWidth } from '../composables/folder-picker/usePickerPlanWidth'
import FolderPickerDivider from './folder-picker/FolderPickerDivider.vue'
import FolderPickerPlan from './folder-picker/FolderPickerPlan.vue'
import FolderPickerTree from './folder-picker/FolderPickerTree.vue'
import PickerKbd from './folder-picker/PickerKbd.vue'

const props = withDefaults(
  defineProps<{
    /** Folders the library already reads. */
    selectedPaths?: string[]
    libraryName?: string
    libraryIcon?: string | null
    /** The library being edited, left out of the others when checking overlaps. */
    libraryId?: number | null
    organizationMode?: OrganizationMode
    organizationModeLocked?: boolean
  }>(),
  {
    selectedPaths: () => [],
    libraryName: '',
    libraryIcon: null,
    libraryId: null,
    organizationMode: 'book_per_folder',
    organizationModeLocked: false,
  },
)

const emit = defineEmits<{
  select: [paths: string[]]
  close: []
  'update:organizationMode': [mode: OrganizationMode]
}>()

const FLASH_MS = 1300

const { t } = useI18n()
const desktop = useMediaQuery('(min-width: 640px)')
const phone = computed(() => !desktop.value)
const panel = ref<HTMLElement | null>(null)
const grid = ref<HTMLElement | null>(null)
const treePane = ref<InstanceType<typeof FolderPickerTree> | null>(null)
const sheetOpen = ref(false)
const flash = ref<string | null>(null)
const findQuery = ref('')
const newFolderName = ref('')
const newFolderError = ref<string | null>(null)
const newFolderBusy = ref(false)
const menuOpen = ref(false)
const mode = ref<OrganizationMode>(props.organizationMode)
/** The mode as the picker opened, put back if it is cancelled. */
const openingMode = props.organizationMode
let flashTimer: ReturnType<typeof setTimeout> | null = null
let revealRun = 0

const data = useFolderPickerData()
const tree = useFolderPickerTree(data, () => [...own.value, ...selection.selected.value])
const planWidth = usePickerPlanWidth()

const own = computed(() => consolidateFolderPaths(props.selectedPaths))
const libraryName = computed(() => props.libraryName.trim() || t('library.folderBrowser.unnamedLibrary'))
const libraries = computed<PickerLibrary[]>(() => {
  const list: PickerLibrary[] = (data.places.value?.libraries ?? [])
    .filter((library) => library.id !== props.libraryId)
    .map((library) => ({ id: library.id, name: library.name, icon: library.icon, folders: library.folders.map(normalizeFolderPath) }))
  if (own.value.length) list.push({ id: props.libraryId, name: libraryName.value, icon: props.libraryIcon, folders: own.value, self: true })
  return list
})
const others = computed(() => libraries.value.filter((library) => !library.self))
const modeLocked = computed(() => props.organizationModeLocked)

const selection = useFolderPickerSelection({
  data,
  own: () => own.value,
  others: () => others.value,
  appDataPath: () => data.places.value?.appDataPath ?? null,
  mode,
  onModeChange: (next) => emit('update:organizationMode', next),
})

const selected = selection.selected
const subtitle = computed(() =>
  t('library.folderBrowser.subtitle', {
    name: libraryName.value,
    mode: mode.value === 'book_per_file' ? t('library.folderBrowser.mode.file') : t('library.folderBrowser.mode.folder'),
  }),
)
const totalBooks = computed(() => selected.value.reduce((sum, path) => sum + (booksIn(path) ?? 0), 0))
const addLabel = computed(() => {
  const count = selected.value.length
  if (phone.value) return count ? t('library.folderBrowser.footer.addShortCount', { count }) : t('library.folderBrowser.footer.addShort')
  return count ? t('library.folderBrowser.footer.addCount', { count }) : t('library.folderBrowser.footer.add')
})
const undoMessage = computed(() => (selection.undo.value ? t(selection.undo.value.notice.key, selection.undo.value.notice.params ?? {}) : null))
const noticeMessage = computed(() => (selection.notice.value ? t(selection.notice.value.key, selection.notice.value.params ?? {}) : null))

function booksIn(path: string): number | null {
  const summary = data.summaries.get(normalizeFolderPath(path))
  if (!summary) return null
  return booksAs(summary, mode.value)
}

function countLabel(count: number): string {
  return t('library.folderBrowser.count.books', { count })
}

function describeOverlap(path: string, status: FolderStatus): string {
  const kind = status.over ?? status.kind
  if (kind === 'contains') {
    const libs = status.libraries ?? []
    if (libs.length === 1) {
      const folder = libs[0]!.folders.find((own) => isInside(own, path)) ?? libs[0]!.folders[0]!
      return t('library.folderBrowser.plan.attention.containsOne', { folder: leafName(folder), library: libs[0]!.name })
    }
    return t('library.folderBrowser.plan.attention.containsMany', { libraries: formatList(libs.map((library) => library.name)) })
  }
  const library = status.library?.name ?? ''
  if (status.exact)
    return t('library.folderBrowser.plan.attention.overlapExact', { library, count: data.summaries.get(normalizeFolderPath(path))?.files ?? 0 })
  return t('library.folderBrowser.plan.attention.overlapInside', { library })
}

function flashRow(path: string) {
  flash.value = path
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (flash.value === path) flash.value = null
  }, FLASH_MS)
}

/** Opens every folder above `path`, waits for them to list, then focuses and tints its row. */
async function reveal(path: string) {
  const key = normalizeFolderPath(path)
  // A later reveal wins, even when this one's listings arrive last.
  const run = ++revealRun
  sheetOpen.value = false
  findQuery.value = ''
  tree.findResults.value = null
  tree.reveal(key)
  for (const folder of [tree.root.value, ...ancestorsWithin(key, tree.root.value)]) await data.ensureListing(folder)
  if (run !== revealRun) return
  flashRow(key)
  await nextTick()
  void treePane.value?.focusRow(key)
}

function focusFolder(path: string) {
  const key = normalizeFolderPath(path)
  const finding = tree.findResults.value !== null
  if (!finding && tree.hasChildren(key)) tree.setExpanded(key, tree.focus.value === key ? !tree.expanded.value.has(key) : true)
  tree.focus.value = key
  void treePane.value?.focusRow(key)
}

function toggleFolder(path: string, event?: MouseEvent | KeyboardEvent) {
  const key = normalizeFolderPath(path)
  if (event?.shiftKey) {
    // Only the siblings on screen, so a range across find results never ticks folders it did not show.
    const parent = parentPath(key)
    selection.tickRange(
      key,
      tree.rows.value.filter((row) => row.type === 'folder' && parentPath(row.path) === parent).map((row) => row.path),
    )
  } else {
    selection.toggle(key)
  }
}

function openNewFolder(parent: string) {
  const key = normalizeFolderPath(parent)
  findQuery.value = ''
  tree.findResults.value = null
  newFolderName.value = ''
  newFolderError.value = null
  tree.expanded.value = new Set([...tree.expanded.value, ...ancestorsWithin(key, tree.root.value), key])
  tree.newFolderParent.value = key
}

function cancelNewFolder() {
  tree.newFolderParent.value = null
  newFolderError.value = null
}

async function submitNewFolder() {
  const parent = tree.newFolderParent.value
  const name = newFolderName.value.trim()
  if (!parent || newFolderBusy.value) return
  if (!name) {
    newFolderError.value = t('library.folderBrowser.newFolder.errors.empty')
    return
  }
  if (/[\\/]/.test(name) || name.startsWith('.')) {
    newFolderError.value = t('library.folderBrowser.newFolder.errors.invalid')
    return
  }
  newFolderBusy.value = true
  const result = await data.createFolder(parent, name)
  newFolderBusy.value = false
  if ('error' in result) {
    newFolderError.value = t(`library.folderBrowser.newFolder.errors.${result.error}`, { name })
    return
  }
  tree.newFolderParent.value = null
  await reveal(result.path)
  selection.toggle(result.path)
  // Made inside a folder already read, it is included rather than ticked.
  const ticked = selection.selected.value.includes(result.path)
  selection.notice.value = {
    key: ticked ? 'library.folderBrowser.notice.created' : 'library.folderBrowser.notice.createdOnly',
    params: { path: result.path },
  }
}

const context: FolderPickerContext = {
  data,
  tree,
  selection,
  libraries,
  others,
  own,
  libraryName,
  mode,
  modeLocked,
  phone,
  flash,
  findQuery,
  newFolder: { name: newFolderName, error: newFolderError, busy: newFolderBusy },
  menuOpen,
  reveal: (path) => void reveal(path),
  focusFolder,
  toggleFolder,
  openNewFolder,
  submitNewFolder,
  cancelNewFolder,
  booksIn,
  countLabel,
  describeOverlap,
}
provide(FOLDER_PICKER, context)

function gridWidth(): number {
  return grid.value?.offsetWidth ?? 0
}

function onPlanWidth(value: number) {
  planWidth.width.value = value
}

function onPlanCommit() {
  planWidth.save()
}

function requestClose() {
  if (newFolderBusy.value) return
  // Cancelling undoes everything done in the picker, the organization switch included.
  if (mode.value !== openingMode) emit('update:organizationMode', openingMode)
  emit('close')
}

function onBackdrop() {
  requestClose()
}

function confirm() {
  if (selected.value.length === 0) return
  rememberRecentFolders(selected.value)
  emit('select', [...selected.value])
}

function onUndo() {
  selection.restore()
}

function toggleSheet() {
  sheetOpen.value = !sheetOpen.value
}

function closeSheet() {
  sheetOpen.value = false
}

function onPanelKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const typing = target.matches('input[type=text], input:not([type]), textarea')
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    const from = tree.focus.value && tree.focus.value !== tree.root.value ? `${tree.focus.value}/` : '/'
    treePane.value?.focusField(from)
  } else if (!typing && event.key === '/') {
    event.preventDefault()
    treePane.value?.focusField()
  } else if (event.key === 'Escape' && sheetOpen.value) {
    // Closes the plan sheet only; the picker's own Escape listener never sees it.
    event.preventDefault()
    event.stopPropagation()
    sheetOpen.value = false
  }
}

function clampPlan() {
  if (gridWidth()) planWidth.width.value = planWidth.clamp(planWidth.width.value, gridWidth())
}

function retryPlaces() {
  void open()
}

useModal({
  container: panel,
  onClose: requestClose,
  disabled: () => newFolderBusy.value || menuOpen.value,
})

watch(
  () => props.organizationMode,
  (next) => (mode.value = next),
)

// The plan keeps its width when the window grows, and gives way when it shrinks.
watch(desktop, () => void nextTick(clampPlan))
useEventListener(window, 'resize', clampPlan, { passive: true })

// Leaving find mode, the focused folder may sit in a folded branch: unfold the way to it.
watch(
  () => tree.findResults.value,
  async (now, before) => {
    const focus = tree.focus.value
    if (now !== null || !before || !focus) return
    tree.reveal(focus)
    for (const folder of [tree.root.value, ...ancestorsWithin(focus, tree.root.value)]) await data.ensureListing(folder)
    await nextTick()
    treePane.value?.ensureVisible(focus)
  },
)

async function open() {
  await data.loadPlaces()
  await nextTick()
  clampPlan()
  const places = data.places.value
  if (!places) return
  const opened = new Set<string>()
  const firstMount = places.mounts.find((mount) => !places.appDataPath || !isAtOrInside(mount, places.appDataPath))
  if (firstMount && firstMount !== normalizeFolderPath(places.root)) opened.add(normalizeFolderPath(firstMount))
  // With nothing mounted separately, open the way to where the libraries already are.
  const landmarks = own.value.length ? own.value : opened.size ? [] : others.value.flatMap((library) => library.folders).slice(0, 1)
  for (const path of landmarks) for (const parent of ancestorsWithin(path, places.root)) opened.add(parent)
  tree.expanded.value = opened
  void data.loadUnclaimed()
  // Open on the deepest folder unfolded, so the libraries' landmarks are on screen.
  const deepest = [...opened].sort((a, b) => b.length - a.length)[0]
  if (deepest) {
    for (const folder of [tree.root.value, ...ancestorsWithin(deepest, tree.root.value), deepest]) await data.ensureListing(folder)
    await nextTick()
    treePane.value?.scrollToTop(deepest)
  }
}

onMounted(open)

onBeforeUnmount(() => {
  data.dispose()
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="!phone" class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim p-8" role="presentation" @click.self="onBackdrop">
      <div
        ref="panel"
        class="flex h-[min(92%,60rem)] w-full max-w-[76rem] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        aria-describedby="folder-picker-subtitle"
        tabindex="-1"
        @keydown="onPanelKeydown"
      >
        <header class="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary" aria-hidden="true">
            <FolderTree :size="18" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 id="folder-picker-title" class="truncate text-base font-semibold text-foreground">{{ t('library.folderBrowser.title') }}</h2>
            <p id="folder-picker-subtitle" class="truncate text-xs text-muted-foreground">{{ subtitle }}</p>
          </div>
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="t('library.folderBrowser.close')"
            @click="requestClose"
          >
            <X :size="18" />
          </button>
        </header>
        <div ref="grid" class="relative grid min-h-0 flex-1" :style="{ gridTemplateColumns: `minmax(0,1fr) ${planWidth.width.value}px` }">
          <FolderPickerTree ref="treePane" @retry="retryPlaces" />
          <FolderPickerPlan :width="planWidth.width.value" />
          <FolderPickerDivider
            :width="planWidth.width.value"
            :grid-width="gridWidth"
            :clamp="planWidth.clamp"
            @update:width="onPlanWidth"
            @commit="onPlanCommit"
          />
        </div>
        <footer class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-3 py-2.5">
          <div class="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
            <template v-if="undoMessage">
              <Info :size="13" class="shrink-0 text-primary" aria-hidden="true" />
              <span class="truncate text-foreground" role="status">{{ undoMessage }}</span>
              <button
                type="button"
                class="ms-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
                @click="onUndo"
              >
                <Undo2 :size="13" aria-hidden="true" />
                {{ t('library.folderBrowser.notice.undo') }}
              </button>
            </template>
            <template v-else-if="noticeMessage">
              <Info :size="13" class="shrink-0 text-primary" aria-hidden="true" />
              <span class="truncate" role="status">{{ noticeMessage }}</span>
            </template>
            <i18n-t v-else keypath="library.folderBrowser.footer.hints" scope="global">
              <template #move><PickerKbd>↑</PickerKbd><PickerKbd>↓</PickerKbd></template>
              <template #fold><PickerKbd>←</PickerKbd><PickerKbd>→</PickerKbd></template>
              <template #tick
                ><PickerKbd>{{ t('library.folderBrowser.keys.space') }}</PickerKbd></template
              >
              <template #range><PickerKbd>⇧</PickerKbd></template>
              <template #find><PickerKbd>/</PickerKbd></template>
            </i18n-t>
          </div>
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            @click="requestClose"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="selected.length === 0"
            @click="confirm"
          >
            <Check :size="16" aria-hidden="true" />
            {{ addLabel }}
          </button>
        </footer>
      </div>
    </div>

    <div
      v-else
      ref="panel"
      class="fixed inset-0 z-[80] flex flex-col bg-background outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-picker-title"
      aria-describedby="folder-picker-subtitle"
      tabindex="-1"
      @keydown="onPanelKeydown"
    >
      <header class="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2.5">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary" aria-hidden="true">
          <FolderTree :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="folder-picker-title" class="truncate text-base font-semibold text-foreground">{{ t('library.folderBrowser.title') }}</h2>
          <p id="folder-picker-subtitle" class="truncate text-xs text-muted-foreground">{{ subtitle }}</p>
        </div>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="t('library.folderBrowser.close')"
          @click="requestClose"
        >
          <X :size="18" />
        </button>
      </header>
      <FolderPickerTree ref="treePane" class="min-h-0 flex-1" @retry="retryPlaces" />
      <div v-if="undoMessage || noticeMessage" class="flex shrink-0 items-center gap-1.5 border-t border-border bg-card px-3 py-1.5 text-xs">
        <Info :size="13" class="shrink-0 text-primary" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate" :class="undoMessage ? 'text-foreground' : 'text-muted-foreground'" role="status">{{
          undoMessage ?? noticeMessage
        }}</span>
        <button
          v-if="undoMessage"
          type="button"
          class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
          @click="onUndo"
        >
          <Undo2 :size="13" aria-hidden="true" />
          {{ t('library.folderBrowser.notice.undo') }}
        </button>
      </div>
      <footer class="flex shrink-0 items-center gap-2 border-t border-border bg-card px-3 pb-3 pt-2.5">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pe-2 ps-1 text-start hover:bg-muted"
          :aria-expanded="sheetOpen"
          @click="toggleSheet"
        >
          <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-xs font-semibold tabular-nums text-primary">{{
            selected.length
          }}</span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-foreground">
              {{ selected.length ? countLabel(totalBooks) : t('library.folderBrowser.footer.nothingPicked') }}
            </span>
            <span class="block truncate text-xs text-muted-foreground">{{ t('library.folderBrowser.footer.seePlan') }}</span>
          </span>
          <ChevronUp :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          :disabled="selected.length === 0"
          @click="confirm"
        >
          <Check :size="16" aria-hidden="true" />
          {{ addLabel }}
        </button>
      </footer>
      <div v-if="sheetOpen" class="absolute inset-0 z-40 flex flex-col justify-end bg-scrim" @click.self="closeSheet">
        <div
          class="flex h-[82%] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-2xl"
          role="dialog"
          :aria-label="t('library.folderBrowser.plan.label')"
        >
          <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted" aria-hidden="true" />
          <FolderPickerPlan :width="0" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
