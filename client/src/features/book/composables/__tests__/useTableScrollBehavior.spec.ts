import { describe, it, expect, vi } from 'vitest'
import { ref, createApp, defineComponent, h } from 'vue'
import { useTableScrollBehavior } from '../useTableScrollBehavior'

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const app = createApp(
    defineComponent({
      setup() {
        result = composable()
        return () => h('div')
      },
    }),
  )
  const root = document.createElement('div')
  app.mount(root)
  return { result, unmount: () => app.unmount() }
}

describe('useTableScrollBehavior', () => {
  it('returns initial values', () => {
    const scrollRef = ref<HTMLDivElement | null>(null)
    const { isScrolled, showScrollTop } = useTableScrollBehavior(scrollRef)
    expect(isScrolled.value).toBe(false)
    expect(showScrollTop.value).toBe(false)
  })

  it('onScroll updates isScrolled based on scrollTop', async () => {
    const mockEl = { scrollTop: 50, clientHeight: 200 } as HTMLDivElement
    const scrollRef = ref<HTMLDivElement | null>(mockEl)
    const { isScrolled, showScrollTop, onScroll } = useTableScrollBehavior(scrollRef)

    const originalRaf = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

    onScroll()
    expect(isScrolled.value).toBe(true)
    expect(showScrollTop.value).toBe(false)

    vi.stubGlobal('requestAnimationFrame', originalRaf)
  })

  it('onScroll sets showScrollTop when scrolled far enough', () => {
    const mockEl = { scrollTop: 500, clientHeight: 200 } as HTMLDivElement
    const scrollRef = ref<HTMLDivElement | null>(mockEl)
    const { showScrollTop, onScroll } = useTableScrollBehavior(scrollRef)

    const originalRaf = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

    onScroll()
    expect(showScrollTop.value).toBe(true)

    vi.stubGlobal('requestAnimationFrame', originalRaf)
  })

  it('onScroll throttles via rAF', () => {
    const mockEl = { scrollTop: 10, clientHeight: 200 } as HTMLDivElement
    const scrollRef = ref<HTMLDivElement | null>(mockEl)
    const { isScrolled, onScroll } = useTableScrollBehavior(scrollRef)

    let capturedCb: FrameRequestCallback | null = null
    const originalRaf = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      capturedCb = cb
      return 1
    })

    onScroll()
    onScroll()
    expect(isScrolled.value).toBe(false)
    capturedCb!(0)
    expect(isScrolled.value).toBe(true)

    vi.stubGlobal('requestAnimationFrame', originalRaf)
  })

  it('onScroll does nothing with null ref', () => {
    const scrollRef = ref<HTMLDivElement | null>(null)
    const { isScrolled, onScroll } = useTableScrollBehavior(scrollRef)

    const originalRaf = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

    onScroll()
    expect(isScrolled.value).toBe(false)

    vi.stubGlobal('requestAnimationFrame', originalRaf)
  })

  it('scrollToTop calls scrollTo on element', () => {
    const scrollToSpy = vi.fn<(options?: ScrollToOptions) => void>()
    const mockEl = { scrollTop: 100, clientHeight: 200, scrollTo: scrollToSpy } as unknown as HTMLDivElement
    const scrollRef = ref<HTMLDivElement | null>(mockEl)
    const { scrollToTop } = useTableScrollBehavior(scrollRef)

    scrollToTop()
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('scrollToTop does nothing with null ref', () => {
    const scrollRef = ref<HTMLDivElement | null>(null)
    const { result } = withSetup(() => useTableScrollBehavior(scrollRef))
    expect(() => result.scrollToTop()).not.toThrow()
  })

  it('cancels pending rAF on unmount', () => {
    const mockEl = { scrollTop: 10, clientHeight: 200 } as HTMLDivElement
    const scrollRef = ref<HTMLDivElement | null>(mockEl)

    const cancelSpy = vi.fn<(handle: number) => void>()
    const originalRaf = globalThis.requestAnimationFrame
    const originalCaf = globalThis.cancelAnimationFrame
    vi.stubGlobal('requestAnimationFrame', () => 42)
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)

    const { result, unmount } = withSetup(() => useTableScrollBehavior(scrollRef))
    result.onScroll()
    unmount()

    expect(cancelSpy).toHaveBeenCalledWith(42)

    vi.stubGlobal('requestAnimationFrame', originalRaf)
    vi.stubGlobal('cancelAnimationFrame', originalCaf)
  })
})
