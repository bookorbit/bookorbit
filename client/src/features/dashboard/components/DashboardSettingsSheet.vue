<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Columns2, GripVertical, Plus, RotateCcw, Rows3, Trash2 } from '@lucide/vue'

import type { ScrollerConfig, ScrollerType, WidgetConfig } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { DEFAULT_SCROLLERS, SCROLLER_LABELS, SHELF_LAYOUT, useDashboardConfig, type DashboardShelfLayout } from '../composables/useDashboardConfig'
import { SHELF_ROW_OPTIONS } from '../lib/shelf-rows'
import { useDashboardLabels } from '../composables/useDashboardLabels'
import { useDashboardWidgets } from '../composables/useDashboardWidgets'
import { useDraggableList } from '../composables/useDraggableList'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>()

const { t } = useI18n()

const { scrollers, shelfLayout, saveShelfSettings, MAX_SCROLLERS } = useDashboardConfig()
const { widgets, libraryIds, saveWidgets, saveLibraryScope, DEFAULT_WIDGETS } = useDashboardWidgets()
const { smartScopes, fetchSmartScopes } = useSmartScopes()
const { libraries, fetchLibraries } = useLibraries()
const { widgetName, shelfTypeName } = useDashboardLabels()

const activeTab = ref<'widgets' | 'shelves'>('shelves')
const draft = ref<ScrollerConfig[]>([])
const shelfLayoutDraft = ref<DashboardShelfLayout>(SHELF_LAYOUT.WIDE)
const widgetDraft = ref<WidgetConfig[]>([])
const libraryIdsDraft = ref<number[] | null>(null)
const libraryScopeOpen = ref(false)
const saving = ref(false)
const bookLibraries = computed(() => libraries.value)
const accessibleLibraryIds = computed(() => new Set(bookLibraries.value.map((library) => library.id)))
const selectedAccessibleLibraryIds = computed<number[] | null>(() =>
  libraryIdsDraft.value === null ? null : libraryIdsDraft.value.filter((libraryId) => accessibleLibraryIds.value.has(libraryId)),
)
const hasValidLibrarySelection = computed(() => selectedAccessibleLibraryIds.value === null || selectedAccessibleLibraryIds.value.length > 0)

const MAX_SUMMARY_NAMES = 3
const librarySelectionSummary = computed(() => {
  const selected = selectedAccessibleLibraryIds.value
  if (selected === null) return t('dashboard.settings.libraryScope.allLibraries')
  if (selected.length === 0) return t('dashboard.settings.libraryScope.summaryNone')
  if (selected.length > MAX_SUMMARY_NAMES) return t('dashboard.settings.libraryScope.summaryCount', { count: selected.length }, selected.length)
  const selectedIds = new Set(selected)
  return formatList(bookLibraries.value.filter((library) => selectedIds.has(library.id)).map((library) => library.name))
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      draft.value = (Array.isArray(scrollers.value) ? scrollers.value : DEFAULT_SCROLLERS).map((s) => ({ ...s }))
      shelfLayoutDraft.value = shelfLayout.value
      widgetDraft.value = widgets.value.map((w) => ({ ...w }))
      libraryIdsDraft.value = libraryIds.value ? [...libraryIds.value] : null
      libraryScopeOpen.value = false
      fetchSmartScopes()
      fetchLibraries()
    }
  },
)

// ── Drag to reorder ──────────────────────────────────────────
const { draggedIndex, dragOverIndex, onDragStart, onDragOver, onDrop, onDragEnd, moveUp, moveDown } = useDraggableList(draft)

const {
  draggedIndex: widgetDraggedIndex,
  dragOverIndex: widgetDragOverIndex,
  onDragStart: onWidgetDragStart,
  onDragOver: onWidgetDragOver,
  onDrop: onWidgetDrop,
  onDragEnd: onWidgetDragEnd,
  moveUp: widgetMoveUp,
  moveDown: widgetMoveDown,
} = useDraggableList(widgetDraft)
// ── Add / Remove ─────────────────────────────────────────────
const ALL_TYPES: ScrollerType[] = [
  'continue-reading',
  'continue-listening',
  'want-to-read',
  'up-next-in-series',
  'recently-added',
  'random',
  'smart-scope',
]

function addScroller() {
  if (draft.value.length >= MAX_SCROLLERS) return
  const maxId = Math.max(0, ...draft.value.map((s) => Number(s.id)))
  draft.value.push({
    id: String(maxId + 1),
    type: 'recently-added',
    label: SCROLLER_LABELS['recently-added'],
    enabled: true,
    order: draft.value.length + 1,
    limit: 20,
    rows: 1,
  })
}

