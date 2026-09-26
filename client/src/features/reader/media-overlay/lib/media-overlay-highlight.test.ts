import { describe, expect, it } from 'vitest'
import {
  ensureMediaOverlayActiveClass,
  injectMediaOverlayHighlightCss,
  MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS,
  MEDIA_OVERLAY_HIGHLIGHT_CSS_VARIABLE,
} from './media-overlay-highlight'

describe('media overlay active class', () => {
  it('applies the EPUB default when an overlay book does not declare a class', () => {
    const book: { media?: { activeClass?: string }; sections: { mediaOverlay: unknown }[] } = {
      sections: [{ mediaOverlay: { id: 'overlay' } }],
    }

    ensureMediaOverlayActiveClass(book)

    expect(book.media?.activeClass).toBe(MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS)
  })

  it('preserves the active class declared by the book', () => {
    const book = { media: { activeClass: 'book-active' }, sections: [{ mediaOverlay: { id: 'overlay' } }] }

    ensureMediaOverlayActiveClass(book)

    expect(book.media.activeClass).toBe('book-active')
  })

  it('does not add media metadata to books without overlays', () => {
    const book: { media?: { activeClass?: string }; sections: { mediaOverlay?: unknown }[] } = { sections: [{}] }

    ensureMediaOverlayActiveClass(book)

    expect(book.media).toBeUndefined()
  })
})

describe('media overlay highlight CSS', () => {
  it('targets the book active class with an important theme-aware background', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument!

    injectMediaOverlayHighlightCss(doc, 'book:active')

    const style = doc.head.querySelector('style')
    const rule = style?.sheet?.cssRules[0] as CSSStyleRule | undefined
    expect(rule?.selectorText).toBe(`.${CSS.escape('book:active')}`)
    expect(rule?.style.getPropertyValue('background-color')).toContain(`var(${MEDIA_OVERLAY_HIGHLIGHT_CSS_VARIABLE}`)
    expect(style?.textContent).toMatch(/background-color: var\([^;]+\) !important;/)
    frame.remove()
  })

  it('uses the EPUB default class and injects only one rule per chapter', () => {
    const doc = document.implementation.createHTMLDocument()

    injectMediaOverlayHighlightCss(doc)
    injectMediaOverlayHighlightCss(doc, 'different-active-class')

    const styles = doc.head.querySelectorAll('style')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toContain(`.${MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS}`)
    expect(styles[0]?.textContent).not.toContain('different-active-class')
  })

  it('keeps the active sentence visible over an important themed page background', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    const themeStyle = doc.createElement('style')
    themeStyle.textContent = 'body * { background-color: rgb(241, 232, 208) !important; }'
    doc.head.appendChild(themeStyle)
    injectMediaOverlayHighlightCss(doc, 'book-active')

    const highlightStyle = doc.head.querySelector<HTMLStyleElement>('#bo-media-overlay-highlight')!
    // jsdom does not resolve custom properties, so substitute the theme variable's resolved value to exercise the priority cascade.
    highlightStyle.textContent = (highlightStyle.textContent ?? '').replace(/var\([^;]+\)/, 'rgba(79, 195, 247, 0.3)')
    const sentence = doc.createElement('span')
    sentence.className = 'book-active'
    doc.body.appendChild(sentence)

    expect(frame.contentWindow?.getComputedStyle(sentence).backgroundColor).toBe('rgba(79, 195, 247, 0.3)')
    frame.remove()
  })
})
