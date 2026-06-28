<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import * as LucideIcons from '@lucide/vue'
import { ChevronDown, Search, X } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { CustomIcon } from '@bookorbit/types'
import { customIconSlugFromValue, customIconValue } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import AppIcon from '@/components/AppIcon.vue'
import { useCustomIcons } from '@/features/custom-icons/composables/useCustomIcons'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  hideText?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'open-change': [value: boolean]
}>()

// ── Icon list ─────────────────────────────────────────────────────────────

const ALL_ICONS: string[] = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z]/.test(k) && !k.endsWith('Icon') && !k.startsWith('Lucide'))
  .sort()

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name]
}

const {
  icons: customIcons,
  loading: customIconsLoading,
  catalogTruncated,
  ensureCustomIconsLoaded,
  findCustomIconByValue,
  fetchIconPage,
} = useCustomIcons()

const selectedCustomIcon = computed(() => findCustomIconByValue(props.modelValue))
const selectedLabel = computed(() => {
  const slug = customIconSlugFromValue(props.modelValue)
  if (slug) return selectedCustomIcon.value?.name ?? slug
  return props.modelValue
})

// ── Virtual grid ──────────────────────────────────────────────────────────

const COLS = 10
const ROW_HEIGHT = 44
const VIEWPORT_MARGIN = 8
const PANEL_OFFSET = 4
const PANEL_MIN_WIDTH = 440
const PANEL_MAX_HEIGHT = 400
const PANEL_SEARCH_ROW_HEIGHT = 86
const PANEL_DEFAULT_GRID_HEIGHT = 320
const PANEL_MIN_GRID_HEIGHT = 140

const query = ref('')
const activeSource = ref<'lucide' | 'custom'>('lucide')

// Server-side search results used when the catalog is truncated and the user types a query.
const serverSearchResults = ref<CustomIcon[]>([])
const serverSearchLoading = ref(false)
let serverSearchTimer: ReturnType<typeof setTimeout> | null = null

const filteredIcons = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? ALL_ICONS.filter((n) => n.toLowerCase().includes(q)) : ALL_ICONS
})

const filteredCustomIcons = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (activeSource.value !== 'custom') return []
  if (catalogTruncated.value && q) return serverSearchResults.value
  if (!q) return customIcons.value
  return customIcons.value.filter((icon) => icon.name.toLowerCase().includes(q) || icon.slug.toLowerCase().includes(q))
})

watch([query, activeSource], ([newQuery, newSource]) => {
  if (newSource !== 'custom' || !catalogTruncated.value) return
  if (serverSearchTimer) clearTimeout(serverSearchTimer)
  const term = newQuery.trim()
  if (!term) {
    serverSearchResults.value = []
    return
  }
  serverSearchTimer = setTimeout(async () => {
    serverSearchLoading.value = true
    try {
      const result = await fetchIconPage({ q: term, sort: 'name', page: 0, size: 200 })
      serverSearchResults.value = result.items
    } catch {
      serverSearchResults.value = []
    } finally {
      serverSearchLoading.value = false
    }
  }, 300)
})

interface IconRow {
  id: number
  icons: string[]
}

interface CustomIconRow {
  id: number
  icons: CustomIcon[]
}

const rows = computed<IconRow[]>(() => {
  const result: IconRow[] = []
  const list = filteredIcons.value
  for (let i = 0; i < list.length; i += COLS) {
    result.push({ id: i, icons: list.slice(i, i + COLS) })
  }
  return result
})

const customRows = computed<CustomIconRow[]>(() => {
  const result: CustomIconRow[] = []
  const list = filteredCustomIcons.value
  for (let i = 0; i < list.length; i += COLS) {
    result.push({ id: i, icons: list.slice(i, i + COLS) })
  }
  return result
})

const activeCount = computed(() => (activeSource.value === 'lucide' ? filteredIcons.value.length : filteredCustomIcons.value.length))
const searchPlaceholder = computed(() => (activeSource.value === 'lucide' ? 'Search Lucide icons...' : 'Search custom icons...'))
const customIconsSearching = computed(
  () =>
    serverSearchLoading.value ||
    (activeSource.value === 'custom' && catalogTruncated.value && !!query.value.trim() && serverSearchResults.value.length === 0),
)

// ── Picker state ──────────────────────────────────────────────────────────

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const gridHeight = ref(PANEL_DEFAULT_GRID_HEIGHT)

