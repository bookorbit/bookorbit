// The reader applies its justify/start choice to body text with `!important`, so it wins over
// publisher rules such as `p { text-align: left }`. Applied blindly, that also flattens text the
// book deliberately centres or sets against the end edge (epigraphs, scene breaks, signatures),
// whether the book does it with a class, an inline style, an `align` attribute or a centred
// parent. Each chapter is therefore measured once with the reader rule switched off, and every
// element the book aligns that way is marked so the reader rule skips it.

export const BOOK_ALIGNMENT_ATTRIBUTE = 'data-bookorbit-book-align'
const ALIGNMENT_PROBE_ATTRIBUTE = 'data-bookorbit-align-probe'
const READER_ALIGNED_SELECTOR = 'p, li, blockquote, dd'

// `:where()` keeps the specificity of the plain element selector the rule had before marking.
export function readerTextAlignRule(justify: boolean): string {
  return `:where(:root:not([${ALIGNMENT_PROBE_ATTRIBUTE}])) :is(${READER_ALIGNED_SELECTOR}):where(:not([${BOOK_ALIGNMENT_ATTRIBUTE}])) {
          text-align: ${justify ? 'justify' : 'start'} !important;
      }`
}

// Start-edge and justified text is ordinary body text, which the reader setting may restyle.
export function keepsBookAlignment(textAlign: string, direction: string): boolean {
  switch (textAlign) {
    case 'center':
    case '-webkit-center':
    case 'end':
      return true
    case 'right':
    case '-webkit-right':
      return direction !== 'rtl'
    case 'left':
    case '-webkit-left':
      return direction === 'rtl'
    default:
      return false
  }
}

export function markBookAlignment(doc: Document): void {
  const root = doc.documentElement
  const view = doc.defaultView
  if (!root || !view || !doc.body) return
  root.setAttribute(ALIGNMENT_PROBE_ATTRIBUTE, '')
  try {
    for (const el of doc.body.querySelectorAll(READER_ALIGNED_SELECTOR)) {
      const style = view.getComputedStyle(el)
      el.toggleAttribute(BOOK_ALIGNMENT_ATTRIBUTE, keepsBookAlignment(style.textAlign, style.direction))
    }
  } finally {
    root.removeAttribute(ALIGNMENT_PROBE_ATTRIBUTE)
  }
}
