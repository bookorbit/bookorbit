<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { Sheet, SheetContent } from '@/components/ui/sheet'

export type ReaderSheetSnap = 'peek' | 'full'

const PEEK_RATIO = 0.56
const FULL_RATIO = 0.92
const DISMISS_RATIO = 0.3
const SNAP_MIDPOINT = (PEEK_RATIO + FULL_RATIO) / 2

const props = withDefaults(
  defineProps<{
    open: boolean
    label: string
    snap?: ReaderSheetSnap
  }>(),
  { snap: 'peek' },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:snap': [snap: ReaderSheetSnap]
}>()

const reducedMotion = usePreferredReducedMotion()
const draggedHeight = ref<number | null>(null)
const dragging = ref(false)

let pointerId: number | null = null
let startY = 0
let startHeight = 0

const snapRatio = computed(() => (props.snap === 'full' ? FULL_RATIO : PEEK_RATIO))

const sheetStyle = computed(() => ({
  height: draggedHeight.value !== null ? `${draggedHeight.value}px` : `${Math.round(snapRatio.value * 100)}dvh`,
}))

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight
}

function setSnap(snap: ReaderSheetSnap) {
  if (snap !== props.snap) emit('update:snap', snap)
}

function toggleSnap() {
  setSnap(props.snap === 'peek' ? 'full' : 'peek')
}

function handleGrabberKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    setSnap('full')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setSnap('peek')
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  toggleSnap()
}

function handlePointerDown(event: PointerEvent) {
  if (!event.isPrimary) return
  pointerId = event.pointerId
  startY = event.clientY
  startHeight = snapRatio.value * viewportHeight()
  draggedHeight.value = startHeight
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointerId) return
  const available = viewportHeight()
  // Dragging up grows the sheet, so the delta is inverted.
  draggedHeight.value = Math.min(Math.max(startHeight - (event.clientY - startY), 0), available * FULL_RATIO)
}

function handlePointerUp(event: PointerEvent) {
  if (event.pointerId !== pointerId) return
  const height = draggedHeight.value
  dragging.value = false
  pointerId = null
  draggedHeight.value = null
  if (height === null) return

  const ratio = height / viewportHeight()
  if (ratio < DISMISS_RATIO) {
    emit('update:open', false)
    return
  }
  setSnap(ratio > SNAP_MIDPOINT ? 'full' : 'peek')
}

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

// A sheet reopened after a drag must not inherit the pixel height it was dropped at.
watch(
  () => props.open,
  (open) => {
    if (open) return
    dragging.value = false
    pointerId = null
    draggedHeight.value = null
  },
)
</script>

<template>
  <Sheet :open="props.open" @update:open="handleOpenChange">
    <!--
      dvh, not vh: `vh` resolves against the large viewport, so with a phone browser's toolbars on
      screen the sheet covers everything and leaves no overlay to tap.
    -->
    <SheetContent
      side="bottom"
      hide-close
      class="max-h-[92dvh] gap-0 overflow-hidden rounded-t-2xl border-border bg-card p-0"
      :class="dragging || reducedMotion === 'reduce' ? '!transition-none !duration-0' : 'transition-[height] duration-200'"
      :style="sheetStyle"
      :aria-label="props.label"
    >
      <div
        class="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        role="button"
        tabindex="0"
        :aria-label="props.snap === 'full' ? $t('reader.sheet.collapse') : $t('reader.sheet.expand')"
        :aria-expanded="props.snap === 'full'"
        @click="toggleSnap"
        @keydown="handleGrabberKeydown"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
      >
        <span aria-hidden="true" class="h-1 w-10 rounded-full bg-border" />
      </div>
      <slot />
    </SheetContent>
  </Sheet>
</template>
