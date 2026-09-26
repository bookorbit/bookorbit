export interface SelectionDetail {
  text: string
  cfi: string | null
  range: Range | null
  popupPosition: { x: number; y: number; showBelow: boolean }
}

export function useFoliateSelection(getView: () => unknown) {
  let onTextSelected: ((detail: SelectionDetail) => void) | undefined
  let onInteractionStart: (() => void) | undefined
  let selectionChangeTimeout: ReturnType<typeof setTimeout> | null = null
  const interactingDocs = new WeakSet<Document>()
  const changedDocs = new WeakSet<Document>()

  function setHandler(fn: (detail: SelectionDetail) => void) {
    onTextSelected = fn
  }

  function setInteractionStartHandler(fn: () => void) {
    onInteractionStart = fn
  }

  function clearSelectionTimer() {
    if (selectionChangeTimeout) clearTimeout(selectionChangeTimeout)
    selectionChangeTimeout = null
  }

  function emitSelection(doc: Document) {
    const selection = doc.defaultView?.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const text = range.toString().trim()
    if (!text) return

    const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
    const rangeRect = range.getBoundingClientRect()
    let popupX = rangeRect.left + rangeRect.width / 2
    let selectionTop = rangeRect.top
    let selectionBottom = rangeRect.bottom

    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect()
      popupX = iframeRect.left + rangeRect.left + rangeRect.width / 2
      selectionTop = iframeRect.top + rangeRect.top
      selectionBottom = iframeRect.top + rangeRect.bottom
    }

    const minSpaceAbove = 120
    const showBelow = selectionTop < minSpaceAbove
    const popupY = showBelow ? selectionBottom + 10 : selectionTop - 50
    const clampedX = Math.max(100, Math.min(popupX, window.innerWidth - 150))

    const view = getView() as {
      renderer?: { getContents?: () => { index: number }[] }
      getCFI?: (index: number, range: Range) => string | null
    } | null
    const contents = view?.renderer?.getContents?.()
    const content = contents?.[0]
    const selectionCfi = content ? (view?.getCFI?.(content.index, range) ?? null) : null

    onTextSelected?.({ text, cfi: selectionCfi, range: range.cloneRange(), popupPosition: { x: clampedX, y: popupY, showBelow } })
  }

  function scheduleSelection(doc: Document, delay: number) {
    clearSelectionTimer()
    selectionChangeTimeout = setTimeout(() => {
      selectionChangeTimeout = null
      emitSelection(doc)
    }, delay)
  }

  function handleSelectionEnd(doc: Document) {
    scheduleSelection(doc, 10)
  }

  function handleInteractionStart(doc: Document) {
    clearSelectionTimer()
    interactingDocs.add(doc)
    const selection = doc.defaultView?.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    changedDocs.add(doc)
    onInteractionStart?.()
  }

  function handleInteractionEnd(doc: Document) {
    if (!interactingDocs.has(doc)) return
    interactingDocs.delete(doc)

    const selection = doc.defaultView?.getSelection()
    const hasSelection = Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0)
    const selectionChanged = changedDocs.has(doc)
    changedDocs.delete(doc)
    if (selectionChanged || hasSelection) scheduleSelection(doc, 50)
  }

  function handleSelectionChange(doc: Document) {
    clearSelectionTimer()
    if (interactingDocs.has(doc)) {
      changedDocs.add(doc)
      return
    }
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) scheduleSelection(doc, 300)
  }

  return { setHandler, setInteractionStartHandler, handleSelectionEnd, handleSelectionChange, handleInteractionStart, handleInteractionEnd }
}
