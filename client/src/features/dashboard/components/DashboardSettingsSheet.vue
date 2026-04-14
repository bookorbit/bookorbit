<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-vue-next'

import type { ScrollerConfig, ScrollerType } from '@projectx/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useLenses } from '@/features/lens/composables/useLenses'
import { DEFAULT_SCROLLERS, SCROLLER_LABELS, useDashboardConfig } from '../composables/useDashboardConfig'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { scrollers, saveScrollers, MAX_SCROLLERS } = useDashboardConfig()
const { lenses, fetchLenses } = useLenses()

const draft = ref<ScrollerConfig[]>([])

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      draft.value = (Array.isArray(scrollers.value) ? scrollers.value : DEFAULT_SCROLLERS).map((s) => ({ ...s }))
      fetchLenses()
    }
  },
)

// ── Drag to reorder ──────────────────────────────────────────
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(index: number) {
  draggedIndex.value = index
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  dragOverIndex.value = index
}

function onDrop(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  const items = [...draft.value]
  const [moved] = items.splice(draggedIndex.value, 1)
  if (moved) {
    items.splice(index, 0, moved)
    draft.value = items
  }
  draggedIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  draggedIndex.value = null
  dragOverIndex.value = null
}

// ── Add / Remove ─────────────────────────────────────────────
const ALL_TYPES: ScrollerType[] = ['continue-reading', 'recently-added', 'random', 'lens']

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
  })
}

function removeScroller(index: number) {
  if (draft.value.length <= 1) return
  draft.value.splice(index, 1)
}

function moveUp(index: number) {
  if (index === 0) return
  const items = [...draft.value]
  const current = items[index]
  const prev = items[index - 1]
  if (current && prev) {
    items[index - 1] = current
    items[index] = prev
  }
  draft.value = items
}

function moveDown(index: number) {
  if (index === draft.value.length - 1) return
  const items = [...draft.value]
  const current = items[index]
  const next = items[index + 1]
  if (current && next) {
    items[index + 1] = current
    items[index] = next
  }
  draft.value = items
}

function onTypeChange(scroller: ScrollerConfig) {
  if (scroller.type === 'lens') {
    const firstLens = lenses.value[0]
    scroller.lensId = firstLens?.id
    scroller.label = firstLens?.name ?? 'Lens'
  } else {
    scroller.lensId = undefined
    scroller.label = SCROLLER_LABELS[scroller.type]
  }
}

function onLensChange(scroller: ScrollerConfig) {
  const lens = lenses.value.find((l) => l.id === scroller.lensId)
  if (lens) scroller.label = lens.name
}

// ── Save / Reset / Close ─────────────────────────────────────
function save() {
  saveScrollers(draft.value)
  emit('update:open', false)
}

function resetToDefault() {
  draft.value = DEFAULT_SCROLLERS.map((s) => ({ ...s }))
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="right" class="flex w-[420px] flex-col gap-0 p-0 sm:max-w-[420px]">
      <!-- Header -->
      <SheetHeader class="border-b border-border px-5 py-4">
        <SheetTitle class="text-base font-semibold">Customize Dashboard</SheetTitle>
      </SheetHeader>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <p class="mb-4 text-xs text-muted-foreground">Drag to reorder. Toggle to show or hide a shelf.</p>

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
                  class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                  :disabled="index === 0"
                  @click="moveUp(index)"
                >
                  <ChevronUp :size="13" />
                </button>
                <div class="drag-handle cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing">
                  <GripVertical :size="16" />
                </div>
                <button
                  class="touch-reorder-btn flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
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
                class="h-8 flex-1 appearance-none rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                @change="onTypeChange(scroller)"
              >
                <option v-for="t in ALL_TYPES" :key="t" :value="t">
                  {{ t === 'lens' ? 'Lens' : SCROLLER_LABELS[t] }}
                </option>
              </select>

              <!-- Remove -->
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                :disabled="draft.length <= 1"
                @click="removeScroller(index)"
              >
                <Trash2 :size="14" />
              </button>
            </div>

            <!-- Lens picker (shown only when type = lens) -->
            <div v-if="scroller.type === 'lens'" class="border-t border-border/50 px-3 pb-2.5 pt-2">
              <label class="mb-1.5 block text-[11px] font-medium text-muted-foreground">Lens</label>
              <select
                v-if="lenses.length > 0"
                v-model="scroller.lensId"
                class="h-8 w-full appearance-none rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                @change="onLensChange(scroller)"
              >
                <option v-for="lens in lenses" :key="lens.id" :value="lens.id">{{ lens.name }}</option>
              </select>
              <p v-else class="text-xs text-muted-foreground">No lenses yet. Create one from the sidebar.</p>
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
          Add shelf
          <span class="text-xs opacity-60">({{ draft.length }}/{{ MAX_SCROLLERS }})</span>
        </button>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t border-border px-5 py-4">
        <button class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground" @click="resetToDefault">
          <RotateCcw :size="13" />
          Reset to defaults
        </button>
        <div class="flex items-center gap-2">
          <button
            class="h-8 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="emit('update:open', false)"
          >
            Cancel
          </button>
          <button
            class="h-8 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            @click="save"
          >
            Save
          </button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* On pointer-fine devices (mouse), hide the up/down buttons — drag handles suffice */
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