function positionPanel() {
  const rect = triggerRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.max(rect.width, PANEL_MIN_WIDTH)
  let left = rect.left
  if (left + width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - width - VIEWPORT_MARGIN
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN

  const maxViewportHeight = Math.max(PANEL_SEARCH_ROW_HEIGHT + PANEL_MIN_GRID_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2)
  const desiredPanelHeight = PANEL_SEARCH_ROW_HEIGHT + PANEL_DEFAULT_GRID_HEIGHT
  const panelHeight = Math.min(PANEL_MAX_HEIGHT, Math.min(desiredPanelHeight, maxViewportHeight))
  const availableGridHeight = Math.max(PANEL_MIN_GRID_HEIGHT, panelHeight - PANEL_SEARCH_ROW_HEIGHT)
  gridHeight.value = Math.min(PANEL_DEFAULT_GRID_HEIGHT, availableGridHeight)

  const spaceBelow = window.innerHeight - rect.bottom - PANEL_OFFSET - VIEWPORT_MARGIN
  const spaceAbove = rect.top - PANEL_OFFSET - VIEWPORT_MARGIN
  const shouldOpenUpward = spaceBelow < panelHeight && spaceAbove > spaceBelow

  let top = shouldOpenUpward ? rect.top - panelHeight - PANEL_OFFSET : rect.bottom + PANEL_OFFSET
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN
  if (top + panelHeight > window.innerHeight - VIEWPORT_MARGIN) top = window.innerHeight - VIEWPORT_MARGIN - panelHeight

  panelStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${panelHeight}px`,
    zIndex: '200',
    pointerEvents: 'auto',
  }
}

function handleViewportChange() {
  if (!open.value) return
  positionPanel()
}

function toggle() {
  if (!open.value) {
    activeSource.value = customIconSlugFromValue(props.modelValue) ? 'custom' : 'lucide'
    positionPanel()
  }
  open.value = !open.value
}

watch(open, (isOpen) => {
  emit('open-change', isOpen)
  if (!isOpen) {
    query.value = ''
    window.removeEventListener('resize', handleViewportChange)
    window.visualViewport?.removeEventListener('resize', handleViewportChange)
  } else {
    nextTick(() => {
      positionPanel()
      searchRef.value?.focus()
      window.addEventListener('resize', handleViewportChange)
      window.visualViewport?.addEventListener('resize', handleViewportChange)
      void ensureCustomIconsLoaded().catch(() => undefined)
    })
  }
})

function select(name: string) {
  emit('update:modelValue', name === props.modelValue ? '' : name)
  open.value = false
}

function selectCustom(icon: CustomIcon) {
  const value = customIconValue(icon.slug)
  emit('update:modelValue', value === props.modelValue ? '' : value)
  open.value = false
}

function clearValue() {
  emit('update:modelValue', '')
}

function clearQuery() {
  query.value = ''
}

function selectLucideTab() {
  activeSource.value = 'lucide'
  query.value = ''
}

function selectCustomTab() {
  activeSource.value = 'custom'
  query.value = ''
  void ensureCustomIconsLoaded().catch(() => undefined)
}

// ── Click outside ─────────────────────────────────────────────────────────

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) nextTick(() => document.addEventListener('mousedown', handleOutsideClick))
  else document.removeEventListener('mousedown', handleOutsideClick)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick)
  window.removeEventListener('resize', handleViewportChange)
  window.visualViewport?.removeEventListener('resize', handleViewportChange)
  if (serverSearchTimer) clearTimeout(serverSearchTimer)
})
</script>

<template>
  <!-- Trigger button -->
  <button
    ref="triggerRef"
    type="button"
    @click="toggle"
    class="h-9 flex items-center justify-center gap-2 rounded-md border border-input bg-background shadow-xs text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    :class="[!hideText ? 'w-full px-3' : '', hideText && modelValue ? 'w-9 px-0' : '', hideText && !modelValue ? 'px-3 whitespace-nowrap' : '']"
  >
    <AppIcon v-if="modelValue" :icon="modelValue" :size="16" class="shrink-0" />

    <template v-if="!modelValue">
      <span v-if="!hideText" class="text-muted-foreground flex-1 text-left font-normal truncate">
        {{ placeholder ?? 'Choose an icon...' }}
      </span>
      <span v-else class="text-foreground flex items-center gap-1.5">
        <component :is="LucideIcons.Shapes" :size="14" class="text-muted-foreground" />
        {{ placeholder ?? 'Select icon' }}
      </span>
      <ChevronDown
        v-if="!hideText"
        :size="14"
        class="text-muted-foreground shrink-0 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
      />
    </template>

    <template v-else-if="!hideText">
      <span class="flex-1 text-left text-foreground truncate">{{ selectedLabel }}</span>
      <button
        type="button"
        @click.stop="clearValue"
        class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <X :size="12" />
      </button>
      <ChevronDown :size="14" class="text-muted-foreground shrink-0 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
    </template>
  </button>

  <!-- Floating panel (teleported to avoid overflow clipping) -->
  <Teleport to="body">
    <Transition name="icon-picker-drop">
      <div
        v-if="open"
        ref="panelRef"
        :style="panelStyle"
        data-icon-picker-panel
        class="flex flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
        @focusin.stop
        @focusout.stop
      >
        <div class="border-b border-border shrink-0">
          <div class="grid grid-cols-2 gap-1 px-2.5 pt-2">
            <button
              type="button"
              class="h-8 rounded-md text-xs font-medium transition-colors"
              :class="activeSource === 'lucide' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
              @click="selectLucideTab"
            >
              Lucide
            </button>
            <button
              type="button"
              class="h-8 rounded-md text-xs font-medium transition-colors"
              :class="activeSource === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
              @click="selectCustomTab"
            >
              Custom
            </button>
          </div>
          <div class="flex items-center gap-2 px-3 py-2 border-border shrink-0">
            <Search :size="13" class="text-muted-foreground shrink-0" />
            <input
              ref="searchRef"
              v-model="query"
              type="text"
              :placeholder="searchPlaceholder"
              class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[11px] text-muted-foreground/80">{{ activeCount.toLocaleString() }}</span>
              <button v-if="query" type="button" class="text-muted-foreground hover:text-foreground transition-colors" @click="clearQuery">
                <X :size="13" />
              </button>
            </div>
          </div>
        </div>

        <!-- No results -->
        <div v-if="activeCount === 0" class="flex items-center justify-center py-12 text-xs text-muted-foreground">
          <span v-if="activeSource === 'custom' && (customIconsLoading || customIconsSearching)">Searching...</span>
          <span v-else-if="query">No icons match "{{ query }}"</span>
          <span v-else-if="activeSource === 'custom' && catalogTruncated">Type to search all icons</span>
          <span v-else-if="activeSource === 'custom'">No custom icons uploaded</span>
          <span v-else>No icons available</span>
        </div>

        <!-- Virtual icon grid -->
        <RecycleScroller
          v-else-if="activeSource === 'lucide'"
          class="overflow-y-auto px-2 py-1.5"
          :style="{ height: `${gridHeight}px` }"
          :items="rows"
          :item-size="ROW_HEIGHT"
          key-field="id"
        >
          <template #default="{ item }">
            <div class="flex gap-0.5">
              <Tooltip v-for="name in item.icons" :key="name">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :style="{ width: `calc(100% / ${COLS})`, aspectRatio: '1' }"
                    class="flex items-center justify-center rounded-md transition-colors"
                    :class="modelValue === name ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                    @click="select(name)"
                  >
                    <component :is="getIconComponent(name)" :size="16" />
                  </button>
                </TooltipTrigger>
                <TooltipContent class="z-300">{{ name }}</TooltipContent>
              </Tooltip>
            </div>
          </template>
        </RecycleScroller>

        <RecycleScroller
          v-else
          class="overflow-y-auto px-2 py-1.5"
          :style="{ height: `${gridHeight}px` }"
          :items="customRows"
          :item-size="ROW_HEIGHT"
          key-field="id"
        >
          <template #default="{ item }">
            <div class="flex gap-0.5">
              <Tooltip v-for="icon in item.icons" :key="icon.slug">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :style="{ width: `calc(100% / ${COLS})`, aspectRatio: '1' }"
                    class="flex items-center justify-center rounded-md transition-colors"
                    :class="
                      modelValue === customIconValue(icon.slug)
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    "
                    @click="selectCustom(icon)"
                  >
                    <AppIcon :icon="customIconValue(icon.slug)" :size="16" />
                  </button>
                </TooltipTrigger>
                <TooltipContent class="z-300">{{ icon.name }}</TooltipContent>
              </Tooltip>
            </div>
          </template>
        </RecycleScroller>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>

<style scoped>
.icon-picker-drop-enter-active,
.icon-picker-drop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.icon-picker-drop-enter-from,
.icon-picker-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
