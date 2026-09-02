import { describe, expect, it, vi } from 'vitest'
import { useReaderState } from '../useReaderState'

describe('useReaderState', () => {
  it('clamps numeric settings to supported ranges', () => {
    const state = useReaderState()

    state.setFontSize(100)
    state.setLineHeight(0.71)
    state.setParagraphSpacing(3)
    state.setLetterSpacing(0.3)
    state.setWordSpacing(0.8)
    state.setTextIndent(8)
    state.setMaxColumnCount(0)
    state.setGap(0.9)
    state.setMaxInlineSize(200)
    state.setMaxBlockSize(8000)

    expect(state.fontSize.value).toBe(32)
    expect(state.lineHeight.value).toBe(0.8)
    expect(state.paragraphSpacing.value).toBe(2)
    expect(state.letterSpacing.value).toBe(0.2)
    expect(state.wordSpacing.value).toBe(0.5)
    expect(state.textIndent.value).toBe(4)
    expect(state.maxColumnCount.value).toBe(1)
    expect(state.gap.value).toBe(0.5)
    expect(state.maxInlineSize.value).toBe(400)
    expect(state.maxBlockSize.value).toBe(2400)

    state.setFontSize(1)
    state.setParagraphSpacing(-1)
    state.setLetterSpacing(-1)
    state.setWordSpacing(-1)
    state.setTextIndent(-1)
    expect(state.fontSize.value).toBe(6)
    expect(state.paragraphSpacing.value).toBe(0)
    expect(state.letterSpacing.value).toBe(0)
    expect(state.wordSpacing.value).toBe(0)
    expect(state.textIndent.value).toBe(0)
  })

  it('selects default theme when unknown theme name is set', () => {
    const state = useReaderState()

    state.setThemeName('non-existent-theme')

    expect(state.currentTheme.value.name).toBe('default')
  })

  it('tracks fixed-layout EPUB spread mode', () => {
    const state = useReaderState()

    expect(state.fixedLayoutSpread.value).toBe('auto')

    state.setFixedLayoutSpread('none')

    expect(state.fixedLayoutSpread.value).toBe('none')
    expect(state.state.value.fixedLayoutSpread).toBe('none')
  })

  it('switches active mode between light and dark variants', () => {
    const state = useReaderState()

    state.setThemeName('sepia')
    state.setIsDark(false)
    const light = state.activeMode.value

    state.setIsDark(true)
    const dark = state.activeMode.value

    expect(light).toEqual(state.currentTheme.value.light)
    expect(dark).toEqual(state.currentTheme.value.dark)
    expect(dark.bg).not.toBe(light.bg)
  })

  it('applies renderer attributes and CSS in paginated flow', () => {
    const state = useReaderState()
    state.setFlow('paginated')
    state.setGap(0.12)
    state.setMaxColumnCount(3)

    const renderer = {
      setAttribute: vi.fn<(name: string, value: string) => void>(),
      removeAttribute: vi.fn<(name: string) => void>(),
      setStyles: vi.fn<(css: string) => void>(),
    }

    state.applyToRenderer(renderer)

    expect(renderer.setAttribute).toHaveBeenCalledWith('max-column-count', '3')
    expect(renderer.setAttribute).toHaveBeenCalledWith('gap', '12%')
    expect(renderer.setAttribute).toHaveBeenCalledWith('max-inline-size', `${state.maxInlineSize.value}px`)
    expect(renderer.setAttribute).toHaveBeenCalledWith('max-block-size', `${state.maxBlockSize.value}px`)
    expect(renderer.setAttribute).toHaveBeenCalledWith('margin', '40px')
    expect(renderer.setAttribute).toHaveBeenCalledWith('flow', 'paginated')
    expect(renderer.removeAttribute).not.toHaveBeenCalledWith('margin')
    expect(renderer.setStyles).toHaveBeenCalledTimes(1)
  })

  it('removes margin in scrolled flow', () => {
    const state = useReaderState()
    state.setFlow('scrolled')

    const renderer = {
      setAttribute: vi.fn<(name: string, value: string) => void>(),
      removeAttribute: vi.fn<(name: string) => void>(),
      setStyles: vi.fn<(css: string) => void>(),
    }

    state.applyToRenderer(renderer)

    expect(renderer.removeAttribute).toHaveBeenCalledWith('margin')
    expect(renderer.setAttribute).toHaveBeenCalledWith('flow', 'scrolled')
  })

  it('can override renderer flow without changing saved reader state', () => {
    const state = useReaderState()
    state.setFlow('scrolled')

    const renderer = {
      setAttribute: vi.fn<(name: string, value: string) => void>(),
      removeAttribute: vi.fn<(name: string) => void>(),
      setStyles: vi.fn<(css: string) => void>(),
    }

    state.applyToRenderer(renderer, { flow: 'paginated' })

    expect(state.flow.value).toBe('scrolled')
    expect(renderer.setAttribute).toHaveBeenCalledWith('margin', '40px')
    expect(renderer.setAttribute).toHaveBeenCalledWith('flow', 'paginated')
    expect(renderer.removeAttribute).not.toHaveBeenCalledWith('margin')
  })

  it('generates CSS with optional font-family override and text controls', () => {
    const state = useReaderState()
    state.setFontFamily('serif')
    state.setJustify(false)
    state.setHyphenate(false)
    state.setLineHeight(1.8)
    state.setFontSize(20)

    const css = state.generateCSS()

    expect(css).toContain('font-family: serif !important;')
    expect(css).toContain('line-height: 1.8;')
    expect(css).toContain('font-size: 20px;')
    expect(css).toContain('text-align: start !important;')
    expect(css).toContain('hyphens: none;')
  })

  it('preserves publisher paragraph margins at the default spacing', () => {
    const state = useReaderState()

    expect(state.paragraphSpacing.value).toBe(0)
    expect(state.generateCSS()).not.toContain('margin-block:')
  })

  it('generates logical paragraph margins for positive spacing', () => {
    const state = useReaderState()
    state.setParagraphSpacing(1.6)

    const css = state.generateCSS()

    expect(css).toContain('margin-block: 0 1.6em !important;')
    expect(css).toContain(':is(hgroup, header) p')
    expect(css).toContain('margin-block: unset !important;')
  })

  it('preserves publisher typography when nullable controls are unset', () => {
    const state = useReaderState()

    expect(state.letterSpacing.value).toBeNull()
    expect(state.wordSpacing.value).toBeNull()
    expect(state.textIndent.value).toBeNull()
    expect(state.generateCSS()).not.toContain('letter-spacing:')
    expect(state.generateCSS()).not.toContain('word-spacing:')
    expect(state.generateCSS()).not.toContain('text-indent:')
  })

  it('emits explicit zero typography overrides and can return to publisher styles', () => {
    const state = useReaderState()
    state.setLetterSpacing(0)
    state.setWordSpacing(0)
    state.setTextIndent(0)

    const css = state.generateCSS()
    expect(css).toContain('letter-spacing: 0em !important;')
    expect(css).toContain('word-spacing: 0em !important;')
    expect(css).toContain('text-indent: 0em !important;')

    state.setLetterSpacing(null)
    state.setWordSpacing(null)
    state.setTextIndent(null)
    expect(state.state.value).toMatchObject({
      letterSpacing: null,
      wordSpacing: null,
      textIndent: null,
    })
  })

  it('generates em-based typography CSS for positive values', () => {
    const state = useReaderState()
    state.setLetterSpacing(0.12)
    state.setWordSpacing(0.35)
    state.setTextIndent(1.75)

    const css = state.generateCSS()
    expect(css).toContain('letter-spacing: 0.12em !important;')
    expect(css).toContain('word-spacing: 0.35em !important;')
    expect(css).toContain('text-indent: 1.75em !important;')
    expect(css).toContain(':is(hgroup, header, figure, figcaption, blockquote, li) > p')
  })

  describe('font style', () => {
    it('leaves weight and slant out of the CSS while they sit at their defaults', () => {
      const state = useReaderState()
      state.setFontFamily('serif')

      const css = state.generateCSS()

      expect(css).not.toContain('font-weight:')
      expect(css).not.toContain('font-style:')
    })

    it('applies a chosen weight and slant to the body', () => {
      const state = useReaderState()
      state.setFontFamily('serif')
      state.setFontWeight(700)
      state.setFontStyle('italic')

      const css = state.generateCSS()

      expect(css).toContain('font-weight: 700 !important;')
      expect(css).toContain('font-style: italic !important;')
    })

    it("never pushes weight or slant onto descendants, which would flatten the book's emphasis", () => {
      const state = useReaderState()
      state.setFontFamily('serif')
      state.setFontWeight(700)
      state.setFontStyle('italic')

      const descendantRule = state.generateCSS().match(/body \*\s*\{[^}]*\}/)?.[0] ?? ''

      expect(descendantRule).toContain('font-family: inherit !important;')
      expect(descendantRule).not.toContain('font-weight')
      expect(descendantRule).not.toContain('font-style')
    })

    it("applies a style to the book's own font when no family is chosen", () => {
      const state = useReaderState()
      state.setFontWeight(300)

      const css = state.generateCSS()

      expect(css).toContain('font-weight: 300 !important;')
      expect(css).not.toContain('font-family:')
      expect(css).not.toContain('body *')
    })
  })
})
