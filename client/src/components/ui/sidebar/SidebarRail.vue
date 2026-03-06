<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { onBeforeUnmount, ref } from 'vue'
import { cn } from '@/lib/utils'
import { useSidebar } from './utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const { toggleSidebar, setWidth, widthPx, state } = useSidebar()

const DRAG_THRESHOLD_PX = 3

const activePointerId = ref<number | null>(null)
const dragStartX = ref(0)
const dragStartWidth = ref(0)
const dragSide = ref<'left' | 'right'>('left')
const isResizeGesture = ref(false)
const didDrag = ref(false)

function resolveSide(target: EventTarget | null): 'left' | 'right' {
  const element = target instanceof HTMLElement ? target : null
  const side = element?.closest('[data-side]')?.getAttribute('data-side')
  return side === 'right' ? 'right' : 'left'
}

function onPointerMove(event: PointerEvent) {
  if (activePointerId.value === null || event.pointerId !== activePointerId.value) return
  if (!isResizeGesture.value) return

  const deltaX = event.clientX - dragStartX.value
  if (Math.abs(deltaX) >= DRAG_THRESHOLD_PX) {
    didDrag.value = true
  }

  const nextWidth = dragSide.value === 'left' ? dragStartWidth.value + deltaX : dragStartWidth.value - deltaX
  setWidth(nextWidth)
}

function cleanupDragListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerEnd)
  window.removeEventListener('pointercancel', onPointerEnd)
}

function resetDragState() {
  activePointerId.value = null
  isResizeGesture.value = false
  didDrag.value = false
}

function onPointerEnd(event: PointerEvent) {
  if (activePointerId.value === null || event.pointerId !== activePointerId.value) return

  const shouldToggleSidebar = event.type === 'pointerup' && !didDrag.value
  cleanupDragListeners()
  resetDragState()

  if (shouldToggleSidebar) {
    toggleSidebar()
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return

  activePointerId.value = event.pointerId
  dragStartX.value = event.clientX
  dragStartWidth.value = widthPx.value
  dragSide.value = resolveSide(event.currentTarget)
  isResizeGesture.value = state.value === 'expanded'
  didDrag.value = false

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
  event.preventDefault()
}

onBeforeUnmount(() => {
  cleanupDragListeners()
  resetDragState()
})
</script>

<template>
  <button
    data-sidebar="rail"
    data-slot="sidebar-rail"
    aria-label="Toggle Sidebar"
    :tabindex="-1"
    :class="
      cn(
        'hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-[2px] after:rounded-full group-data-[variant=floating]:after:top-3 group-data-[variant=floating]:after:bottom-3 sm:flex',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        props.class,
      )
    "
    @pointerdown="onPointerDown"
  >
    <slot />
  </button>
</template>
