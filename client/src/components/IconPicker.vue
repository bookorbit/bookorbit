<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { ChevronDown, Search, X } from 'lucide-vue-next'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  hideText?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// ── Icon list ─────────────────────────────────────────────────────────────

const ALL_ICONS: string[] = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z]/.test(k) && !k.endsWith('Icon') && !k.startsWith('Lucide'))
  .sort()

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name]
}

const selectedIconComponent = computed(() => (props.modelValue ? ((LucideIcons as Record<string, unknown>)[props.modelValue] ?? null) : null))

// ── Virtual grid ──────────────────────────────────────────────────────────

const COLS = 10
const ROW_HEIGHT = 44
const VIEWPORT_MARGIN = 8
const PANEL_OFFSET = 4
const PANEL_MIN_WIDTH = 440
const PANEL_MAX_HEIGHT = 400
const PANEL_SEARCH_ROW_HEIGHT = 44
const PANEL_DEFAULT_GRID_HEIGHT = 320
const PANEL_MIN_GRID_HEIGHT = 140

const query = ref('')

const filteredIcons = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? ALL_ICONS.filter((n) => n.toLowerCase().includes(q)) : ALL_ICONS
})

interface IconRow {
  id: number
  icons: string[]
}

const rows = computed<IconRow[]>(() => {
  const result: IconRow[] = []
  const list = filteredIcons.value
  for (let i = 0; i < list.length; i += COLS) {
    result.push({ id: i, icons: list.slice(i, i + COLS) })
  }
  return result
})

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
  if (!open.value) positionPanel()
  open.value = !open.value
}

watch(open, (isOpen) => {
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
    })
  }
})

function select(name: string) {
  emit('update:modelValue', name === props.modelValue ? '' : name)
  open.value = false
}

function clearValue() {
  emit('update:modelValue', '')
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

onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick))
onUnmounted(() => window.removeEventListener('resize', handleViewportChange))
onUnmounted(() => window.visualViewport?.removeEventListener('resize', handleViewportChange))
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
    <component v-if="selectedIconComponent" :is="selectedIconComponent" :size="16" class="shrink-0" />

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
      <span class="flex-1 text-left text-foreground truncate">{{ modelValue }}</span>
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
      >
        <!-- Search bar -->
        <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <Search :size="13" class="text-muted-foreground shrink-0" />
          <input
            ref="searchRef"
            v-model="query"
            type="text"
            placeholder="Search icons..."
            class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[11px] text-muted-foreground/80">{{ filteredIcons.length.toLocaleString() }}</span>
            <button v-if="query" type="button" @click="query = ''" class="text-muted-foreground hover:text-foreground transition-colors">
              <X :size="13" />
            </button>
          </div>
        </div>

        <!-- No results -->
        <div v-if="filteredIcons.length === 0" class="flex items-center justify-center py-12 text-xs text-muted-foreground">
          No icons match "{{ query }}"
        </div>

        <!-- Virtual icon grid -->
        <RecycleScroller
          v-else
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
                <TooltipContent>{{ name }}</TooltipContent>
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
