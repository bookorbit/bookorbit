export type CbzReadingDirection = 'ltr' | 'rtl'
export type CbzSpreadAlignment = 'normal' | 'shifted'
export type CbzWidePageSingletonMode = 'auto' | 'disable'
export type CbzSpreadKind = 'single' | 'spread'

export const DEFAULT_WIDE_PAGE_RATIO_THRESHOLD = 1.2

export interface CbzSpread {
  kind: CbzSpreadKind
  anchorPage: number
  pages: number[]
  singlePage: number | null
  leftPage: number | null
  rightPage: number | null
  hasVirtualBlank: boolean
}

export interface CreateCbzSpreadLayoutInput {
  pageCount: number
  isTwoPageEffective: boolean
  direction: CbzReadingDirection
  spreadAlignment: CbzSpreadAlignment
  widePageSingletonMode: CbzWidePageSingletonMode
  isWidePage: (pageIndex: number) => boolean
}

export interface CbzSpreadLayout {
  spreads: CbzSpread[]
  anchorForPage: (pageIndex: number) => number
  spreadIndexForPage: (pageIndex: number) => number
  spreadForPage: (pageIndex: number) => CbzSpread | null
  spreadForAnchor: (anchorPage: number) => CbzSpread | null
  nextAnchor: (anchorPage: number) => number
  prevAnchor: (anchorPage: number) => number
}

function clampPage(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  if (pageIndex < 0) return 0
  if (pageIndex >= pageCount) return pageCount - 1
  return pageIndex
}

function makeSingle(pageIndex: number): CbzSpread {
  return {
    kind: 'single',
    anchorPage: pageIndex,
    pages: [pageIndex],
    singlePage: pageIndex,
    leftPage: null,
    rightPage: null,
    hasVirtualBlank: false,
  }
}

function makeSpread(direction: CbzReadingDirection, firstPage: number, secondPage: number | null, hasVirtualBlank: boolean): CbzSpread {
  return {
    kind: 'spread',
    anchorPage: firstPage,
    pages: secondPage === null ? [firstPage] : [firstPage, secondPage],
    singlePage: null,
    leftPage: direction === 'ltr' ? firstPage : secondPage,
    rightPage: direction === 'ltr' ? secondPage : firstPage,
    hasVirtualBlank,
  }
}

function buildSpreads(input: CreateCbzSpreadLayoutInput): CbzSpread[] {
  const { pageCount, isTwoPageEffective, direction, spreadAlignment, widePageSingletonMode, isWidePage } = input
  if (pageCount <= 0) return []

  if (!isTwoPageEffective) {
    const singles: CbzSpread[] = []
    for (let page = 0; page < pageCount; page++) singles.push(makeSingle(page))
    return singles
  }

  const spreads: CbzSpread[] = []

  // Cover is always shown alone.
  spreads.push(makeSingle(0))
  let cursor = 1

  // Shifted alignment inserts a singleton after the cover, then resumes pairing.
  if (spreadAlignment === 'shifted' && cursor < pageCount) {
    spreads.push(makeSingle(cursor))
    cursor += 1
  }

  while (cursor < pageCount) {
    const first = cursor
    const second = cursor + 1

    if (widePageSingletonMode === 'auto' && isWidePage(first)) {
      spreads.push(makeSingle(first))
      cursor += 1
      continue
    }

    if (second >= pageCount) {
      spreads.push(makeSpread(direction, first, null, true))
      cursor += 1
      continue
    }

    if (widePageSingletonMode === 'auto' && isWidePage(second)) {
      spreads.push(makeSpread(direction, first, null, true))
      cursor += 1
      continue
    }

    spreads.push(makeSpread(direction, first, second, false))
    cursor += 2
  }

  return spreads
}

export function createCbzSpreadLayout(input: CreateCbzSpreadLayoutInput): CbzSpreadLayout {
  const spreads = buildSpreads(input)
  const pageCount = input.pageCount

  const pageToSpreadIndex = Array.from({ length: Math.max(0, pageCount) }, () => 0)
  const anchorToSpreadIndex = new Map<number, number>()

  for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex++) {
    const spread = spreads[spreadIndex]
    if (!spread) continue
    anchorToSpreadIndex.set(spread.anchorPage, spreadIndex)
    for (const page of spread.pages) {
      if (page >= 0 && page < pageToSpreadIndex.length) pageToSpreadIndex[page] = spreadIndex
    }
  }

  function spreadIndexForPage(pageIndex: number): number {
    if (spreads.length === 0 || pageToSpreadIndex.length === 0) return 0
    const clamped = clampPage(pageIndex, pageCount)
    return pageToSpreadIndex[clamped] ?? 0
  }

  function anchorForPage(pageIndex: number): number {
    if (spreads.length === 0) return 0
    const spread = spreads[spreadIndexForPage(pageIndex)]
    return spread?.anchorPage ?? 0
  }

  function spreadForPage(pageIndex: number): CbzSpread | null {
    if (spreads.length === 0) return null
    return spreads[spreadIndexForPage(pageIndex)] ?? null
  }

  function spreadForAnchor(anchorPage: number): CbzSpread | null {
    if (spreads.length === 0) return null
    const spreadIndex = anchorToSpreadIndex.get(clampPage(anchorPage, pageCount))
    if (spreadIndex === undefined) return spreadForPage(anchorPage)
    return spreads[spreadIndex] ?? null
  }

  function nextAnchor(anchorPage: number): number {
    if (spreads.length === 0) return 0
    const spread = spreadForAnchor(anchorPage)
    if (!spread) return 0
    const currentIndex = anchorToSpreadIndex.get(spread.anchorPage) ?? 0
    const next = spreads[Math.min(currentIndex + 1, spreads.length - 1)]
    return next?.anchorPage ?? spread.anchorPage
  }

  function prevAnchor(anchorPage: number): number {
    if (spreads.length === 0) return 0
    const spread = spreadForAnchor(anchorPage)
    if (!spread) return 0
    const currentIndex = anchorToSpreadIndex.get(spread.anchorPage) ?? 0
    const prev = spreads[Math.max(currentIndex - 1, 0)]
    return prev?.anchorPage ?? spread.anchorPage
  }

  return {
    spreads,
    anchorForPage,
    spreadIndexForPage,
    spreadForPage,
    spreadForAnchor,
    nextAnchor,
    prevAnchor,
  }
}
