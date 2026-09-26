export const MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS = '-epub-media-overlay-active'
export const MEDIA_OVERLAY_HIGHLIGHT_CSS_VARIABLE = '--bookorbit-media-overlay-highlight'

const MEDIA_OVERLAY_HIGHLIGHT_STYLE_ID = 'bo-media-overlay-highlight'
const MEDIA_OVERLAY_DEFAULT_HIGHLIGHT = 'rgba(79, 195, 247, 0.3)'

type MediaOverlayBook = {
  media?: { activeClass?: string }
  sections?: { mediaOverlay?: unknown }[]
}

export function ensureMediaOverlayActiveClass(book: unknown): void {
  if (!book || typeof book !== 'object') return

  const epubBook = book as MediaOverlayBook
  if (!epubBook.sections?.some((section) => section.mediaOverlay)) return

  epubBook.media ??= {}
  if (!epubBook.media.activeClass?.trim()) {
    epubBook.media.activeClass = MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS
  }
}

export function injectMediaOverlayHighlightCss(doc: Document, activeClass?: string | null): void {
  if (!doc.head || doc.getElementById(MEDIA_OVERLAY_HIGHLIGHT_STYLE_ID)) return

  const resolvedActiveClass = activeClass?.trim() || MEDIA_OVERLAY_DEFAULT_ACTIVE_CLASS
  const escapedActiveClass = (doc.defaultView?.CSS ?? CSS).escape(resolvedActiveClass)
  const style = doc.createElement('style')
  style.id = MEDIA_OVERLAY_HIGHLIGHT_STYLE_ID
  style.textContent = `.${escapedActiveClass} { background-color: var(${MEDIA_OVERLAY_HIGHLIGHT_CSS_VARIABLE}, ${MEDIA_OVERLAY_DEFAULT_HIGHLIGHT}) !important; border-radius: 0.15em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }`
  doc.head.appendChild(style)
}
