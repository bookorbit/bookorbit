import { describe, expect, it } from 'vitest'
import { createCbzSpreadLayout } from '../spread-layout'

function digest(layout: ReturnType<typeof createCbzSpreadLayout>) {
  return layout.spreads.map((spread) => ({
    kind: spread.kind,
    anchorPage: spread.anchorPage,
    pages: spread.pages,
    singlePage: spread.singlePage,
    leftPage: spread.leftPage,
    rightPage: spread.rightPage,
    hasVirtualBlank: spread.hasVirtualBlank,
  }))
}

describe('createCbzSpreadLayout', () => {
  it('builds single-page layout when two-page is not effective', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 4,
      isTwoPageEffective: false,
      direction: 'ltr',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'auto',
      isWidePage: () => false,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 1, pages: [1], singlePage: 1, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 2, pages: [2], singlePage: 2, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 3, pages: [3], singlePage: 3, leftPage: null, rightPage: null, hasVirtualBlank: false },
    ])
  })

  it('uses cover-alone + strict LTR parity and inserts a virtual blank at the end', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 6,
      isTwoPageEffective: true,
      direction: 'ltr',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'disable',
      isWidePage: () => false,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 1, pages: [1, 2], singlePage: null, leftPage: 1, rightPage: 2, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 3, pages: [3, 4], singlePage: null, leftPage: 3, rightPage: 4, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 5, pages: [5], singlePage: null, leftPage: 5, rightPage: null, hasVirtualBlank: true },
    ])
  })

  it('mirrors spread placement for RTL while preserving story-order anchors', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 6,
      isTwoPageEffective: true,
      direction: 'rtl',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'disable',
      isWidePage: () => false,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 1, pages: [1, 2], singlePage: null, leftPage: 2, rightPage: 1, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 3, pages: [3, 4], singlePage: null, leftPage: 4, rightPage: 3, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 5, pages: [5], singlePage: null, leftPage: null, rightPage: 5, hasVirtualBlank: true },
    ])
  })

  it('applies shifted alignment after cover, then resumes pairing', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 7,
      isTwoPageEffective: true,
      direction: 'ltr',
      spreadAlignment: 'shifted',
      widePageSingletonMode: 'disable',
      isWidePage: () => false,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 1, pages: [1], singlePage: 1, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 2, pages: [2, 3], singlePage: null, leftPage: 2, rightPage: 3, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 4, pages: [4, 5], singlePage: null, leftPage: 4, rightPage: 5, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 6, pages: [6], singlePage: null, leftPage: 6, rightPage: null, hasVirtualBlank: true },
    ])
  })

  it('supports shifted alignment in RTL with mirrored spread placement', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 6,
      isTwoPageEffective: true,
      direction: 'rtl',
      spreadAlignment: 'shifted',
      widePageSingletonMode: 'disable',
      isWidePage: () => false,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 1, pages: [1], singlePage: 1, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 2, pages: [2, 3], singlePage: null, leftPage: 3, rightPage: 2, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 4, pages: [4, 5], singlePage: null, leftPage: 5, rightPage: 4, hasVirtualBlank: false },
    ])
  })

  it('shows wide pages alone and keeps progression deterministic', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 8,
      isTwoPageEffective: true,
      direction: 'ltr',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'auto',
      isWidePage: (page) => page === 3 || page === 4,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 1, pages: [1, 2], singlePage: null, leftPage: 1, rightPage: 2, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 3, pages: [3], singlePage: 3, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'single', anchorPage: 4, pages: [4], singlePage: 4, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 5, pages: [5, 6], singlePage: null, leftPage: 5, rightPage: 6, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 7, pages: [7], singlePage: null, leftPage: 7, rightPage: null, hasVirtualBlank: true },
    ])
  })

  it('inserts a virtual blank when the second page in a pair is wide', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 6,
      isTwoPageEffective: true,
      direction: 'ltr',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'auto',
      isWidePage: (page) => page === 2,
    })

    expect(digest(layout)).toEqual([
      { kind: 'single', anchorPage: 0, pages: [0], singlePage: 0, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 1, pages: [1], singlePage: null, leftPage: 1, rightPage: null, hasVirtualBlank: true },
      { kind: 'single', anchorPage: 2, pages: [2], singlePage: 2, leftPage: null, rightPage: null, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 3, pages: [3, 4], singlePage: null, leftPage: 3, rightPage: 4, hasVirtualBlank: false },
      { kind: 'spread', anchorPage: 5, pages: [5], singlePage: null, leftPage: 5, rightPage: null, hasVirtualBlank: true },
    ])
  })

  it('anchors any page to the containing spread and supports spread-step navigation', () => {
    const layout = createCbzSpreadLayout({
      pageCount: 10,
      isTwoPageEffective: true,
      direction: 'ltr',
      spreadAlignment: 'normal',
      widePageSingletonMode: 'disable',
      isWidePage: () => false,
    })

    expect(layout.anchorForPage(4)).toBe(3)
    expect(layout.anchorForPage(5)).toBe(5)
    expect(layout.anchorForPage(9)).toBe(9)

    expect(layout.prevAnchor(5)).toBe(3)
    expect(layout.nextAnchor(5)).toBe(7)
    expect(layout.prevAnchor(0)).toBe(0)
    expect(layout.nextAnchor(9)).toBe(9)
  })
})
