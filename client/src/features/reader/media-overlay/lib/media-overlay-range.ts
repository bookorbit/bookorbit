type MediaOverlayItem = { text: string }

// The element a SMIL <text> reference narrates, looked up the way foliate's
// resolveHref does, so starting and highlighting agree on the element.
function narratedElement(doc: Document, text: string): Element | null {
  const id = text.split('#')[1]
  if (!id) return null
  return doc.getElementById(id) ?? doc.getElementsByName(id)[0] ?? null
}

// Accepts the SMIL entries whose narrated element overlaps `range`, so
// foliate, which walks entries in reading order, starts at the first narrated
// sentence the range touches.
//
// Only the overlay knows which ids are narrated. Storyteller wraps each
// sentence in its own span but keeps the book's inline elements inside it with
// their ids (Kobo's `kobo.N.N`, calibre's `calibre_link-N`), so the id nearest
// the selected text is often one no SMIL entry names.
export function mediaOverlayEntriesOverlapping(range: Range): (item: MediaOverlayItem) => boolean {
  const doc = range.startContainer.ownerDocument ?? (range.startContainer as Document)
  return (item) => {
    const element = narratedElement(doc, item.text)
    if (!element) return false
    try {
      return range.intersectsNode(element)
    } catch {
      return false
    }
  }
}
