<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy, FileText, Highlighter, Trash2 } from '@lucide/vue'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/clipboard'

const { t } = useI18n()

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
  note: []
  deleteAnnotation: [id: number]
  dismiss: []
}>()

const colors = ANNOTATION_HIGHLIGHT_COLORS
const styles = [
  { id: 'highlight', label: 'H' },
  { id: 'underline', label: 'U' },
  { id: 'strikethrough', label: 'S' },
  { id: 'squiggly', label: '~' },
]

const showColorPicker = ref(false)
const copied = ref(false)
const selectedColor = ref<string>(ANNOTATION_HIGHLIGHT_COLORS[0].hex)
const selectedStyle = ref('highlight')

function handleHighlightClick() {
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

function handleApply() {
  applyHighlight(selectedColor.value, selectedStyle.value)
}

function selectColor(color: string) {
  selectedColor.value = color
}

function selectStyle(style: string) {
  selectedStyle.value = style
}

function handleNote() {
  emit('note')
}

function handleDelete() {
  if (props.overlappingAnnotationId !== null) emit('deleteAnnotation', props.overlappingAnnotationId)
}

async function handleCopy() {
  const didCopy = await copyToClipboard(props.selectedText)
  if (!didCopy) return
  copied.value = true
  await new Promise((resolve) => setTimeout(resolve, 1500))
  copied.value = false
  emit('copy')
}
</script>

<template>
  <div
    v-if="visible"
    class="absolute z-[60] select-none"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      transform: showBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
    }"
    @mousedown.stop
    @pointerdown.stop
  >
    <div class="flex flex-col gap-1 rounded-lg border border-border bg-card p-1.5 text-card-foreground shadow-xl">
      <div class="flex gap-1">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted"
              :class="copied ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
              :aria-label="copied ? t('reader.selection.copied') : t('reader.selection.copy')"
              @click="handleCopy"
            >
              <Check v-if="copied" :size="15" />
              <Copy v-else :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ copied ? t('reader.selection.copied') : t('reader.selection.copy') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted"
              :class="showColorPicker ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
              :aria-label="t('reader.selection.highlight')"
              @click="handleHighlightClick"
            >
              <Highlighter :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('reader.selection.highlight') }}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="t('reader.note.title')"
              @click="handleNote"
            >
              <FileText :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('reader.note.title') }}</TooltipContent>
        </Tooltip>

        <Tooltip v-if="overlappingAnnotationId !== null">
          <TooltipTrigger as-child>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-muted"
              :aria-label="t('reader.selection.deleteAnnotation')"
              @click="handleDelete"
            >
              <Trash2 :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('reader.selection.deleteAnnotation') }}</TooltipContent>
        </Tooltip>
      </div>

      <div v-if="showColorPicker" class="space-y-1.5 border-t border-border pt-1.5">
        <div class="flex gap-1 px-0.5">
          <button
            v-for="c in colors"
            :key="c.hex"
            class="h-6 w-6 rounded-full border-2 transition-all hover:scale-110"
            :class="selectedColor === c.hex ? 'scale-110 border-foreground' : 'border-transparent'"
            :style="{ background: c.hex }"
            :title="c.label"
            @click="selectColor(c.hex)"
          >
            <span class="sr-only">{{ c.label }}</span>
          </button>
        </div>
        <div class="flex gap-1 px-0.5">
          <button
            v-for="s in styles"
            :key="s.id"
            class="h-6 w-6 rounded border text-xs font-bold transition-colors"
            :class="
              selectedStyle === s.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'
            "
            @click="selectStyle(s.id)"
          >
            {{ s.label }}
          </button>
          <button
            class="ml-1 flex-1 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            @click="handleApply"
          >
            {{ t('reader.selection.apply') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
