<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, GripVertical } from '@lucide/vue'
import { METADATA_LABELS, FORMAT_LABELS } from '../composables/useLibraryCreator'

const { t } = useI18n()

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

function moveItem(list: string[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction
  if (target < 0 || target >= list.length) return null
  const updated = [...list]
  const [item] = updated.splice(index, 1)
  if (item === undefined) return null
  updated.splice(target, 0, item)
  return updated
}

function moveMetadata(index: number, direction: -1 | 1) {
  const updated = moveItem(props.metadataPrecedence, index, direction)
  if (updated) emit('update:metadataPrecedence', updated)
}

function moveFormat(index: number, direction: -1 | 1) {
  const updated = moveItem(props.formatPriority, index, direction)
  if (updated) emit('update:formatPriority', updated)
}
</script>

<template>
  <div class="px-6 py-6 space-y-6">
    <!-- Source precedence -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">
        {{ t('library.creator.metadata.sourcePrecedence.title') }}
      </p>
      <p class="text-xs text-muted-foreground mb-3">{{ t('library.creator.metadata.sourcePrecedence.hint') }}</p>
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
          @drop="metaDrag.onDrop"
          @dragend="metaDrag.onDragEnd"
        >
          <GripVertical :size="13" class="text-muted-foreground/50 shrink-0" />
          <span class="flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 text-primary text-[9px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm text-foreground truncate">{{ METADATA_LABELS[key] ?? key }}</span>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="`Move ${METADATA_LABELS[key] ?? key} up`"
              @click="moveMetadata(index, -1)"
            >
              <ChevronUp :size="14" />
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === metadataPrecedence.length - 1"
              :aria-label="`Move ${METADATA_LABELS[key] ?? key} down`"
              @click="moveMetadata(index, 1)"
            >
              <ChevronDown :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Format priority -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">
        {{ t('library.creator.metadata.formatPriority.title') }}
      </p>
      <p class="text-xs text-muted-foreground mb-3">{{ t('library.creator.metadata.formatPriority.hint') }}</p>
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
          @drop="fmtDrag.onDrop"
          @dragend="fmtDrag.onDragEnd"
        >
          <GripVertical :size="13" class="text-muted-foreground/50 shrink-0" />
          <span class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10.5px] font-bold shrink-0">
            {{ index + 1 }}
          </span>
          <span class="flex-1 text-sm font-mono text-foreground uppercase">{{ fmt }}</span>
          <span class="hidden text-xs text-muted-foreground sm:block">{{ FORMAT_LABELS[fmt] ?? fmt }}</span>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="`Move ${fmt.toUpperCase()} up`"
              @click="moveFormat(index, -1)"
            >
              <ChevronUp :size="14" />
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === formatPriority.length - 1"
              :aria-label="`Move ${fmt.toUpperCase()} down`"
              @click="moveFormat(index, 1)"
            >
              <ChevronDown :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
