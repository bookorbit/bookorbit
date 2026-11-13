import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ScrollScope } from '@embedpdf/plugin-scroll'
import { usePdfPagination } from '../composables/usePdfPagination'

describe('usePdfPagination', () => {
  function createMockScrollScope() {
    let isChanging = false
    const scrollToPageMock = vi.fn<({ pageNumber }: { pageNumber: number }) => void>((_args) => {
      // simulate target reached
    })

    const scope = {
      getPageChangeState: () => ({ isChanging }),
      setChanging: (val: boolean) => {
        isChanging = val
      },
      getSpreadPagesWithRotatedSize: () => [
        // Spreads grouped in pairs like responsive spread on desktop
        [{ index: 0, rotatedSize: { width: 500, height: 700 } }],
        [
          { index: 30, rotatedSize: { width: 500, height: 700 } },
          { index: 31, rotatedSize: { width: 500, height: 700 } },
        ],
        [
          { index: 32, rotatedSize: { width: 500, height: 700 } },
          { index: 33, rotatedSize: { width: 500, height: 700 } },
        ],
        [
          { index: 34, rotatedSize: { width: 500, height: 700 } },
          { index: 35, rotatedSize: { width: 500, height: 700 } },
        ],
      ],
      scrollToPage: scrollToPageMock,
      scrollToNextPage: vi.fn<() => void>(),
      scrollToPreviousPage: vi.fn<() => void>(),
      getMetrics: () => ({ pageVisibilityMetrics: [] }),
    }

    return { scope, scrollToPageMock }
  }

  it('advances strictly by 1 page in single-page curl mode (32 -> 33, not 34)', () => {
    const scrollState = ref({ currentPage: 32, totalPages: 100 })
    const { scope, scrollToPageMock } = createMockScrollScope()
    const onActivity = vi.fn<() => void>()
    const onPageTurnAnimation = vi.fn<(dir: number, navCb?: () => void, completeCb?: () => void) => void>((_dir, navCb, completeCb) => {
      navCb?.()
      completeCb?.()
    })

    const pagination = usePdfPagination({
      mode: ref('page'),
      scrollState,
      scroll: ref(scope as unknown as Readonly<ScrollScope>),
      touchPageTurningEnabled: ref(true),
      onActivity,
      pageTurnAnimation: ref('curl'),
      onPageTurnAnimation,
    })

    pagination.nextPage()

    expect(onPageTurnAnimation).toHaveBeenCalledWith(1, expect.any(Function), expect.any(Function))
    expect(scrollToPageMock).toHaveBeenCalledWith({
      pageNumber: 33,
      behavior: 'instant',
    })
  })

  it('locks out concurrent turn calls while isFlipping is true', () => {
    const scrollState = ref({ currentPage: 32, totalPages: 100 })
    const { scope, scrollToPageMock } = createMockScrollScope()
    const onActivity = vi.fn<() => void>()

    let storedCompleteCb: (() => void) | null = null
    const onPageTurnAnimation = vi.fn<(dir: number, navCb?: () => void, completeCb?: () => void) => void>((_dir, navCb, completeCb) => {
      navCb?.()
      storedCompleteCb = completeCb ?? null
    })

    const pagination = usePdfPagination({
      mode: ref('page'),
      scrollState,
      scroll: ref(scope as unknown as Readonly<ScrollScope>),
      touchPageTurningEnabled: ref(true),
      onActivity,
      pageTurnAnimation: ref('curl'),
      onPageTurnAnimation,
    })

    pagination.nextPage()
    expect(scrollToPageMock).toHaveBeenCalledTimes(1)
    expect(pagination.isFlipping.value).toBe(true)

    // Rapid double click / keystroke while flipping
    pagination.nextPage()
    pagination.previousPage()
    expect(scrollToPageMock).toHaveBeenCalledTimes(1)

    // Release animation
    storedCompleteCb?.()
    expect(pagination.isFlipping.value).toBe(false)
  })

  it('steps back strictly by 1 page on previousPage (33 -> 32)', () => {
    const scrollState = ref({ currentPage: 33, totalPages: 100 })
    const { scope, scrollToPageMock } = createMockScrollScope()
    const onActivity = vi.fn<() => void>()
    const onPageTurnAnimation = vi.fn<(dir: number, navCb?: () => void, completeCb?: () => void) => void>((_dir, navCb, completeCb) => {
      navCb?.()
      completeCb?.()
    })

    const pagination = usePdfPagination({
      mode: ref('page'),
      scrollState,
      scroll: ref(scope as unknown as Readonly<ScrollScope>),
      touchPageTurningEnabled: ref(true),
      onActivity,
      pageTurnAnimation: ref('curl'),
      onPageTurnAnimation,
    })

    pagination.previousPage()

    expect(scrollToPageMock).toHaveBeenCalledWith({
      pageNumber: 32,
      behavior: 'instant',
    })
  })
})
