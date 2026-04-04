import { describe, expect, it, vi } from 'vitest'
import { useFoliateSelection } from '../useFoliateSelection'

interface RectLike {
  left: number
  top: number
  right?: number
  bottom: number
  width: number
  height?: number
}

function makeRange(text: string, rect: RectLike): Range {
  return {
    toString: () => text,
    getBoundingClientRect: () => rect as DOMRect,
  } as unknown as Range
}

function makeDoc(options: { selection: Selection | null; iframeRect?: RectLike }): Document {
  const frameElement = options.iframeRect ? ({ getBoundingClientRect: () => options.iframeRect as DOMRect } as unknown as HTMLIFrameElement) : null

  return {
    defaultView: {
      getSelection: () => options.selection,
      frameElement,
    },
  } as unknown as Document
}

describe('useFoliateSelection', () => {
  it('emits selection details including popup position and CFI', () => {
    vi.useFakeTimers()

    const range = makeRange('  picked text  ', {
      left: 10,
      top: 50,
      bottom: 80,
      width: 20,
      height: 30,
    })
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection

    const getCFI = vi.fn<(index: number, rangeArg: Range) => string | null>(() => 'epubcfi(/6/2)')
    const getView = () => ({
      renderer: { getContents: () => [{ index: 5 }] },
      getCFI,
    })

    const foliateSelection = useFoliateSelection(getView)
    const onSelected = vi.fn<(detail: { text: string; cfi: string | null; popupPosition: { x: number; y: number; showBelow: boolean } }) => void>()
    foliateSelection.setHandler(onSelected)

    const doc = makeDoc({
      selection,
      iframeRect: { left: 30, top: 40, bottom: 440, width: 300 },
    })

    foliateSelection.handleSelectionEnd(doc)
    vi.advanceTimersByTime(10)

    expect(getCFI).toHaveBeenCalledWith(5, range)
    expect(onSelected).toHaveBeenCalledWith({
      text: 'picked text',
      cfi: 'epubcfi(/6/2)',
      popupPosition: {
        x: 100,
        y: 130,
        showBelow: true,
      },
    })

    vi.useRealTimers()
  })

  it('does not emit when selection is collapsed or empty', () => {
    vi.useFakeTimers()

    const getView = () => null
    const foliateSelection = useFoliateSelection(getView)
    const onSelected = vi.fn<(detail: unknown) => void>()
    foliateSelection.setHandler(onSelected)

    const collapsed = {
      isCollapsed: true,
      rangeCount: 1,
      getRangeAt: () => makeRange('ignored', { left: 0, top: 0, bottom: 0, width: 0 }),
    } as unknown as Selection

    foliateSelection.handleSelectionEnd(makeDoc({ selection: collapsed }))
    vi.advanceTimersByTime(20)

    expect(onSelected).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('on touch devices, handleSelectionChange promotes stable selection to full selection-end handling', () => {
    vi.useFakeTimers()

    const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 1,
    })

    const range = makeRange('Touch selection', {
      left: 120,
      top: 220,
      bottom: 260,
      width: 80,
      height: 40,
    })
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection

    const foliateSelection = useFoliateSelection(() => ({
      renderer: { getContents: () => [{ index: 2 }] },
      getCFI: () => 'epubcfi(/6/10)',
    }))

    const onSelected = vi.fn<(detail: unknown) => void>()
    foliateSelection.setHandler(onSelected)

    const doc = makeDoc({ selection })
    foliateSelection.handleSelectionChange(doc)

    vi.advanceTimersByTime(299)
    expect(onSelected).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20)
    expect(onSelected).toHaveBeenCalledTimes(1)

    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }

    vi.useRealTimers()
  })
})
