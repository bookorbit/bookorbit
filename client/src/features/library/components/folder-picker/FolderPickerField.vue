<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, CornerDownLeft, Folder, HardDrive, Search, X } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import { normalizeFolderPath } from '../../composables/folder-paths'
import { isAtOrInside, leafName, parentPath } from '../../composables/folder-picker/folder-picker-rules'
import { useFolderPickerContext } from '../../composables/folder-picker/folder-picker-context'
import { readRecentFolders } from '../../composables/folder-picker/recent-folders'
import PickerKbd from './PickerKbd.vue'

interface Option {
  id: string
  path: string
  section?: string
  title: string
  sub: string
  /** Title is a name (sans) rather than a path (mono). */
  named?: boolean
  icon: 'mount' | 'folder' | 'recent' | 'library'
  libraryIcon?: string | null
}

const SEARCH_DELAY_MS = 220

const { t } = useI18n()
const picker = useFolderPickerContext()
const tree = picker.tree
const input = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const active = ref(0)
const pathError = ref<string | null>(null)
const query = picker.findQuery
const recent = readRecentFolders()
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchAbort: AbortController | null = null

const mode = computed<'empty' | 'path' | 'find'>(() => (query.value.trim().startsWith('/') ? 'path' : query.value.trim() ? 'find' : 'empty'))

const completionBase = computed(() => {
  const typed = query.value.trim()
  return typed.endsWith('/') ? normalizeFolderPath(typed) : parentPath(typed)
})

const options = computed<Option[]>(() => {
  if (mode.value === 'path') {
    const typed = query.value.trim()
    const stem = typed.endsWith('/') ? '' : leafName(typed).toLowerCase()
    const listing = picker.data.listings.get(completionBase.value)
    return (listing?.entries ?? [])
      .filter((entry) => (tree.showSystem.value || !entry.system) && entry.name.toLowerCase().startsWith(stem))
      .slice(0, 8)
      .map((entry) => {
        const files = picker.data.summaries.get(normalizeFolderPath(entry.path))?.files
        return {
          id: entry.path,
          path: normalizeFolderPath(entry.path),
          title: entry.name,
          sub: files ? picker.countLabel(files) : '',
          named: true,
          icon: entry.mount ? 'mount' : 'folder',
        }
      })
  }
  if (mode.value !== 'empty') return []
  const places = picker.data.places.value
  const out: Option[] = []
  const books = (path: string) => {
    const files = picker.data.summaries.get(normalizeFolderPath(path))?.files
    return files === undefined ? '' : picker.countLabel(files)
  }
  for (const mount of places?.mounts ?? []) {
    if (places?.appDataPath && isAtOrInside(mount, places.appDataPath)) continue
    out.push({ id: `mount:${mount}`, path: mount, section: t('library.folderBrowser.field.mounted'), title: mount, sub: books(mount), icon: 'mount' })
  }
  for (const library of picker.libraries.value) {
    const folder = library.folders[0]
    if (!folder) continue
    const title = library.self ? t('library.folderBrowser.field.thisLibrary', { name: library.name }) : library.name
    out.push({
      id: `library:${library.id ?? 'self'}`,
      path: normalizeFolderPath(folder),
      section: t('library.folderBrowser.field.libraries'),
      title,
      sub: folder,
      named: true,
      icon: 'library',
      libraryIcon: library.icon,
    })
  }
  for (const path of recent.filter((folder) => !places || isAtOrInside(folder, places.root))) {
    out.push({ id: `recent:${path}`, path, section: t('library.folderBrowser.field.recent'), title: path, sub: books(path), icon: 'recent' })
  }
  return out
})

/** The options in their sections, for the listbox's groups. */
const groups = computed(() => {
  const out: Array<{ section: string; items: Array<{ option: Option; index: number }> }> = []
  options.value.forEach((option, index) => {
    const last = out[out.length - 1]
    if (last && last.section === (option.section ?? '')) last.items.push({ option, index })
    else out.push({ section: option.section ?? '', items: [{ option, index }] })
  })
  return out
})

const listed = computed(() => open.value && mode.value !== 'find' && (options.value.length > 0 || mode.value === 'path'))
const activeIndex = computed(() => Math.min(active.value, Math.max(0, options.value.length - 1)))
const showsOptions = computed(() => listed.value && !pathError.value && options.value.length > 0)
const activeId = computed(() => (showsOptions.value ? `folder-picker-option-${activeIndex.value}` : undefined))

