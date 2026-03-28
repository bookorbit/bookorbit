<script setup lang="ts">
import { ref } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import { METADATA_LABELS, FORMAT_LABELS } from '../composables/useLibraryCreator'

const props = defineProps<{
  metadataPrecedence: string[]
  formatPriority: string[]
}>()

const emit = defineEmits<{
  'update:metadataPrecedence': [value: string[]]
  'update:formatPriority': [value: string[]]
}>()

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
</script>

<template>
  <div class="px-6 py-6 space-y-6">
    <!-- Source precedence -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">Source precedence</p>
      <p class="text-xs text-muted-foreground mb-3">The highest source in the list is preferred when multiple are available.</p>
      <div class="rounded-lg border border-border overflow-hidden divide-y divide-border">
        <div
          v-for="(key, index) in metadataPrecedence"
          :key="key"
          draggable="true"
          class="flex items-center gap-3 px-3 py-2.5 bg-card cursor-grab active:cursor-grabbing select-none transition-colors"
          :class="metaDrag.dragOver.value === index ? 'bg-primary/10 border-l-2 border-l-primary' : ''"
          @dragstart="metaDrag.onDragStart(index)"
          @dragenter.prevent="metaDrag.onDragEnter(index)"
          @dragover.prevent
          @drop="metaDrag.onDrop()"
          @dragend="metaDrag.onDragEnd()"
        >
          <GripVertical :size="13" class="text-muted-foreground/50 shrink-0" />
          <span class="flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm text-foreground truncate">{{ METADATA_LABELS[key] ?? key }}</span>
        </div>
      </div>
    </div>

    <!-- Format priority -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">Format priority</p>
      <p class="text-xs text-muted-foreground mb-3">When a book has multiple formats, the format highest in the list is preferred.</p>
      <div class="rounded-lg border border-border overflow-hidden divide-y divide-border">
        <div
          v-for="(fmt, index) in formatPriority"
          :key="fmt"
          draggable="true"
          class="flex items-center gap-3 px-3 py-2.5 bg-card cursor-grab active:cursor-grabbing select-none transition-colors"
          :class="fmtDrag.dragOver.value === index ? 'bg-primary/10 border-l-2 border-l-primary' : ''"
          @dragstart="fmtDrag.onDragStart(index)"
          @dragenter.prevent="fmtDrag.onDragEnter(index)"
          @dragover.prevent
          @drop="fmtDrag.onDrop()"
          @dragend="fmtDrag.onDragEnd()"
        >
          <GripVertical :size="13" class="text-muted-foreground/50 shrink-0" />
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10.5px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm font-mono text-foreground uppercase">{{ fmt }}</span>
          <span class="text-xs text-muted-foreground">{{ FORMAT_LABELS[fmt] ?? fmt }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
