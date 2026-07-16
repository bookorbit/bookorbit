import { computed, onUnmounted, type Ref } from 'vue'
import type { ScrollScope } from '@embedpdf/plugin-scroll'
import type { PdfReaderSettings } from '@bookorbit/types'
import { canTurnFromVisiblePage, findAdjacentPage, findPageRange } from '../pdf-pagination'

type ReadonlyRef<T> = Readonly<Ref<T>>

export interface UsePdfPaginationOptions {
  mode: ReadonlyRef<PdfReaderSettings['scrollMode']>
  scrollState: ReadonlyRef<{ currentPage: number; totalPages: number }>
  scroll: ReadonlyRef<Readonly<ScrollScope> | null>
  onActivity: () => void
}

export function usePdfPagination({ mode, scrollState, scroll, onActivity }: UsePdfPaginationOptions) {
  let wheelDelta = 0
  let wheelUnlockTimer: ReturnType<typeof setTimeout> | null = null
  let touchStart: { x: number; y: number } | null = null

  function getScrollScope() {
    try {
      return scroll.value
    } catch {
      return null
    }
  }

  function getSpreads(scope = getScrollScope()) {
    try {
      return scope?.getSpreadPagesWithRotatedSize() ?? []
    } catch {
      return []
    }
  }

  function getPageRange(pageNumber: number, totalPages: number) {
    return findPageRange(getSpreads(), pageNumber, totalPages)
  }

  const pageRange = computed(() => getPageRange(scrollState.value.currentPage, scrollState.value.totalPages))
  const behavior = computed(() => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'))

  function goToPage(page: number) {
    const clamped = Math.min(Math.max(page, 1), scrollState.value.totalPages || 1)
    try {
      getScrollScope()?.scrollToPage({ pageNumber: clamped, behavior: behavior.value })
    } catch {
      return
    }
  }

  function turnPage(direction: -1 | 1) {
    const scope = getScrollScope()
    if (!scope) return
    try {
      if (scope.getPageChangeState().isChanging) return
      const spreads = getSpreads(scope)
      if (spreads.length === 0) return
      const target = findAdjacentPage(spreads, pageRange.value.start, direction, scrollState.value.totalPages)
      if (target === pageRange.value.start) return
      scope.scrollToPage({ pageNumber: target, behavior: behavior.value })
    } catch {
      return
    }
  }

  function previousPage() {
    onActivity()
    if (mode.value === 'page') turnPage(-1)
    else {
      try {
        getScrollScope()?.scrollToPreviousPage(behavior.value)
      } catch {
        return
      }
    }
  }

  function nextPage() {
    onActivity()
    if (mode.value === 'page') turnPage(1)
    else {
      try {
        getScrollScope()?.scrollToNextPage(behavior.value)
      } catch {
        return
      }
    }
  }

  function canTurnPage(direction: -1 | 1, axis: 'horizontal' | 'vertical' = 'vertical') {
    const scope = getScrollScope()
    if (!scope) return false
    const spreads = getSpreads(scope)
    if (spreads.length === 0) return false
    try {
      return canTurnFromVisiblePage(direction, pageRange.value, scope.getMetrics().pageVisibilityMetrics, spreads, axis)
    } catch {
      return false
    }
  }

  function handleWheel(event: WheelEvent) {
    onActivity()
    if (mode.value !== 'page' || event.ctrlKey || event.metaKey) return
    const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'horizontal' : 'vertical'
    const delta = axis === 'horizontal' ? event.deltaX : event.deltaY
    const direction: -1 | 1 = delta < 0 ? -1 : 1
    if (!canTurnPage(direction, axis)) return
    event.preventDefault()
    wheelDelta += delta
    if (Math.abs(wheelDelta) < 80 || wheelUnlockTimer) return
    turnPage(direction)
    wheelDelta = 0
    wheelUnlockTimer = setTimeout(() => {
      wheelUnlockTimer = null
    }, 350)
  }

  function handleTouchStart(event: TouchEvent) {
    onActivity()
    if (event.touches.length !== 1) {
      touchStart = null
      return
    }
    touchStart = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
  }

  function handleTouchEnd(event: TouchEvent) {
    if (mode.value !== 'page' || !touchStart || event.changedTouches.length !== 1) {
      touchStart = null
      return
    }
    const touch = event.changedTouches[0]!
    const deltaX = touch.clientX - touchStart.x
    const deltaY = touch.clientY - touchStart.y
    touchStart = null
    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return
    const direction: -1 | 1 = deltaX > 0 ? -1 : 1
    if (!canTurnPage(direction, 'horizontal')) return
    event.preventDefault()
    turnPage(direction)
  }

  onUnmounted(() => {
    if (wheelUnlockTimer) clearTimeout(wheelUnlockTimer)
  })

  return { pageRange, getPageRange, goToPage, previousPage, nextPage, handleWheel, handleTouchStart, handleTouchEnd }
}