function setShelfRows(scroller: ScrollerConfig, rows: number) {
  scroller.rows = rows
}

function removeScroller(index: number) {
  if (draft.value.length <= 1) return
  draft.value.splice(index, 1)
}

function onTypeChange(scroller: ScrollerConfig) {
  if (scroller.type === 'smart-scope') {
    const firstSmartScope = smartScopes.value[0]
    scroller.smartScopeId = firstSmartScope?.id
    scroller.label = firstSmartScope?.name ?? 'SmartScope'
  } else {
    scroller.smartScopeId = undefined
    scroller.label = SCROLLER_LABELS[scroller.type]
  }
}

function onSmartScopeChange(scroller: ScrollerConfig) {
  const smartScope = smartScopes.value.find((l) => l.id === scroller.smartScopeId)
  if (smartScope) scroller.label = smartScope.name
}

function toggleLibraryScope() {
  libraryScopeOpen.value = !libraryScopeOpen.value
}

function handleAllLibrariesChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  libraryIdsDraft.value = checked ? null : bookLibraries.value.map((library) => library.id)
}

function handleLibraryChange(libraryId: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const selected = new Set(libraryIdsDraft.value ?? bookLibraries.value.map((library) => library.id))
  if (checked) selected.add(libraryId)
  else selected.delete(libraryId)
  libraryIdsDraft.value = [...selected]
}

// ── Save / Reset / Close ─────────────────────────────────────
async function saveShelves() {
  saveShelfSettings(draft.value, shelfLayoutDraft.value)
  await saveLibraryScope(selectedAccessibleLibraryIds.value)
}

function selectWideShelfLayout() {
  shelfLayoutDraft.value = SHELF_LAYOUT.WIDE
}

function selectTwoColumnShelfLayout() {
  shelfLayoutDraft.value = SHELF_LAYOUT.TWO_COLUMNS
}

async function saveWidgetSettings() {
  await saveWidgets(widgetDraft.value, selectedAccessibleLibraryIds.value)
}

async function handleSave() {
  if (!hasValidLibrarySelection.value) {
    libraryScopeOpen.value = true
    return
  }
  saving.value = true
  try {
    if (activeTab.value === 'widgets') await saveWidgetSettings()
    else await saveShelves()
    emit('saved')
    emit('update:open', false)
  } finally {
    saving.value = false
  }
}

