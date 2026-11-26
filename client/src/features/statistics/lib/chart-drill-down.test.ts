import { describe, expect, it, vi } from 'vitest'

import { categoryIndexAtPixel, drillDownLibraryQuery, nextTargetPosition, windowShowing } from './chart-drill-down'

function makeChart(inGrid: boolean, converted: unknown) {
  return {
    containPixel: vi.fn<(finder: string, value: number[]) => boolean>(() => inGrid),
    convertFromPixel: vi.fn<(finder: { gridIndex: number }, value: number[]) => unknown>(() => converted),
  }
}

describe('categoryIndexAtPixel', () => {
  it('reads the row of a horizontal bar chart from the pointer', () => {
    const chart = makeChart(true, [12.4, 2.6])

    expect(categoryIndexAtPixel(chart, 40, 80)).toBe(3)
    expect(chart.convertFromPixel).toHaveBeenCalledWith({ gridIndex: 0 }, [40, 80])
  })

  it('ignores pointers outside the plot area', () => {
    const chart = makeChart(false, [0, 1])

    expect(categoryIndexAtPixel(chart, 0, 0)).toBeNull()
    expect(chart.convertFromPixel).not.toHaveBeenCalled()
  })

  it('ignores conversions that do not name a row', () => {
    expect(categoryIndexAtPixel(makeChart(true, 4), 1, 1)).toBeNull()
    expect(categoryIndexAtPixel(makeChart(true, [0, Number.NaN]), 1, 1)).toBeNull()
    expect(categoryIndexAtPixel(makeChart(true, [0, -1]), 1, 1)).toBeNull()
  })
})

describe('nextTargetPosition', () => {
  it('moves one entry with the arrow keys and stops at either end', () => {
    expect(nextTargetPosition(0, 'ArrowDown', 3)).toBe(1)
    expect(nextTargetPosition(1, 'ArrowRight', 3)).toBe(2)
    expect(nextTargetPosition(2, 'ArrowDown', 3)).toBe(2)
    expect(nextTargetPosition(2, 'ArrowUp', 3)).toBe(1)
    expect(nextTargetPosition(0, 'ArrowLeft', 3)).toBe(0)
  })

  it('jumps to the first and last entries', () => {
    expect(nextTargetPosition(1, 'Home', 5)).toBe(0)
    expect(nextTargetPosition(1, 'End', 5)).toBe(4)
  })

  it('leaves other keys and empty lists alone', () => {
    expect(nextTargetPosition(0, 'Enter', 3)).toBeNull()
    expect(nextTargetPosition(0, 'ArrowDown', 0)).toBeNull()
  })
})

describe('windowShowing', () => {
  it('keeps a window that already shows the entry', () => {
    expect(windowShowing({ start: 0, end: 19 }, 7)).toBeNull()
  })

  it('slides the window to an entry past either edge, keeping its size', () => {
    expect(windowShowing({ start: 0, end: 19 }, 23)).toEqual({ start: 4, end: 23 })
    expect(windowShowing({ start: 40, end: 49 }, 12)).toEqual({ start: 12, end: 21 })
  })
})

describe('drillDownLibraryQuery', () => {
  it('carries a single selected library', () => {
    expect(drillDownLibraryQuery([4])).toEqual({ libraryId: '4' })
  })

  it('carries nothing for every library or a selection of several', () => {
    expect(drillDownLibraryQuery([])).toEqual({})
    expect(drillDownLibraryQuery([1, 2])).toEqual({})
  })
})