function openList() {
  if (open.value) return
  open.value = true
  active.value = 0
  if (mode.value === 'empty') picker.data.requestSummaries(options.value.map((option) => option.path))
}

function close() {
  open.value = false
}

function reveal(path: string) {
  picker.reveal(path)
  query.value = ''
  pathError.value = null
  open.value = false
  input.value?.blur()
}

function runSearch() {
  searchAbort?.abort()
  const text = query.value.trim()
  if (mode.value !== 'find') {
    tree.findResults.value = null
    tree.findTruncated.value = false
    return
  }
  searchAbort = new AbortController()
  const signal = searchAbort.signal
  void picker.data.searchFolders(text, signal, tree.showSystem.value).then((result) => {
    if (signal.aborted || query.value.trim() !== text) return
    tree.findResults.value = result?.results ?? []
    tree.findTruncated.value = result?.truncated ?? false
    picker.data.requestSummaries(tree.findResults.value)
  })
}

function onInput() {
  open.value = true
  active.value = 0
  pathError.value = null
  if (mode.value === 'path') void picker.data.ensureListing(completionBase.value)
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, mode.value === 'find' ? SEARCH_DELAY_MS : 0)
}

async function submitPath() {
  const typed = normalizeFolderPath(query.value)
  const listing = await picker.data.ensureListing(typed)
  if (listing?.state === 'blocked') {
    pathError.value = t('library.folderBrowser.field.pathBlocked', { path: typed })
    return
  }
  if (listing && listing.state !== 'missing') return reveal(typed)
  const option = options.value[activeIndex.value]
  if (option) return reveal(option.path)
  const siblings = (await picker.data.ensureListing(parentPath(typed)))?.entries ?? []
  const near = siblings.find((entry) => entry.name.toLowerCase().startsWith(leafName(typed).slice(0, 3).toLowerCase()))
  pathError.value = near
    ? t('library.folderBrowser.field.pathMissingSuggest', { path: typed, suggestion: normalizeFolderPath(near.path) })
    : t('library.folderBrowser.field.pathMissing', { path: typed })
}

function goToFirstMatch() {
  const first = tree.rows.value.find((row) => row.hit)
  if (!first) return
  input.value?.blur()
  picker.focusFolder(first.path)
}

function onKeydown(event: KeyboardEvent) {
  const count = options.value.length
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && listed.value && count) {
    active.value = Math.max(0, Math.min(count - 1, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)))
  } else if (event.key === 'ArrowDown' && mode.value === 'find') {
    goToFirstMatch()
  } else if (event.key === 'Tab' && mode.value === 'path' && count && !event.shiftKey) {
    query.value = `${options.value[activeIndex.value]!.path}/`
    onInput()
  } else if (event.key === 'Enter') {
    if (mode.value === 'empty' && listed.value && count) reveal(options.value[activeIndex.value]!.path)
    else if (mode.value === 'path') void submitPath()
    else if (mode.value === 'find') goToFirstMatch()
  } else if (event.key === 'Escape') {
    if (open.value && mode.value !== 'find') close()
    else {
      query.value = ''
      onInput()
      close()
      input.value?.blur()
    }
    event.stopPropagation()
  } else {
    return
  }
  event.preventDefault()
}

function onOptionClick(option: Option) {
  reveal(option.path)
}

function onOptionHover(index: number) {
  active.value = index
}

function clear() {
  query.value = ''
  onInput()
  input.value?.focus()
}

function onOutside(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close()
}

/** Focuses the field; with a path, starts typing from it. */
function focus(prefill?: string) {
  if (prefill !== undefined) {
    query.value = prefill
    onInput()
  }
  input.value?.focus()
  openList()
}

watch(mode, (next) => {
  if (next !== 'find') {
    tree.findResults.value = null
    tree.findTruncated.value = false
  }
})

// Showing system folders widens what a find can match.
watch(
  () => tree.showSystem.value,
  () => {
    if (mode.value === 'find') runSearch()
  },
)

onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  if (searchTimer) clearTimeout(searchTimer)
  searchAbort?.abort()
})

defineExpose({ focus })
</script>

