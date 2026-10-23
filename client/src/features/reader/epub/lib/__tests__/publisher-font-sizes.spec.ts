// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makePublisherFontSizesScalable, readerFontScaleDeclarations, scalePublisherFontSizes } from '../publisher-font-sizes'

const scaled = (value: string) => `calc(${value} * var(--bookorbit-font-scale, 1))`

describe('makePublisherFontSizesScalable', () => {
  it('routes an absolute-size keyword through its reader variable, falling back to the keyword', () => {
    expect(makePublisherFontSizesScalable('body { font-size: medium; }')).toBe('body { font-size: var(--bookorbit-font-medium, medium); }')
  })

  it.each(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'])('handles the %s keyword', (keyword) => {
    expect(makePublisherFontSizesScalable(`p{font-size:${keyword}}`)).toBe(`p{font-size:var(--bookorbit-font-${keyword}, ${keyword})}`)
  })

  it('matches property names and keywords case-insensitively', () => {
    expect(makePublisherFontSizesScalable('P { FONT-SIZE: Small }')).toBe('P { FONT-SIZE: var(--bookorbit-font-small, Small) }')
  })

  it.each(['12px', '10pt', '.75pt', '12.5px', '1pc', '0.2in', '0.5cm', '4mm', '16Q', '0px'])('scales the absolute length %s', (value) => {
    expect(makePublisherFontSizesScalable(`.calibre { font-size: ${value}; }`)).toBe(`.calibre { font-size: ${scaled(value)}; }`)
  })

  it('keeps !important on a rewritten declaration', () => {
    expect(makePublisherFontSizesScalable('p { font-size: 12px !important; }')).toBe(`p { font-size: ${scaled('12px')} !important; }`)
    expect(makePublisherFontSizesScalable('p { font-size: small!important }')).toBe('p { font-size: var(--bookorbit-font-small, small)!important }')
  })

  it('rewrites a style attribute value, with or without a trailing semicolon', () => {
    expect(makePublisherFontSizesScalable('font-size:10pt')).toBe(`font-size:${scaled('10pt')}`)
    expect(makePublisherFontSizesScalable('color: red; font-size: 9px;')).toBe(`color: red; font-size: ${scaled('9px')};`)
  })

  it('rewrites every declaration in a stylesheet, including inside at-rules', () => {
    const css = `body {
  font-size: medium;
  line-height: 1.2em;
}
@media screen {
  .note { font-size: 9pt }
}
h1 { font-size: 1.5em; }`

    expect(makePublisherFontSizesScalable(css)).toBe(`body {
  font-size: var(--bookorbit-font-medium, medium);
  line-height: 1.2em;
}
@media screen {
  .note { font-size: ${scaled('9pt')} }
}
h1 { font-size: 1.5em; }`)
  })

  it.each(['1em', '1.2rem', '90%', 'smaller', 'larger', 'inherit', 'initial', 'unset', '0', 'calc(12px + 1em)', 'var(--size)', '12px\\9'])(
    'leaves the relative or unrecognised value %s alone',
    (value) => {
      const css = `p { font-size: ${value}; }`
      expect(makePublisherFontSizesScalable(css)).toBe(css)
    },
  )

  it('leaves other properties alone, including longer names that end in font-size', () => {
    const css = 'p { font-size-adjust: 0.5; --title-font-size: 12px; line-height: 12px; font: bold 12px serif; }'
    expect(makePublisherFontSizesScalable(css)).toBe(css)
  })

  it('does not touch font-size text inside comments or strings', () => {
    const css = `/* font-size: 12px; */
p::before { content: "font-size: 12px"; }
[style*='font-size: small'] { color: red; }`
    expect(makePublisherFontSizesScalable(css)).toBe(css)
  })

  it('is idempotent', () => {
    const once = makePublisherFontSizesScalable('body { font-size: medium } p { font-size: 10pt !important }')
    expect(makePublisherFontSizesScalable(once)).toBe(once)
  })

  it('returns CSS with no font-size untouched', () => {
    const css = 'p { margin: 0; }'
    expect(makePublisherFontSizesScalable(css)).toBe(css)
  })
})

describe('readerFontScaleDeclarations', () => {
  it('resolves to the browser keyword sizes at the 16px default', () => {
    expect(readerFontScaleDeclarations(16)).toEqual([
      '--bookorbit-font-scale: 1;',
      '--bookorbit-font-xx-small: 9px;',
      '--bookorbit-font-x-small: 10px;',
      '--bookorbit-font-small: 13px;',
      '--bookorbit-font-medium: 16px;',
      '--bookorbit-font-large: 18px;',
      '--bookorbit-font-x-large: 24px;',
      '--bookorbit-font-xx-large: 32px;',
      '--bookorbit-font-xxx-large: 48px;',
    ])
  })

  it('scales every keyword with the reader size so medium matches it', () => {
    const declarations = readerFontScaleDeclarations(24)
    expect(declarations).toContain('--bookorbit-font-scale: 1.5;')
    expect(declarations).toContain('--bookorbit-font-medium: 24px;')
    expect(declarations).toContain('--bookorbit-font-small: 19.5px;')
  })

  it('keeps fractional values short', () => {
    expect(readerFontScaleDeclarations(17)).toContain('--bookorbit-font-scale: 1.0625;')
    expect(readerFontScaleDeclarations(17)).toContain('--bookorbit-font-small: 13.8125px;')
    expect(readerFontScaleDeclarations(11)).toContain('--bookorbit-font-x-small: 6.875px;')
  })
})

describe('scalePublisherFontSizes', () => {
  function dispatchCss(target: EventTarget, data: unknown) {
    const detail = { data }
    target.dispatchEvent(new CustomEvent('css', { detail }))
    return detail.data
  }

  it('rewrites the CSS the book loader hands over', () => {
    const transformTarget = new EventTarget()
    scalePublisherFontSizes({ transformTarget })

    expect(dispatchCss(transformTarget, 'body { font-size: medium }')).toBe('body { font-size: var(--bookorbit-font-medium, medium) }')
  })

  it('ignores data that is not a CSS string', () => {
    const transformTarget = new EventTarget()
    scalePublisherFontSizes({ transformTarget })
    const pending = Promise.resolve('body { font-size: medium }')

    expect(dispatchCss(transformTarget, pending)).toBe(pending)
  })

  it('tolerates books without a transform target', () => {
    expect(() => scalePublisherFontSizes({})).not.toThrow()
    expect(() => scalePublisherFontSizes(null)).not.toThrow()
  })
})
