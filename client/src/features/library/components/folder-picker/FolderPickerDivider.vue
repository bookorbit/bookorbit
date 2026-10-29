<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLAN_WIDTH } from '../../composables/folder-picker/usePickerPlanWidth'

const props = defineProps<{
  width: number
  /** Width of the grid the divider splits, for the limits. */
  gridWidth: () => number
  clamp: (value: number, gridWidth: number) => number
}>()

const emit = defineEmits<{
  'update:width': [value: number]
  commit: []
}>()

const { t } = useI18n()
const handle = ref<HTMLElement | null>(null)
const dragging = ref(false)
let stopDrag: (() => void) | null = null

function onPointerDown(event: PointerEvent) {
  const element = handle.value
  const grid = element?.parentElement
  if (!element || !grid) return
  event.preventDefault()
  element.focus({ preventScroll: true })
  element.setPointerCapture(event.pointerId)
  dragging.value = true
  const rect = grid.getBoundingClientRect()
  const scale = rect.width / grid.offsetWidth || 1
  const rtl = getComputedStyle(grid).direction === 'rtl'
  const move = (moveEvent: PointerEvent) => {
    const fromEnd = rtl ? moveEvent.clientX - rect.left : rect.right - moveEvent.clientX
    emit('update:width', props.clamp(fromEnd / scale, grid.offsetWidth))
  }
  const end = () => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', end)
    element.removeEventListener('pointercancel', end)
    dragging.value = false
    stopDrag = null
    emit('commit')
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', end)
  element.addEventListener('pointercancel', end)
  stopDrag = end
}

function onDoubleClick() {
  emit('update:width', props.clamp(PLAN_WIDTH.default, props.gridWidth()))
  emit('commit')
}

function onKeydown(event: KeyboardEvent) {
  const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl'
  const grow = ({ ArrowLeft: rtl ? -1 : 1, ArrowRight: rtl ? 1 : -1 } as Record<string, number>)[event.key]
  let next: number
  if (grow) next = props.width + grow * PLAN_WIDTH.step
  else if (event.key === 'Home') next = PLAN_WIDTH.min
  else if (event.key === 'End') next = Number.POSITIVE_INFINITY
  else if (event.key === 'Enter') next = PLAN_WIDTH.default
  else return
  event.preventDefault()
  event.stopPropagation()
  emit('update:width', props.clamp(next, props.gridWidth()))
  emit('commit')
}

onBeforeUnmount(() => stopDrag?.())
</script>

<template>
  <!-- Sits on the border the halves already share: a faint grip at rest, a line on hover, focus or drag. -->
  <div
    ref="handle"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('library.folderBrowser.divider.label')"
    :aria-valuemin="PLAN_WIDTH.min"
    :aria-valuemax="Math.max(PLAN_WIDTH.min, gridWidth() - PLAN_WIDTH.treeMin)"
    :aria-valuenow="width"
    :title="t('library.folderBrowser.divider.title')"
    class="group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none focus-visible:outline-none"
    :data-dragging="dragging ? '' : undefined"
    :style="{ insetInlineEnd: `${width - 4}px` }"
    @pointerdown="onPointerDown"
    @dblclick="onDoubleClick"
    @keydown="onKeydown"
  >
    <span
      class="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 transition-[width,background-color] duration-150 group-hover:w-[3px] group-hover:bg-primary/60 group-focus-visible:w-[3px] group-focus-visible:bg-primary group-data-[dragging]:w-[3px] group-data-[dragging]:bg-primary"
    />
    <span
      class="absolute start-1/2 top-1/2 h-9 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background transition-colors group-hover:border-primary/60 group-data-[dragging]:border-primary"
    />
  </div>
</template>
