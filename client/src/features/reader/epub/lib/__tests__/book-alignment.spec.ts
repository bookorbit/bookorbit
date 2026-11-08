import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOOK_ALIGNMENT_ATTRIBUTE, keepsBookAlignment, markBookAlignment, readerTextAlignRule } from '../book-alignment'

const PROBE_ATTRIBUTE = 'data-bookorbit-align-probe'

function stubComputedStyle(direction = 'ltr', onRead?: () => void) {
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    onRead?.()
    return { textAlign: (el as HTMLElement).dataset.align ?? 'start', direction } as CSSStyleDeclaration
  })
}

function paragraphs(...aligns: string[]): HTMLElement[] {
  return aligns.map((align) => {
    const p = document.createElement('p')
    p.dataset.align = align
    document.body.appendChild(p)
    return p
  })
}

describe('keepsBookAlignment', () => {
  it.each(['center', '-webkit-center', 'end'])('keeps %s in either direction', (align) => {
    expect(keepsBookAlignment(align, 'ltr')).toBe(true)
    expect(keepsBookAlignment(align, 'rtl')).toBe(true)
  })

  it.each(['start', 'justify', ''])('lets the reader restyle %s', (align) => {
    expect(keepsBookAlignment(align, 'ltr')).toBe(false)
    expect(keepsBookAlignment(align, 'rtl')).toBe(false)
  })

  it('keeps only the end-edge physical alignment for the text direction', () => {
    expect(keepsBookAlignment('right', 'ltr')).toBe(true)
    expect(keepsBookAlignment('left', 'ltr')).toBe(false)
    expect(keepsBookAlignment('left', 'rtl')).toBe(true)
    expect(keepsBookAlignment('right', 'rtl')).toBe(false)
    expect(keepsBookAlignment('-webkit-right', 'ltr')).toBe(true)
    expect(keepsBookAlignment('-webkit-left', 'rtl')).toBe(true)
  })
})

describe('markBookAlignment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    document.documentElement.removeAttribute(PROBE_ATTRIBUTE)
  })

  it('marks text the book centres or sets against the end edge and leaves body text unmarked', () => {
    stubComputedStyle()
    const [centered, right, left, justified] = paragraphs('center', 'right', 'left', 'justify')

    markBookAlignment(document)

    expect(centered!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(true)
    expect(right!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(true)
    expect(left!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(false)
    expect(justified!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(false)
  })

  it('measures list items, block quotes and definitions as well as paragraphs', () => {
    stubComputedStyle()
    const elements = ['li', 'blockquote', 'dd', 'div'].map((tag) => {
      const el = document.createElement(tag)
      el.dataset.align = 'center'
      document.body.appendChild(el)
      return el
    })

    markBookAlignment(document)

    expect(elements.map((el) => el.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE))).toEqual([true, true, true, false])
  })

  it('treats right-aligned text in a right-to-left book as body text', () => {
    stubComputedStyle('rtl')
    const [right, left] = paragraphs('right', 'left')

    markBookAlignment(document)

    expect(right!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(false)
    expect(left!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(true)
  })

  it('switches the reader rule off while measuring and back on afterwards', () => {
    const probeDuringRead: boolean[] = []
    stubComputedStyle('ltr', () => probeDuringRead.push(document.documentElement.hasAttribute(PROBE_ATTRIBUTE)))
    paragraphs('center', 'start')

    markBookAlignment(document)

    expect(probeDuringRead).toEqual([true, true])
    expect(document.documentElement.hasAttribute(PROBE_ATTRIBUTE)).toBe(false)
  })

  it('switches the reader rule back on when measuring fails', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('detached')
    })
    paragraphs('center')

    expect(() => markBookAlignment(document)).toThrow('detached')
    expect(document.documentElement.hasAttribute(PROBE_ATTRIBUTE)).toBe(false)
  })

  it('clears a stale mark when the book no longer aligns the element', () => {
    stubComputedStyle()
    const [p] = paragraphs('start')
    p!.setAttribute(BOOK_ALIGNMENT_ATTRIBUTE, '')

    markBookAlignment(document)

    expect(p!.hasAttribute(BOOK_ALIGNMENT_ATTRIBUTE)).toBe(false)
  })
})

describe('readerTextAlignRule', () => {
  it('applies the reader alignment only outside the measuring pass and to unmarked body text', () => {
    const rule = readerTextAlignRule(true)

    expect(rule).toContain(`:where(:root:not([${PROBE_ATTRIBUTE}]))`)
    expect(rule).toContain(`:is(p, li, blockquote, dd):where(:not([${BOOK_ALIGNMENT_ATTRIBUTE}]))`)
    expect(rule).toContain('text-align: justify !important;')
    expect(readerTextAlignRule(false)).toContain('text-align: start !important;')
  })

  it('skips marked elements and yields while the probe is set', () => {
    const style = document.createElement('style')
    style.textContent = readerTextAlignRule(true)
    document.head.appendChild(style)
    const [marked, plain] = paragraphs('center', 'start')
    marked!.setAttribute(BOOK_ALIGNMENT_ATTRIBUTE, '')
    const selector = readerTextAlignRule(true).split('{')[0]!.trim()

    expect(marked!.matches(selector)).toBe(false)
    expect(plain!.matches(selector)).toBe(true)
    document.documentElement.setAttribute(PROBE_ATTRIBUTE, '')
    expect(plain!.matches(selector)).toBe(false)

    style.remove()
  })
})
