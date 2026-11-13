<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { calculateFoldGeometry, renderConicalFold, type Corner } from '../utils/conical-fold'

const props = defineProps<{
  surface: HTMLElement | null
  active: boolean
  currentPage: number
  totalPages: number
  isDark?: boolean
}>()

const emit = defineEmits<{
  turnNext: []
  turnPrev: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLDivElement | null>(null)
const isAnimating = ref(false)
const isDragging = ref(false)
const hoveredCorner = ref<Corner | null>(null)

let activeCorner: Corner = 'bottom-right'
let animationRaf: number | null = null
let cachedSourceCanvas: HTMLCanvasElement | null = null
let pageRect: DOMRect | null = null

const pageGeometry = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
})

function updatePageGeometry() {
  const surface = props.surface
  if (!surface) return null

  const pageElements = Array.from(surface.querySelectorAll<HTMLElement>('[data-page-index]'))
  const surfaceRect = surface.getBoundingClientRect()
  const targetPageEl = pageElements[0] ?? null
  const rect = targetPageEl?.getBoundingClientRect() ?? surfaceRect

  pageRect = rect
  pageGeometry.value = {
    left: Math.max(0, rect.left - surfaceRect.left),
    top: Math.max(0, rect.top - surfaceRect.top),
    width: rect.width,
    height: rect.height,
  }
  return rect
}

function captureActivePageCanvas(): HTMLCanvasElement | null {
  const surface = props.surface
  if (!surface) return null

  const rect = updatePageGeometry()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null

  const dpr = window.devicePixelRatio || 1
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.max(1, Math.round(rect.width * dpr))
  offscreen.height = Math.max(1, Math.round(rect.height * dpr))

  const ctx = offscreen.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = props.isDark ? '#18181b' : '#ffffff'
  ctx.fillRect(0, 0, offscreen.width, offscreen.height)

  const pageElements = Array.from(surface.querySelectorAll<HTMLElement>('[data-page-index]'))
  const targetPageEl = pageElements[0] ?? surface
  const canvases = Array.from(targetPageEl.querySelectorAll('canvas'))

  for (const src of canvases) {
    if (src.width > 0 && src.height > 0) {
      const srcRect = src.getBoundingClientRect()
      const dx = (srcRect.left - rect.left) * dpr
      const dy = (srcRect.top - rect.top) * dpr
      const dw = srcRect.width * dpr
      const dh = srcRect.height * dpr
      try {
        ctx.drawImage(src, dx, dy, dw, dh)
      } catch {}
    }
  }

  return offscreen
}

function drawFold(corner: Corner, touchX: number, touchY: number) {
  const canvas = canvasRef.value
  if (!canvas || !cachedSourceCanvas) return

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  if (width <= 0 || height <= 0) return

  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.scale(dpr, dpr)

  const geom = calculateFoldGeometry(width, height, corner, { x: touchX, y: touchY })
  if (geom) {
    renderConicalFold(ctx, width, height, cachedSourceCanvas, geom, props.isDark, 0.65)
  } else {
    ctx.clearRect(0, 0, width, height)
  }
  ctx.restore()
}

function clearCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function flip(direction: 1 | -1, onReadyToNavigate?: () => void, onComplete?: () => void) {
  if (animationRaf !== null) {
    cancelAnimationFrame(animationRaf)
    animationRaf = null
  }

  const rect = updatePageGeometry()
  if (!rect) {
    onReadyToNavigate?.()
    onComplete?.()
    return
  }

  cachedSourceCanvas = captureActivePageCanvas()
  if (!cachedSourceCanvas) {
    onReadyToNavigate?.()
    onComplete?.()
    return
  }

  isAnimating.value = true
  activeCorner = direction > 0 ? 'bottom-right' : 'bottom-left'

  // Immediately render the next/previous page underneath
  onReadyToNavigate?.()

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  const startX = direction > 0 ? width : 0
  const startY = height
  const targetX = direction > 0 ? -width * 0.45 : width * 1.45
  const targetY = height * 0.85

  const duration = 520
  const startTime = performance.now()

  function frame(now: number) {
    const elapsed = now - startTime
    const t = Math.min(1, elapsed / duration)
    // cubic-bezier(0.22, 1, 0.36, 1) approximation
    const progress = 1 - Math.pow(1 - t, 3)

    const curX = startX + (targetX - startX) * progress
    const curY = startY + (targetY - startY) * progress + Math.sin(progress * Math.PI) * (-height * 0.12)

    drawFold(activeCorner, curX, curY)

    if (t < 1) {
      animationRaf = requestAnimationFrame(frame)
    } else {
      isAnimating.value = false
      animationRaf = null
      clearCanvas()
      cachedSourceCanvas = null
      onComplete?.()
    }
  }

  animationRaf = requestAnimationFrame(frame)
}

function handleCornerPointerDown(corner: Corner, event: PointerEvent) {
  if (!props.active || isAnimating.value || isDragging.value) return
  if (corner === 'bottom-right' || corner === 'top-right') {
    if (props.currentPage >= props.totalPages) return
  } else {
    if (props.currentPage <= 1) return
  }

  updatePageGeometry()
  cachedSourceCanvas = captureActivePageCanvas()
  if (!cachedSourceCanvas) return

  isDragging.value = true
  activeCorner = corner

  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)

  handleCornerPointerMove(event)
}

