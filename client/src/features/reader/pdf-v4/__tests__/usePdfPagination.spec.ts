import { defineComponent, h, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Rotation, type PdfPageObjectWithRotatedSize } from '@embedpdf/models'
import type { ScrollScope } from '@embedpdf/plugin-scroll'
import type { PdfReaderSettings } from '@bookorbit/types'
import { usePdfPagination } from '../composables/usePdfPagination'

interface PaginationHarness {
  wrapper: VueWrapper
  pagination: ReturnType<typeof usePdfPagination>
  touchPageTurningEnabled: Ref<boolean>
  onActivity: ReturnType<typeof vi.fn<() => void>>
  scrollToPage: ReturnType<typeof vi.fn<(options: { pageNumber: number; behavior: 'instant' | 'smooth' }) => void>>
}

function page(index: number): PdfPageObjectWithRotatedSize {
  return {
    index,
    size: { width: 600, height: 800 },
    rotatedSize: { width: 600, height: 800 },
    rotation: Rotation.Degree0,
    objectNumber: index + 1,
  }
}

function touchEvent(type: 'touchstart' | 'touchend', touches: Array<{ clientX: number; clientY: number }>, cancelable = true): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable }) as TouchEvent
  Object.defineProperties(event, {
    touches: { value: type === 'touchstart' ? touches : [] },
    changedTouches: { value: touches },
  })
  return event
}

function mountPagination({
  scrollMode = 'page',
  touchTurning = true,
  currentPage = 2,
  totalPages = 3,
}: {
  scrollMode?: PdfReaderSettings['scrollMode']
  touchTurning?: boolean
  currentPage?: number
  totalPages?: number
} = {}): PaginationHarness {
  const mode = ref<PdfReaderSettings['scrollMode']>(scrollMode)
  const touchPageTurningEnabled = ref(touchTurning)
  const onActivity = vi.fn<() => void>()
  const scrollToPage = vi.fn<(options: { pageNumber: number; behavior: 'instant' | 'smooth' }) => void>()
  const scroll = ref({
    getSpreadPagesWithRotatedSize: () => [[page(0)], [page(1)], [page(2)]],
    getPageChangeState: () => ({ isChanging: false }),
    getMetrics: () => ({ pageVisibilityMetrics: [] }),
    scrollToPage,
  } as unknown as Readonly<ScrollScope>)
  let pagination!: ReturnType<typeof usePdfPagination>

  const wrapper = mount(
    defineComponent({
      setup() {
        pagination = usePdfPagination({
          mode,
          scrollState: ref({ currentPage, totalPages }),
          scroll,
          touchPageTurningEnabled,
          onActivity,
        })
        return () => h('div')
      },
    }),
  )

  return { wrapper, pagination, touchPageTurningEnabled, onActivity, scrollToPage }
}

function swipe(pagination: ReturnType<typeof usePdfPagination>, from: [number, number], to: [number, number]) {
  const start = touchEvent('touchstart', [{ clientX: from[0], clientY: from[1] }])
  const end = touchEvent('touchend', [{ clientX: to[0], clientY: to[1] }])
  pagination.handleTouchStart(start)
  pagination.handleTouchEnd(end)
  return { start, end }
}

