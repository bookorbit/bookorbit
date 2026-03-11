<script setup lang="ts">
import { ref } from 'vue'
import { GripVertical, Plus, X } from 'lucide-vue-next'
import { METADATA_LABELS, FORMAT_LABELS } from '../composables/useLibraryCreator'

const props = defineProps<{
  metadataPrecedence: string[]
  formatPriority: string[]
  allowedFormats: string[]
  excludePatterns: string[]
}>()

const emit = defineEmits<{
  'update:metadataPrecedence': [value: string[]]
  'update:formatPriority': [value: string[]]
  'update:allowedFormats': [value: string[]]
  'update:excludePatterns': [value: string[]]
}>()

// ── Drag-and-drop for reorderable lists ──────────────────────────────────────

function useDragList(getList: () => string[], onUpdate: (v: string[]) => void) {
  const dragFrom = ref<number | null>(null)
  const dragOver = ref<number | null>(null)

  function onDragStart(i: number) {
    dragFrom.value = i
  }
  function onDragEnter(i: number) {
    dragOver.value = i
  }
  function onDrop() {
    if (dragFrom.value === null || dragOver.value === null || dragFrom.value === dragOver.value) return
    const list = [...getList()]
    const [item] = list.splice(dragFrom.value, 1)
    if (item !== undefined) list.splice(dragOver.value, 0, item)
    onUpdate(list)
    dragFrom.value = null
    dragOver.value = null
  }
  function onDragEnd() {
    dragFrom.value = null
    dragOver.value = null
  }

  return { dragFrom, dragOver, onDragStart, onDragEnter, onDrop, onDragEnd }
}

const metaDrag = useDragList(
  () => props.metadataPrecedence,
  (v) => emit('update:metadataPrecedence', v),
)
const fmtDrag = useDragList(
  () => props.formatPriority,
  (v) => emit('update:formatPriority', v),
)

// ── Allowed formats ──────────────────────────────────────────────────────────

const ALL_FORMATS = Object.keys(FORMAT_LABELS)

function toggleAllowedFormat(fmt: string) {
  const current = [...props.allowedFormats]
  const idx = current.indexOf(fmt)
  if (idx === -1) {
    current.push(fmt)
  } else {
    current.splice(idx, 1)
  }
  emit('update:allowedFormats', current)
}

// ── Exclude patterns ─────────────────────────────────────────────────────────

const newPattern = ref('')

function addPattern() {
  const trimmed = newPattern.value.trim()
  if (!trimmed || props.excludePatterns.includes(trimmed)) return
  emit('update:excludePatterns', [...props.excludePatterns, trimmed])
  newPattern.value = ''
}

function removePattern(i: number) {
  const updated = [...props.excludePatterns]
  updated.splice(i, 1)
  emit('update:excludePatterns', updated)
}

function onPatternKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addPattern()
  }
}
</script>

<template>
  <div class="px-6 py-6 space-y-8">
    <!-- Metadata precedence -->
    <div>
      <h3 class="text-sm font-semibold text-foreground mb-1">Metadata precedence</h3>
      <p class="text-xs text-muted-foreground mb-3">Drag to reorder. The source higher in the list is preferred when both are present.</p>
      <div class="rounded-lg border border-border overflow-hidden divide-y divide-border">
        <div
          v-for="(key, index) in metadataPrecedence"
          :key="key"
          draggable="true"
          class="flex items-center gap-3 px-4 py-3 bg-card cursor-grab active:cursor-grabbing select-none transition-colors"
          :class="metaDrag.dragOver.value === index ? 'bg-primary/5' : ''"
          @dragstart="metaDrag.onDragStart(index)"
          @dragenter.prevent="metaDrag.onDragEnter(index)"
          @dragover.prevent
          @drop="metaDrag.onDrop()"
          @dragend="metaDrag.onDragEnd()"
        >
          <GripVertical :size="14" class="text-muted-foreground/40 shrink-0" />
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm text-foreground">{{ METADATA_LABELS[key] ?? key }}</span>
        </div>
      </div>
    </div>

    <!-- Format priority -->
    <div>
      <h3 class="text-sm font-semibold text-foreground mb-1">Format priority</h3>
      <p class="text-xs text-muted-foreground mb-3">When a book has multiple formats, prefer the format highest in the list.</p>
      <div class="rounded-lg border border-border overflow-hidden divide-y divide-border">
        <div
          v-for="(fmt, index) in formatPriority"
          :key="fmt"
          draggable="true"
          class="flex items-center gap-3 px-4 py-2.5 bg-card cursor-grab active:cursor-grabbing select-none transition-colors"
          :class="fmtDrag.dragOver.value === index ? 'bg-primary/5' : ''"
          @dragstart="fmtDrag.onDragStart(index)"
          @dragenter.prevent="fmtDrag.onDragEnter(index)"
          @dragover.prevent
          @drop="fmtDrag.onDrop()"
          @dragend="fmtDrag.onDragEnd()"
        >
          <GripVertical :size="14" class="text-muted-foreground/40 shrink-0" />
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm font-mono text-foreground uppercase">{{ fmt }}</span>
          <span class="text-xs text-muted-foreground">{{ FORMAT_LABELS[fmt] ?? fmt }}</span>
        </div>
      </div>
    </div>

    <!-- Allowed formats -->
    <div>
      <h3 class="text-sm font-semibold text-foreground mb-1">Allowed formats</h3>
      <p class="text-xs text-muted-foreground mb-3">
        {{ allowedFormats.length === 0 ? 'All formats are allowed.' : 'Only the selected formats will be imported.' }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="fmt in ALL_FORMATS"
          :key="fmt"
          class="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
          :class="
            allowedFormats.length === 0 || allowedFormats.includes(fmt)
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
          "
          @click="toggleAllowedFormat(fmt)"
        >
          {{ fmt.toUpperCase() }}
        </button>
      </div>
      <p v-if="allowedFormats.length > 0" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
        Books in other formats already in the library will be marked as missing on the next scan.
      </p>
    </div>

    <!-- Exclude patterns -->
    <div>
      <h3 class="text-sm font-semibold text-foreground mb-1">Exclude patterns</h3>
      <p class="text-xs text-muted-foreground mb-3">
        Glob patterns to skip during scanning (e.g. <code class="font-mono bg-muted px-1 rounded">**/samples/**</code>).
      </p>
      <div class="flex gap-2 mb-3">
        <input
          v-model="newPattern"
          type="text"
          placeholder="**/node_modules/**"
          class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          @keydown="onPatternKeydown"
        />
        <button
          class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          @click="addPattern"
        >
          <Plus :size="14" />
          Add
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="(pattern, i) in excludePatterns"
          :key="pattern"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border text-xs font-mono text-foreground"
        >
          {{ pattern }}
          <button class="text-muted-foreground hover:text-destructive transition-colors" @click="removePattern(i)">
            <X :size="11" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>