function handleCornerPointerMove(event: PointerEvent) {
  if (!isDragging.value || !pageRect) return

  const surfaceRect = props.surface?.getBoundingClientRect()
  if (!surfaceRect) return

  const localX = event.clientX - pageRect.left
  const localY = event.clientY - pageRect.top

  drawFold(activeCorner, localX, localY)
}

function handleCornerPointerUp(event: PointerEvent) {
  if (!isDragging.value) return
  isDragging.value = false

  const target = event.currentTarget as HTMLElement
  try {
    target.releasePointerCapture(event.pointerId)
  } catch {}

  const width = pageGeometry.value.width
  const localX = pageRect ? event.clientX - pageRect.left : 0
  const isRightCorner = activeCorner === 'bottom-right' || activeCorner === 'top-right'

  // Threshold: if dragged more than 25% across page, complete flip
  const shouldFlip = isRightCorner ? localX < width * 0.75 : localX > width * 0.25

  if (shouldFlip) {
    if (isRightCorner) {
      emit('turnNext')
    } else {
      emit('turnPrev')
    }
  } else {
    // Snap back
    clearCanvas()
    cachedSourceCanvas = null
  }
}

function handleCornerMouseEnter(corner: Corner) {
  if (isDragging.value || isAnimating.value) return
  hoveredCorner.value = corner
}

function handleCornerMouseLeave() {
  if (isDragging.value || isAnimating.value) return
  hoveredCorner.value = null
}

defineExpose({
  flip,
  isFlipping: computed(() => isAnimating.value || isDragging.value),
})

onUnmounted(() => {
  if (animationRaf !== null) cancelAnimationFrame(animationRaf)
})
</script>

<template>
  <div v-if="props.active" ref="overlayRef" class="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden="true">
    <!-- 2D Conical Fold Canvas -->
    <canvas
      ref="canvasRef"
      class="pointer-events-none absolute"
      :style="{
        left: `${pageGeometry.left}px`,
        top: `${pageGeometry.top}px`,
        width: `${pageGeometry.width}px`,
        height: `${pageGeometry.height}px`,
        visibility: isAnimating || isDragging ? 'visible' : 'hidden',
      }"
    />

    <!-- Interactive Corner Hover / Drag Trigger Zones -->
    <div
      v-if="props.currentPage < props.totalPages"
      class="pointer-events-auto absolute bottom-0 right-0 z-40 h-20 w-20 cursor-pointer"
      :style="{
        right: `calc(100% - ${pageGeometry.left + pageGeometry.width}px)`,
        bottom: `calc(100% - ${pageGeometry.top + pageGeometry.height}px)`,
      }"
      title="Turn to next page"
      @pointerdown="handleCornerPointerDown('bottom-right', $event)"
      @pointermove="handleCornerPointerMove"
      @pointerup="handleCornerPointerUp"
      @pointercancel="handleCornerPointerUp"
      @mouseenter="handleCornerMouseEnter('bottom-right')"
      @mouseleave="handleCornerMouseLeave"
    >
      <!-- Visual corner curl hint on hover -->
      <div
        class="absolute bottom-1 right-1 h-7 w-7 rounded-tl-lg transition-all duration-200"
        :class="[
          hoveredCorner === 'bottom-right'
            ? 'scale-125 bg-gradient-to-tl from-black/25 via-white/40 to-transparent shadow-md'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
    </div>

    <div
      v-if="props.currentPage < props.totalPages"
      class="pointer-events-auto absolute top-0 right-0 z-40 h-20 w-20 cursor-pointer"
      :style="{
        right: `calc(100% - ${pageGeometry.left + pageGeometry.width}px)`,
        top: `${pageGeometry.top}px`,
      }"
      title="Turn to next page"
      @pointerdown="handleCornerPointerDown('top-right', $event)"
      @pointermove="handleCornerPointerMove"
      @pointerup="handleCornerPointerUp"
      @pointercancel="handleCornerPointerUp"
      @mouseenter="handleCornerMouseEnter('top-right')"
      @mouseleave="handleCornerMouseLeave"
    >
      <div
        class="absolute top-1 right-1 h-7 w-7 rounded-bl-lg transition-all duration-200"
        :class="[
          hoveredCorner === 'top-right'
            ? 'scale-125 bg-gradient-to-bl from-black/25 via-white/40 to-transparent shadow-md'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
    </div>

    <!-- Previous Page Corner Hotspots (Left Side) -->
    <div
      v-if="props.currentPage > 1"
      class="pointer-events-auto absolute bottom-0 left-0 z-40 h-20 w-20 cursor-pointer"
      :style="{
        left: `${pageGeometry.left}px`,
        bottom: `calc(100% - ${pageGeometry.top + pageGeometry.height}px)`,
      }"
      title="Turn to previous page"
      @pointerdown="handleCornerPointerDown('bottom-left', $event)"
      @pointermove="handleCornerPointerMove"
      @pointerup="handleCornerPointerUp"
      @pointercancel="handleCornerPointerUp"
      @mouseenter="handleCornerMouseEnter('bottom-left')"
      @mouseleave="handleCornerMouseLeave"
    >
      <div
        class="absolute bottom-1 left-1 h-7 w-7 rounded-tr-lg transition-all duration-200"
        :class="[
          hoveredCorner === 'bottom-left'
            ? 'scale-125 bg-gradient-to-tr from-black/25 via-white/40 to-transparent shadow-md'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
    </div>
  </div>
</template>
