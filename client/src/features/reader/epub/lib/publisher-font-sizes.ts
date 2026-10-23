// Publisher CSS often fixes text size with a keyword (`body { font-size: medium }`) or an absolute
// length (`p { font-size: 10pt }`). Neither inherits from the root, so the reader's text size,
// which is set on `html`, never reaches that text. Rewriting those values to read a reader-owned
// scale lets them follow the setting. Every rewrite falls back to the original value, so a book
// renders exactly as before whenever the reader injects no styles.

export const READER_FONT_SCALE_CSS_VARIABLE = '--bookorbit-font-scale'

// Browsers resolve the absolute-size keywords against a 16px default with this shared table.
const BROWSER_DEFAULT_FONT_SIZE_PX = 16
const KEYWORD_FONT_SIZES_PX = new Map([
  ['xx-small', 9],
  ['x-small', 10],
  ['small', 13],
  ['medium', 16],
  ['large', 18],
  ['x-large', 24],
  ['xx-large', 32],
  ['xxx-large', 48],
])

const ABSOLUTE_LENGTH = /^\+?(?:\d+\.?\d*|\.\d+)(?:px|pt|pc|in|cm|mm|q)$/i

// Comments and strings are matched first so a `font-size:` inside either is passed through.
// The property must not be the tail of a longer name such as `--title-font-size`.
const FONT_SIZE_DECLARATION =
  /(\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(^|[^-\w])(font-size\s*:\s*)([^;{}!"'/]*?)(?=\s*(?:!\s*important\s*)?(?:[;}]|$))/gi

function keywordVariable(keyword: string): string {
  return `--bookorbit-font-${keyword}`
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)))
}

function scalableFontSize(value: string): string | null {
  const keyword = value.toLowerCase()
  if (KEYWORD_FONT_SIZES_PX.has(keyword)) return `var(${keywordVariable(keyword)}, ${value})`
  if (ABSOLUTE_LENGTH.test(value)) return `calc(${value} * var(${READER_FONT_SCALE_CSS_VARIABLE}, 1))`
  return null
}

export function makePublisherFontSizesScalable(css: string): string {
  if (!/font-size/i.test(css)) return css
  return css.replace(FONT_SIZE_DECLARATION, (match, skipped: string | undefined, prefix: string, property: string, value: string) => {
    if (skipped !== undefined) return match
    const scalable = scalableFontSize(value)
    return scalable ? `${prefix}${property}${scalable}` : match
  })
}

// A keyword fallback cannot sit inside calc(), so each keyword gets its own resolved variable.
export function readerFontScaleDeclarations(fontSizePx: number): string[] {
  const scale = fontSizePx / BROWSER_DEFAULT_FONT_SIZE_PX
  return [
    `${READER_FONT_SCALE_CSS_VARIABLE}: ${formatNumber(scale)};`,
    ...[...KEYWORD_FONT_SIZES_PX].map(([keyword, px]) => `${keywordVariable(keyword)}: ${formatNumber(px * scale)}px;`),
  ]
}

export function scalePublisherFontSizes(book: unknown): void {
  const target = (book as { transformTarget?: EventTarget } | null)?.transformTarget
  target?.addEventListener('css', (event) => {
    const detail = (event as CustomEvent<{ data: unknown }>).detail
    if (typeof detail?.data === 'string') detail.data = makePublisherFontSizesScalable(detail.data)
  })
}
