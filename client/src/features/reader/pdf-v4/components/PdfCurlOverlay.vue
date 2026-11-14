<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { calculateFoldGeometry, renderConicalFold, type Corner } from '../utils/conical-fold'

const props = defineProps<{
  surface: HTMLElement | null
  active: boolean
  currentPage: number
  totalPages: number
  isDark?: boolean
}>()

const emit = defineEmits<{
  commitTurn: [direction: 1 | -1]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLDivElement | null>(null)
const isAnimating = ref(false)
const isDragging = ref(false)
const isPeeking = ref(false)
const hoveredCorner = ref<Corner | null>(null)

let activeCorner: Corner = 'bottom-right'
let animationRaf: number | null = null
let cachedSourceCanvas: HTMLCanvasElement | null = null
let cachedRevealedCanvas: HTMLCanvasElement | null = null
let pageRect: DOMRect | null = null

let dragStartX = 0
let dragStartY = 0
let dragStartTime = 0
let currentTouchX = 0
let currentTouchY = 0

const pageGeometry = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
})

function getIsSepia(): boolean {
  return (
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-surface') === 'sepia' || document.documentElement.classList.contains('sepia'))
  )
}

function updatePageGeometry(): DOMRect | null {
  const surface = props.surface
  if (!surface) return null

  const surfaceRect = surface.getBoundingClientRect()
  const pageElements = Array.from(surface.querySelectorAll<HTMLElement>('[data-page-index]'))
  const targetPageEl = pageElements[0] ?? null
  const rect = targetPageEl?.getBoundingClientRect() ?? surfaceRect

  if (rect.width <= 0 || rect.height <= 0) return null

  pageRect = rect
  pageGeometry.value = {
    left: Math.max(0, rect.left - surfaceRect.left),
    top: Math.max(0, rect.top - surfaceRect.top),
    width: rect.width,
    height: rect.height,
  }

  const canvas = canvasRef.value
  if (canvas) {
    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
  }

  return rect
}

