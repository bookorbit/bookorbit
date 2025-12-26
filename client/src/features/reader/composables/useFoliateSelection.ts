export interface SelectionDetail {
  text: string
  cfi: string | null
  popupPosition: { x: number; y: number; showBelow: boolean }
}

export function useFoliateSelection(getView: () => unknown) {
  let onTextSelected: ((detail: SelectionDetail) => void) | undefined
  let selectionChangeTimeout: ReturnType<typeof setTimeout> | null = null

  function setHandler(fn: (detail: SelectionDetail) => void) {
    onTextSelected = fn
  }

  function handleSelectionEnd(doc: Document) {
    setTimeout(() => {
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

      onTextSelected?.({ text, cfi: selectionCfi, popupPosition: { x: clampedX, y: popupY, showBelow } })
    }, 10)
  }

  function handleSelectionChange(doc: Document) {
    if (selectionChangeTimeout) clearTimeout(selectionChangeTimeout)
    selectionChangeTimeout = setTimeout(() => {
      const selection = doc.defaultView?.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const text = range.toString().trim()
      if (!text) return
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        handleSelectionEnd(doc)
      }
    }, 300)
  }

  return { setHandler, handleSelectionEnd, handleSelectionChange }
}