describe('usePdfPagination', () => {
  it('stays stable while EmbedPDF unloads the document scope', () => {
    const scroll = ref({
      getSpreadPagesWithRotatedSize() {
        throw new Error('Document doc-1 not loaded')
      },
      scrollToPage() {
        throw new Error('Document doc-1 not loaded')
      },
    } as unknown as Readonly<ScrollScope>)
    let pagination!: ReturnType<typeof usePdfPagination>

    const wrapper = mount(
      defineComponent({
        setup() {
          pagination = usePdfPagination({
            mode: ref('page'),
            scrollState: ref({ currentPage: 20, totalPages: 240 }),
            scroll,
            touchPageTurningEnabled: ref(true),
            onActivity: () => {},
          })
          return () => h('div')
        },
      }),
    )

    expect(pagination.pageRange.value).toEqual({ start: 20, end: 20 })
    expect(() => pagination.goToPage(21)).not.toThrow()
    expect(() => pagination.nextPage()).not.toThrow()

    wrapper.unmount()
  })

  it.each([
    { name: 'previous', from: [100, 100], to: [180, 100], pageNumber: 1 },
    { name: 'next', from: [180, 100], to: [100, 100], pageNumber: 3 },
  ] as const)('turns to the $name page for a horizontal pan swipe', ({ from, to, pageNumber }) => {
    const harness = mountPagination()
    const { end } = swipe(harness.pagination, [...from], [...to])

    expect(end.defaultPrevented).toBe(true)
    expect(harness.scrollToPage).toHaveBeenCalledExactlyOnceWith({ pageNumber, behavior: 'smooth' })
    expect(harness.onActivity).toHaveBeenCalledOnce()

    harness.wrapper.unmount()
  })

  it('turns the page without preventing a non-cancelable touchend', () => {
    const harness = mountPagination()
    const start = touchEvent('touchstart', [{ clientX: 180, clientY: 100 }])
    const end = touchEvent('touchend', [{ clientX: 100, clientY: 100 }], false)

    harness.pagination.handleTouchStart(start)
    harness.pagination.handleTouchEnd(end)

    expect(end.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).toHaveBeenCalledExactlyOnceWith({ pageNumber: 3, behavior: 'smooth' })

    harness.wrapper.unmount()
  })

  it('leaves touch drags available to text selection when the pan tool is inactive', () => {
    const harness = mountPagination({ touchTurning: false })
    const first = swipe(harness.pagination, [180, 100], [100, 100])

    expect(first.end.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()
    expect(harness.onActivity).toHaveBeenCalledOnce()

    harness.touchPageTurningEnabled.value = true
    const staleEnd = touchEvent('touchend', [{ clientX: 100, clientY: 100 }])
    harness.pagination.handleTouchEnd(staleEnd)

    expect(staleEnd.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()

    harness.wrapper.unmount()
  })

  it('does not finish a page turn after switching from pan to text selection mid-gesture', () => {
    const harness = mountPagination()
    harness.pagination.handleTouchStart(touchEvent('touchstart', [{ clientX: 180, clientY: 100 }]))
    harness.touchPageTurningEnabled.value = false
    const end = touchEvent('touchend', [{ clientX: 100, clientY: 100 }])
    harness.pagination.handleTouchEnd(end)

    expect(end.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()

    harness.wrapper.unmount()
  })

  it.each([
    { name: 'short', from: [100, 100], to: [159, 100] },
    { name: 'mostly vertical', from: [100, 100], to: [180, 180] },
  ] as const)('ignores $name touch gestures', ({ from, to }) => {
    const harness = mountPagination()
    const { end } = swipe(harness.pagination, [...from], [...to])

    expect(end.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()

    harness.wrapper.unmount()
  })

  it('ignores touch page turns outside paginated mode', () => {
    const harness = mountPagination({ scrollMode: 'vertical' })
    const { end } = swipe(harness.pagination, [180, 100], [100, 100])

    expect(end.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()

    harness.wrapper.unmount()
  })

  it('clears a pending swipe after touch cancellation or a multi-touch start', () => {
    const harness = mountPagination()
    harness.pagination.handleTouchStart(touchEvent('touchstart', [{ clientX: 180, clientY: 100 }]))
    harness.pagination.handleTouchCancel()
    const canceledEnd = touchEvent('touchend', [{ clientX: 100, clientY: 100 }])
    harness.pagination.handleTouchEnd(canceledEnd)

    harness.pagination.handleTouchStart(
      touchEvent('touchstart', [
        { clientX: 180, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    )
    const multiTouchEnd = touchEvent('touchend', [{ clientX: 100, clientY: 100 }])
    harness.pagination.handleTouchEnd(multiTouchEnd)

    expect(canceledEnd.defaultPrevented).toBe(false)
    expect(multiTouchEnd.defaultPrevented).toBe(false)
    expect(harness.scrollToPage).not.toHaveBeenCalled()

    harness.wrapper.unmount()
  })
})