function capturePageCanvas(pageNumber: number): HTMLCanvasElement | null {
  const surface = props.surface
  if (!surface) return null

  const pageIndex = pageNumber - 1
  let pageEl = surface.querySelector<HTMLElement>(`[data-page-index="${pageIndex}"]`)
  if (!pageEl) {
    const pageElements = Array.from(surface.querySelectorAll<HTMLElement>('[data-page-index]'))
    pageEl = pageElements[0] ?? null
  }
  if (!pageEl) return null

  const rect = pageEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const dpr = window.devicePixelRatio || 1
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.max(1, Math.round(rect.width * dpr))
  offscreen.height = Math.max(1, Math.round(rect.height * dpr))

  const ctx = offscreen.getContext('2d')
  if (!ctx) return null

  const isSepia = getIsSepia()
  ctx.fillStyle = props.isDark ? '#1a1a1e' : isSepia ? '#f5ead5' : '#faf8f4'
  ctx.fillRect(0, 0, offscreen.width, offscreen.height)

  const canvases = Array.from(pageEl.querySelectorAll('canvas'))
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
  const targetW = Math.round(width * dpr)
  const targetH = Math.round(height * dpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.scale(dpr, dpr)

  const geom = calculateFoldGeometry(width, height, corner, { x: touchX, y: touchY })
  if (geom) {
    renderConicalFold(ctx, width, height, cachedSourceCanvas, geom, cachedRevealedCanvas, props.isDark, getIsSepia())
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

// Ease functions for animations
function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

// Spring back to flat (< 35% drag) with a slight overshoot
function springBack(startCorner: Corner, fromX: number, fromY: number) {
  if (animationRaf !== null) {
    cancelAnimationFrame(animationRaf)
    animationRaf = null
  }
  isAnimating.value = true

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  const targetX = startCorner.includes('right') ? width : 0
  const targetY = startCorner.includes('bottom') ? height : 0

  const duration = 300
  const startTime = performance.now()

  function frame(now: number) {
    const elapsed = now - startTime
    const progress = Math.min(1, elapsed / duration)
    const eased = easeOutBack(progress)

    const curX = fromX + (targetX - fromX) * eased
    const curY = fromY + (targetY - fromY) * eased

    drawFold(startCorner, curX, curY)

    if (progress < 1) {
      animationRaf = requestAnimationFrame(frame)
    } else {
      animationRaf = null
      isAnimating.value = false
      isDragging.value = false
      isPeeking.value = false
      clearCanvas()
      cachedSourceCanvas = null
      cachedRevealedCanvas = null
    }
  }

  animationRaf = requestAnimationFrame(frame)
}

// Complete turn to next/previous page (>= 35% drag or flick)
function completeTurn(direction: 1 | -1, startCorner: Corner, fromX: number, fromY: number) {
  if (animationRaf !== null) {
    cancelAnimationFrame(animationRaf)
    animationRaf = null
  }
  isAnimating.value = true

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  const targetX = direction > 0 ? -width * 0.4 : width * 1.4
  const targetY = startCorner.includes('bottom') ? height * 0.75 : height * 0.25

  const duration = 340
  const startTime = performance.now()

  function frame(now: number) {
    const elapsed = now - startTime
    const progress = Math.min(1, elapsed / duration)
    const eased = easeInOutCubic(progress)

    const curX = fromX + (targetX - fromX) * eased
    const curY = fromY + (targetY - fromY) * eased

    drawFold(startCorner, curX, curY)

    if (progress < 1) {
      animationRaf = requestAnimationFrame(frame)
    } else {
      animationRaf = null
      isAnimating.value = false
      isDragging.value = false
      isPeeking.value = false
      clearCanvas()
      cachedSourceCanvas = null
      cachedRevealedCanvas = null
      emit('commitTurn', direction)
    }
  }

  animationRaf = requestAnimationFrame(frame)
}

// Programmatic flip (for keyboard Right/Left Arrow or toolbar)
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

  cachedSourceCanvas = capturePageCanvas(props.currentPage)
  cachedRevealedCanvas = capturePageCanvas(props.currentPage + direction)
  if (!cachedSourceCanvas) {
    onReadyToNavigate?.()
    onComplete?.()
    return
  }

  isAnimating.value = true
  activeCorner = direction > 0 ? 'bottom-right' : 'bottom-left'

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  const startX = direction > 0 ? width : 0
  const startY = height
  const targetX = direction > 0 ? -width * 0.4 : width * 1.4
  const targetY = height * 0.78

  const duration = 520
  const startTime = performance.now()
  let navigated = false

  function frame(now: number) {
    const elapsed = now - startTime
    const progress = Math.min(1, elapsed / duration)
    const eased = easeInOutCubic(progress)

    const curX = startX + (targetX - startX) * eased
    const curY = startY + (targetY - startY) * eased

    drawFold(activeCorner, curX, curY)

    if (progress >= 0.4 && !navigated) {
      navigated = true
      onReadyToNavigate?.()
    }

    if (progress < 1) {
      animationRaf = requestAnimationFrame(frame)
    } else {
      animationRaf = null
      isAnimating.value = false
      clearCanvas()
      cachedSourceCanvas = null
      cachedRevealedCanvas = null
      onComplete?.()
    }
  }

  animationRaf = requestAnimationFrame(frame)
}

// Live corner hover peek animation
function startCornerPeek(corner: Corner) {
  if (isDragging.value || isAnimating.value) return

  hoveredCorner.value = corner
  isPeeking.value = true
  activeCorner = corner

  updatePageGeometry()
  if (!cachedSourceCanvas) {
    cachedSourceCanvas = capturePageCanvas(props.currentPage)
    const dir: 1 | -1 = corner.includes('right') ? 1 : -1
    cachedRevealedCanvas = capturePageCanvas(props.currentPage + dir)
  }

  const width = pageGeometry.value.width
  const height = pageGeometry.value.height
  const peekDepth = 42
  const targetX = corner.includes('right') ? width - peekDepth : peekDepth
  const targetY = corner.includes('bottom') ? height - peekDepth : peekDepth

  drawFold(corner, targetX, targetY)
}

function stopCornerPeek() {
  if (isDragging.value || isAnimating.value) return
  hoveredCorner.value = null
  isPeeking.value = false
  clearCanvas()
  cachedSourceCanvas = null
  cachedRevealedCanvas = null
}

// Pointer event handlers on the curl trigger zones
function handleZonePointerDown(direction: 1 | -1, event: PointerEvent) {
  if (isAnimating.value) return
  event.preventDefault()

  const target = event.currentTarget as HTMLElement
  try {
    target.setPointerCapture(event.pointerId)
  } catch {}

  const rect = updatePageGeometry()
  if (!rect) return

  dragStartX = event.clientX
  dragStartY = event.clientY
  dragStartTime = performance.now()

  const localY = event.clientY - rect.top
  const isLowerHalf = localY > rect.height * 0.5
  if (direction > 0) {
    activeCorner = isLowerHalf ? 'bottom-right' : 'top-right'
  } else {
    activeCorner = isLowerHalf ? 'bottom-left' : 'top-left'
  }

  cachedSourceCanvas = capturePageCanvas(props.currentPage)
  cachedRevealedCanvas = capturePageCanvas(props.currentPage + direction)

  isDragging.value = true
  currentTouchX = event.clientX - rect.left
  currentTouchY = event.clientY - rect.top

  drawFold(activeCorner, currentTouchX, currentTouchY)
}

function handleZonePointerMove(direction: 1 | -1, event: PointerEvent) {
  const rect = pageRect
  if (!rect) return

  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const width = pageGeometry.value.width
  const height = pageGeometry.value.height

  if (!isDragging.value) {
    // Hover peek near corners
    const isRight = direction > 0
    if (isRight) {
      const nearBR = localX > width - 120 && localY > height - 120
      const nearTR = localX > width - 120 && localY < 120
      if (nearBR && hoveredCorner.value !== 'bottom-right') {
        startCornerPeek('bottom-right')
      } else if (nearTR && hoveredCorner.value !== 'top-right') {
        startCornerPeek('top-right')
      } else if (!nearBR && !nearTR && hoveredCorner.value) {
        stopCornerPeek()
      }
    } else {
      const nearBL = localX < 120 && localY > height - 120
      const nearTL = localX < 120 && localY < 120
      if (nearBL && hoveredCorner.value !== 'bottom-left') {
        startCornerPeek('bottom-left')
      } else if (nearTL && hoveredCorner.value !== 'top-left') {
        startCornerPeek('top-left')
      } else if (!nearBL && !nearTL && hoveredCorner.value) {
        stopCornerPeek()
      }
    }
    return
  }

  // Active dragging
  event.preventDefault()
  currentTouchX = direction > 0 ? Math.min(width, Math.max(-width * 0.45, localX)) : Math.max(0, Math.min(width * 1.45, localX))
  currentTouchY = Math.max(-height * 0.1, Math.min(height * 1.1, localY))

  drawFold(activeCorner, currentTouchX, currentTouchY)
}

function handleZonePointerUp(direction: 1 | -1, event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  try {
    target.releasePointerCapture(event.pointerId)
  } catch {}

  if (!isDragging.value) return

  const rect = pageRect
  const width = pageGeometry.value.width
  const currentX = rect ? event.clientX - rect.left : currentTouchX
  const currentY = rect ? event.clientY - rect.top : currentTouchY

  const totalDx = Math.abs(event.clientX - dragStartX)
  const totalDy = Math.abs(event.clientY - dragStartY)
  const dt = performance.now() - dragStartTime
  const vx = (event.clientX - dragStartX) / Math.max(1, dt)

  // Tap check (< 14px moved and < 320ms) -> smooth turn
  if (totalDx < 14 && totalDy < 14 && dt < 320) {
    completeTurn(direction, activeCorner, currentX, currentY)
    return
  }

  // Drag progress check: >= 35% drag or flick in turning direction
  const progress = direction > 0 ? (width - currentX) / width : currentX / width
  const isFlick = direction > 0 ? vx < -0.35 : vx > 0.35

  if (progress >= 0.35 || isFlick) {
    completeTurn(direction, activeCorner, currentX, currentY)
  } else {
    springBack(activeCorner, currentX, currentY)
  }
}

function handleZonePointerLeave() {
  if (isDragging.value) return
  stopCornerPeek()
}

defineExpose({
  flip,
  isFlipping: computed(() => isAnimating.value || isDragging.value),
})

watch(
  () => [props.currentPage, props.isDark],
  () => {
    updatePageGeometry()
  },
)

onMounted(() => {
  updatePageGeometry()
  window.addEventListener('resize', updatePageGeometry)
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePageGeometry)
  if (animationRaf !== null) cancelAnimationFrame(animationRaf)
})
</script>

<template>
  <div v-if="props.active" ref="overlayRef" class="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-hidden="true">
    <!-- 2D Conical Fold Canvas -->
    <canvas
      ref="canvasRef"
      class="pointer-events-none absolute"
      :style="{
        left: `${pageGeometry.left}px`,
        top: `${pageGeometry.top}px`,
        width: `${pageGeometry.width}px`,
        height: `${pageGeometry.height}px`,
        visibility: isAnimating || isDragging || isPeeking ? 'visible' : 'hidden',
      }"
    />

    <!-- Right Curl Zone (Turn Next) -->
    <div
      v-if="props.currentPage < props.totalPages && pageGeometry.width > 0"
      class="pointer-events-auto absolute cursor-grab select-none touch-none active:cursor-grabbing"
      :style="{
        left: `${pageGeometry.left + pageGeometry.width * 0.72}px`,
        top: `${pageGeometry.top}px`,
        width: `${pageGeometry.width * 0.28}px`,
        height: `${pageGeometry.height}px`,
      }"
      title="Click or drag to turn page"
      @pointerdown="handleZonePointerDown(1, $event)"
      @pointermove="handleZonePointerMove(1, $event)"
      @pointerup="handleZonePointerUp(1, $event)"
      @pointercancel="handleZonePointerUp(1, $event)"
      @pointerleave="handleZonePointerLeave"
    >
      <div
        class="absolute bottom-2 right-2 h-9 w-9 rounded-tl-xl transition-all duration-200"
        :class="[
          hoveredCorner === 'bottom-right'
            ? 'scale-125 bg-gradient-to-tl from-black/35 via-white/40 to-transparent shadow-lg'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
      <div
        class="absolute top-2 right-2 h-9 w-9 rounded-bl-xl transition-all duration-200"
        :class="[
          hoveredCorner === 'top-right'
            ? 'scale-125 bg-gradient-to-bl from-black/35 via-white/40 to-transparent shadow-lg'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
    </div>

    <!-- Left Curl Zone (Turn Previous) -->
    <div
      v-if="props.currentPage > 1 && pageGeometry.width > 0"
      class="pointer-events-auto absolute cursor-grab select-none touch-none active:cursor-grabbing"
      :style="{
        left: `${pageGeometry.left}px`,
        top: `${pageGeometry.top}px`,
        width: `${pageGeometry.width * 0.28}px`,
        height: `${pageGeometry.height}px`,
      }"
      title="Click or drag to turn page back"
      @pointerdown="handleZonePointerDown(-1, $event)"
      @pointermove="handleZonePointerMove(-1, $event)"
      @pointerup="handleZonePointerUp(-1, $event)"
      @pointercancel="handleZonePointerUp(-1, $event)"
      @pointerleave="handleZonePointerLeave"
    >
      <div
        class="absolute bottom-2 left-2 h-9 w-9 rounded-tr-xl transition-all duration-200"
        :class="[
          hoveredCorner === 'bottom-left'
            ? 'scale-125 bg-gradient-to-tr from-black/35 via-white/40 to-transparent shadow-lg'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
      <div
        class="absolute top-2 left-2 h-9 w-9 rounded-br-xl transition-all duration-200"
        :class="[
          hoveredCorner === 'top-left'
            ? 'scale-125 bg-gradient-to-br from-black/35 via-white/40 to-transparent shadow-lg'
            : 'opacity-40 hover:opacity-90',
        ]"
      />
    </div>
  </div>
</template>