function resetToDefault() {
  if (activeTab.value === 'widgets') {
    widgetDraft.value = DEFAULT_WIDGETS.map((w) => ({ ...w }))
  } else {
    draft.value = DEFAULT_SCROLLERS.map((s) => ({ ...s }))
    shelfLayoutDraft.value = SHELF_LAYOUT.WIDE
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <!-- SheetContent defaults to sm:max-w-sm; the override has to match that variant to win in tailwind-merge. -->
    <SheetContent side="right" class="flex w-[90vw] flex-col gap-0 p-0 sm:max-w-[480px]">
      <!-- Header -->
      <SheetHeader class="border-b border-border px-5 py-4">
        <SheetTitle class="text-base font-semibold">{{ t('dashboard.settings.title') }}</SheetTitle>
      </SheetHeader>

      <!-- Tabs -->
      <div class="border-b border-border px-5 py-2">
        <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
          <button
            :class="[
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'shelves' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="activeTab = 'shelves'"
          >
            {{ t('dashboard.settings.tabs.shelves') }}
          </button>
          <button
            :class="[
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'widgets' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="activeTab = 'widgets'"
          >
            {{ t('dashboard.settings.tabs.widgets') }}
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <div class="mb-4 rounded-lg border border-border bg-card">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-expanded="libraryScopeOpen"
            aria-controls="dashboard-library-scope"
            @click="toggleLibraryScope"
          >
            <span class="min-w-0 grow">
              <span class="block text-sm font-medium text-foreground">{{ t('dashboard.settings.libraryScope.title') }}</span>
              <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ librarySelectionSummary }}</span>
            </span>
            <ChevronDown
              :size="16"
              class="shrink-0 text-muted-foreground transition-transform duration-150"
              :class="{ 'rotate-180': libraryScopeOpen }"
              aria-hidden="true"
            />
          </button>
          <fieldset v-show="libraryScopeOpen" id="dashboard-library-scope" class="border-t border-border px-3 pb-3 pt-2">
            <legend class="sr-only">{{ t('dashboard.settings.libraryScope.title') }}</legend>
            <p class="mb-2 text-xs text-muted-foreground">{{ t('dashboard.settings.libraryScope.description') }}</p>
            <div class="space-y-1">
              <label class="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/60">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :checked="libraryIdsDraft === null"
                  @change="handleAllLibrariesChange"
                />
                <span class="font-medium text-foreground">{{ t('dashboard.settings.libraryScope.allLibraries') }}</span>
              </label>
              <div v-if="libraryIdsDraft !== null" class="space-y-0.5 border-s border-border ps-3">
                <label
                  v-for="library in bookLibraries"
                  :key="library.id"
                  class="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :checked="libraryIdsDraft.includes(library.id)"
                    @change="handleLibraryChange(library.id, $event)"
                  />
                  <span class="text-foreground">{{ library.name }}</span>
                </label>
              </div>
            </div>
          </fieldset>
          <p v-if="!hasValidLibrarySelection" role="alert" class="border-t border-border px-3 py-2 text-xs text-destructive">
            {{ t('dashboard.settings.libraryScope.required') }}
          </p>
        </div>

        <!-- SHELVES TAB -->
        <div v-show="activeTab === 'shelves'">
          <fieldset class="mb-5">
            <legend class="text-sm font-medium text-foreground">{{ t('dashboard.settings.shelfLayout.title') }}</legend>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('dashboard.settings.shelfLayout.description') }}</p>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="
                  shelfLayoutDraft === SHELF_LAYOUT.WIDE
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                "
                :aria-pressed="shelfLayoutDraft === SHELF_LAYOUT.WIDE"
                @click="selectWideShelfLayout"
              >
                <Rows3 :size="18" aria-hidden="true" />
                <span>
                  <span class="block text-sm font-medium">{{ t('dashboard.settings.shelfLayout.wide') }}</span>
                  <span class="mt-0.5 block text-xs font-normal">{{ t('dashboard.settings.shelfLayout.wideDescription') }}</span>
                </span>
              </button>
              <button
                type="button"
                class="flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="
                  shelfLayoutDraft === SHELF_LAYOUT.TWO_COLUMNS
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                "
                :aria-pressed="shelfLayoutDraft === SHELF_LAYOUT.TWO_COLUMNS"
                @click="selectTwoColumnShelfLayout"
              >
                <Columns2 :size="18" aria-hidden="true" />
                <span>
                  <span class="block text-sm font-medium">{{ t('dashboard.settings.shelfLayout.twoColumns') }}</span>
                  <span class="mt-0.5 block text-xs font-normal">{{ t('dashboard.settings.shelfLayout.twoColumnsDescription') }}</span>
                </span>
              </button>
            </div>
          </fieldset>

          <p class="text-xs text-muted-foreground">{{ t('dashboard.settings.reorderHintShelf') }}</p>
          <p class="mb-4 mt-1 text-xs text-muted-foreground">{{ t('dashboard.settings.shelfRows.hint') }}</p>

          <div class="space-y-2">
            <div
              v-for="(scroller, index) in draft"
              :key="scroller.id"
              draggable="true"
              class="rounded-lg border border-border bg-card transition-all duration-150"
              :class="{
                'border-primary/50 bg-primary/5 shadow-sm': dragOverIndex === index && draggedIndex !== index,
                'opacity-40': draggedIndex === index,
              }"
              @dragstart="onDragStart(index)"
              @dragover="onDragOver($event, index)"
              @drop="onDrop(index)"
              @dragend="onDragEnd"
            >
              <!-- Main row -->
              <div class="flex items-center gap-3 px-3 py-2.5">
                <!-- Drag handle (desktop) + up/down arrows (mobile fallback) -->
                <div class="flex shrink-0 flex-col items-center">
                  <button
                    class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                    :disabled="index === 0"
                    @click="moveUp(index)"
                  >
                    <ChevronUp :size="13" />
                  </button>
                  <div class="drag-handle cursor-grab text-muted-foreground hover:text-muted-foreground active:cursor-grabbing">
                    <GripVertical :size="16" />
                  </div>
                  <button
                    class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                    :disabled="index === draft.length - 1"
                    @click="moveDown(index)"
                  >
                    <ChevronDown :size="13" />
                  </button>
                </div>

                <!-- Toggle -->
                <button
                  class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none"
                  :class="scroller.enabled ? 'bg-primary' : 'bg-muted'"
                  @click="scroller.enabled = !scroller.enabled"
                >
                  <span
                    class="pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200"
                    :class="scroller.enabled ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>

                <!-- Type selector -->
                <select
                  v-model="scroller.type"
                  class="h-8 min-w-0 flex-1 appearance-none rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  @change="onTypeChange(scroller)"
                >
                  <option v-for="scrollerType in ALL_TYPES" :key="scrollerType" :value="scrollerType">
                    {{ shelfTypeName(scrollerType) }}
                  </option>
                </select>

                <!-- Rows -->
                <div
                  data-testid="shelf-rows"
                  role="group"
                  :aria-label="t('dashboard.settings.shelfRows.label')"
                  class="flex shrink-0 overflow-hidden rounded-md border border-input"
                >
                  <button
                    v-for="rowOption in SHELF_ROW_OPTIONS"
                    :key="rowOption"
                    type="button"
                    class="h-8 w-7 border-e border-input text-xs font-medium tabular-nums transition-colors last:border-e-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :class="
                      scroller.rows === rowOption
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    "
                    :aria-pressed="scroller.rows === rowOption"
                    :aria-label="t('dashboard.settings.shelfRows.option', { count: rowOption })"
                    @click="setShelfRows(scroller, rowOption)"
                  >
                    {{ rowOption }}
                  </button>
                </div>

                <!-- Remove -->
                <button
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                  :disabled="draft.length <= 1"
                  @click="removeScroller(index)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>

              <!-- SmartScope picker (shown only when type = smartScope) -->
              <div v-if="scroller.type === 'smart-scope'" class="border-t border-border/50 px-3 pb-2.5 pt-2">
                <label class="mb-1.5 block text-[11px] font-medium text-muted-foreground">{{ t('dashboard.settings.smartScope') }}</label>
                <select
                  v-if="smartScopes.length > 0"
                  v-model="scroller.smartScopeId"
                  class="h-8 w-full appearance-none rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  @change="onSmartScopeChange(scroller)"
                >
                  <option v-for="smartScope in smartScopes" :key="smartScope.id" :value="smartScope.id">{{ smartScope.name }}</option>
                </select>
                <p v-else class="text-xs text-muted-foreground">{{ t('dashboard.settings.noSmartScopes') }}</p>
              </div>
            </div>
          </div>

          <!-- Add shelf -->
          <button
            class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            :disabled="draft.length >= MAX_SCROLLERS"
            @click="addScroller"
          >
            <Plus :size="15" />
            {{ t('dashboard.settings.addShelf') }}
            <span class="text-xs opacity-60">({{ draft.length }}/{{ MAX_SCROLLERS }})</span>
          </button>
        </div>

        <!-- WIDGETS TAB -->
        <div v-show="activeTab === 'widgets'">
          <p class="mb-4 text-xs text-muted-foreground">{{ t('dashboard.settings.reorderHintWidget') }}</p>

          <div class="space-y-2">
            <div
              v-for="(widget, index) in widgetDraft"
              :key="widget.id"
              draggable="true"
              class="rounded-lg border border-border bg-card transition-all duration-150"
              :class="{
                'border-primary/50 bg-primary/5 shadow-sm': widgetDragOverIndex === index && widgetDraggedIndex !== index,
                'opacity-40': widgetDraggedIndex === index,
              }"
              @dragstart="onWidgetDragStart(index)"
              @dragover="onWidgetDragOver($event, index)"
              @drop="onWidgetDrop(index)"
              @dragend="onWidgetDragEnd"
            >
              <div class="flex items-center gap-3 px-3 py-2.5">
                <div class="flex shrink-0 flex-col items-center">
                  <button
                    class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                    :disabled="index === 0"
                    @click="widgetMoveUp(index)"
                  >
                    <ChevronUp :size="13" />
                  </button>
                  <div class="drag-handle cursor-grab text-muted-foreground hover:text-muted-foreground active:cursor-grabbing">
                    <GripVertical :size="16" />
                  </div>
                  <button
                    class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                    :disabled="index === widgetDraft.length - 1"
                    @click="widgetMoveDown(index)"
                  >
                    <ChevronDown :size="13" />
                  </button>
                </div>

                <button
                  class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none"
                  :class="widget.enabled ? 'bg-primary' : 'bg-muted'"
                  @click="widget.enabled = !widget.enabled"
                >
                  <span
                    class="pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200"
                    :class="widget.enabled ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>

                <span class="flex-1 text-sm font-medium">{{ widgetName(widget.type) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t border-border px-5 py-4">
        <button class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground" @click="resetToDefault">
          <RotateCcw :size="13" />
          {{ t('dashboard.settings.resetToDefaults') }}
        </button>
        <div class="flex items-center gap-2">
          <button
            class="h-8 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('update:open', false)"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="h-8 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            :disabled="saving || !hasValidLibrarySelection"
            @click="handleSave"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* On pointer-fine devices (mouse), hide the up/down buttons; drag handles suffice */
@media (pointer: fine) {
  .touch-reorder-btn {
    display: none;
  }
}

/* On touch/coarse devices, hide the drag handle since HTML5 drag doesn't work on touch */
@media (pointer: coarse) {
  .drag-handle {
    display: none;
  }
}
</style>