<template>
  <div ref="root" class="relative min-w-0 flex-1">
    <label class="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring/60">
      <CornerDownLeft v-if="mode === 'path'" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <Search v-else :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        id="folder-picker-field"
        ref="input"
        v-model="query"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="folder-picker-options"
        :aria-expanded="listed"
        :aria-activedescendant="activeId"
        :aria-label="t('library.folderBrowser.field.label')"
        class="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
        :class="mode === 'path' ? 'font-mono text-[13px]' : 'text-sm'"
        :placeholder="t('library.folderBrowser.field.placeholder')"
        @input="onInput"
        @focus="openList"
        @click="openList"
        @keydown="onKeydown"
      />
      <button
        v-if="query"
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="t('library.folderBrowser.field.clear')"
        @click="clear"
      >
        <X :size="13" />
      </button>
      <PickerKbd v-else-if="!picker.phone.value">/</PickerKbd>
    </label>

    <div
      v-if="listed"
      class="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
    >
      <p v-if="pathError" class="px-2 py-1.5 text-xs text-destructive" role="alert">{{ pathError }}</p>
      <template v-else-if="mode === 'path'">
        <i18n-t
          v-if="!options.length"
          keypath="library.folderBrowser.field.noCompletion"
          tag="p"
          scope="global"
          class="px-2 py-1.5 text-xs text-muted-foreground"
        >
          <template #path>{{ completionBase }}</template>
          <template #key><PickerKbd>↵</PickerKbd></template>
        </i18n-t>
        <template v-else>
          <p class="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden="true">
            {{ t('library.folderBrowser.field.inFolder', { path: completionBase }) }}
          </p>
          <div id="folder-picker-options" role="listbox" :aria-label="t('library.folderBrowser.field.inFolder', { path: completionBase })">
            <button
              v-for="(option, index) in options"
              :id="`folder-picker-option-${index}`"
              :key="option.id"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="index === activeIndex"
              class="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-start"
              :class="index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'"
              @mouseenter="onOptionHover(index)"
              @click="onOptionClick(option)"
            >
              <HardDrive v-if="option.icon === 'mount'" :size="15" class="shrink-0 text-primary" aria-hidden="true" />
              <Folder v-else :size="15" class="shrink-0 text-primary" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-sm text-foreground">{{ option.title }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ option.sub }}</span>
            </button>
          </div>
          <i18n-t
            keypath="library.folderBrowser.field.completeHint"
            tag="p"
            scope="global"
            class="flex flex-wrap items-center gap-1 border-t border-border px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground"
          >
            <template #tab
              ><PickerKbd>{{ t('library.folderBrowser.keys.tab') }}</PickerKbd></template
            >
            <template #enter><PickerKbd>↵</PickerKbd></template>
          </i18n-t>
        </template>
      </template>
      <template v-else>
        <div id="folder-picker-options" role="listbox" :aria-label="t('library.folderBrowser.field.label')">
          <div
            v-for="(group, groupIndex) in groups"
            :key="group.section"
            role="group"
            :aria-labelledby="group.section ? `folder-picker-section-${groupIndex}` : undefined"
          >
            <p
              v-if="group.section"
              :id="`folder-picker-section-${groupIndex}`"
              class="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
              :class="groupIndex === 0 ? 'pt-1' : 'pt-2'"
            >
              {{ group.section }}
            </p>
            <button
              v-for="{ option, index } in group.items"
              :id="`folder-picker-option-${index}`"
              :key="option.id"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="index === activeIndex"
              class="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-start"
              :class="index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'"
              @mouseenter="onOptionHover(index)"
              @click="onOptionClick(option)"
            >
              <HardDrive v-if="option.icon === 'mount'" :size="15" class="shrink-0 text-primary" aria-hidden="true" />
              <Clock v-else-if="option.icon === 'recent'" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <AppIcon v-else :icon="option.libraryIcon" fallback="Library" :size="15" class="shrink-0 text-primary" />
              <span
                class="min-w-0 flex-1 truncate text-foreground"
                :class="option.named ? 'text-sm' : 'font-mono text-[12.5px]'"
                :dir="option.named ? 'auto' : 'ltr'"
                >{{ option.title }}</span
              >
              <span
                class="max-w-[50%] shrink-0 truncate text-xs text-muted-foreground"
                :class="option.named ? 'font-mono' : 'tabular-nums'"
                dir="ltr"
                >{{ option.sub }}</span
              >
            </button>
          </div>
        </div>
        <i18n-t
          keypath="library.folderBrowser.field.jumpHint"
          tag="p"
          scope="global"
          class="flex flex-wrap items-center gap-1 border-t border-border px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground"
        >
          <template #key><PickerKbd>/</PickerKbd></template>
        </i18n-t>
      </template>
    </div>
  </div>
</template>
