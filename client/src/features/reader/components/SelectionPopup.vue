<script setup lang="ts">
import { ref } from 'vue'
import { Copy, FileText, Highlighter, Search, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  showBelow: boolean
  selectedText: string
  overlappingAnnotationId: number | null
}>()

const emit = defineEmits<{
  copy: []
  highlight: [color: string, style: string]
  search: []
  note: []
  deleteAnnotation: [id: number]
  dismiss: []
}>()

const showColorPicker = ref(false)

const colors = [
  { hex: '#FACC15', label: 'Yellow' },
  { hex: '#4ADE80', label: 'Green' },
  { hex: '#38BDF8', label: 'Blue' },
  { hex: '#F472B6', label: 'Pink' },
  { hex: '#FB923C', label: 'Orange' },
]

const styles = [
  { id: 'highlight', label: 'H' },
  { id: 'underline', label: 'U' },
  { id: 'strikethrough', label: 'S' },
  { id: 'squiggly', label: '~' },
]

const selectedColor = ref('#FACC15')
const selectedStyle = ref('highlight')

function onHighlightClick() {
  if (showColorPicker.value) {
    emit('highlight', selectedColor.value, selectedStyle.value)
    showColorPicker.value = false
  } else {
    showColorPicker.value = true
  }
}

function applyHighlight(color: string, style: string) {
  selectedColor.value = color
  selectedStyle.value = style
  emit('highlight', color, style)
  showColorPicker.value = false
}

function onCopy() {
  navigator.clipboard.writeText(props.selectedText).catch(() => {})
  emit('copy')
}
</script>

<template>
  <Teleport to="body">
  <template v-if="visible">
    <div class="fixed inset-0 z-[59]" @click="emit('dismiss')" />
    <div
      class="fixed z-[60] select-none"
      :style="{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: showBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
      }"
      @mousedown.stop
    >
    <div class="bg-card text-card-foreground rounded-xl shadow-xl border border-border p-1.5 flex flex-col gap-1">
      <div class="flex gap-1">
        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          @click="onCopy"
          title="Copy"
        >
          <Copy :size="15" />
        </button>

        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors"
          :class="showColorPicker ? 'bg-yellow-100 text-yellow-600' : 'text-muted-foreground hover:text-foreground'"
          @click="onHighlightClick"
          title="Highlight"
        >
          <Highlighter :size="15" />
        </button>

        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          @click="emit('search')"
          title="Search"
        >
          <Search :size="15" />
        </button>

        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          @click="emit('note')"
          title="Add note"
        >
          <FileText :size="15" />
        </button>

        <button
          v-if="overlappingAnnotationId !== null"
          class="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors text-destructive hover:text-destructive/80"
          @click="emit('deleteAnnotation', overlappingAnnotationId!)"
          title="Delete annotation"
        >
          <Trash2 :size="15" />
        </button>
      </div>

      <div v-if="showColorPicker" class="border-t border-border pt-1.5 space-y-1.5">
        <div class="flex gap-1 px-0.5">
          <button
            v-for="c in colors"
            :key="c.hex"
            class="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
            :class="selectedColor === c.hex ? 'border-foreground scale-110' : 'border-transparent'"
            :style="{ background: c.hex }"
            :title="c.label"
            @click="selectedColor = c.hex"
          />
        </div>
        <div class="flex gap-1 px-0.5">
          <button
            v-for="s in styles"
            :key="s.id"
            class="w-6 h-6 rounded text-xs font-bold transition-colors border"
            :class="
              selectedStyle === s.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted text-muted-foreground'
            "
            :title="s.id"
            @click="selectedStyle = s.id"
          >
            {{ s.label }}
          </button>
          <button
            class="flex-1 ml-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="applyHighlight(selectedColor, selectedStyle)"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
    </div>
  </template>
  </Teleport>
</template>
