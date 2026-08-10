const LEFT_ZONE = 0.3
const RIGHT_ZONE = 0.7
const DOUBLE_CLICK_MS = 300
const ANNOTATION_CLICK_SUPPRESSION_MS = DOUBLE_CLICK_MS + 100
const SWIPE_THRESHOLD = 50
const TAP_MOVEMENT_THRESHOLD = 10

interface FoliateInputView {
  prev?: () => void
  next?: () => void
  goLeft?: () => void
  goRight?: () => void
  getBoundingClientRect?: () => DOMRect
  renderer?: {
    getAttribute?: (name: string) => string | null
  }
}

export function useFoliateInput(
  getView: () => unknown,
  onMiddleTap: (() => void) | undefined,
  handleSelectionEnd: (doc: Document) => void,
  handleSelectionChange: (doc: Document) => void,
) {
  const clickedDocs = new WeakSet<Document>()

  let lastClickTime = 0
  let lastClickZone: 'left' | 'middle' | 'right' | null = null
  let isNavigating = false
  let suppressClickNavigationUntil = 0
  let touchStartX = 0
  let touchStartY = 0
  let touchStartScreenX = 0
  let touchStartScreenY = 0
  let touchStartTime = 0
  let lastTouchTime = 0
  let isTextSelectionInProgress = false
  let longHoldTimeout: ReturnType<typeof setTimeout> | null = null

  function getViewEl() {
    return getView() as FoliateInputView | null
  }

  function isScrolledFlow() {
    return getViewEl()?.renderer?.getAttribute?.('flow') === 'scrolled'
  }

  function navigateLeft() {
    const view = getViewEl()
    if (view?.goLeft) view.goLeft()
    else view?.prev?.()
  }

  function navigateRight() {
    const view = getViewEl()
    if (view?.goRight) view.goRight()
    else view?.next?.()
  }

  function navigatePrev() {
    getViewEl()?.prev?.()
  }

  function navigateNext() {
    getViewEl()?.next?.()
  }

  function suppressNextTapNavigation() {
    suppressClickNavigationUntil = Date.now() + ANNOTATION_CLICK_SUPPRESSION_MS
    lastClickTime = 0
    lastClickZone = null
  }

  function isTapNavigationSuppressed() {
    return Date.now() < suppressClickNavigationUntil
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]!
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    touchStartScreenX = touch.screenX
    touchStartScreenY = touch.screenY
    touchStartTime = Date.now()
    isTextSelectionInProgress = false
    longHoldTimeout = setTimeout(() => {
      longHoldTimeout = null
    }, 500)
  }

  function handleTouchMove(e: TouchEvent, doc: Document) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]!
    const deltaX = Math.abs(touch.clientX - touchStartX)
    const deltaY = Math.abs(touch.clientY - touchStartY)
    const selection = doc.defaultView?.getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      isTextSelectionInProgress = true
      return
    }
    if (deltaX > 10 && deltaX > deltaY && !isTextSelectionInProgress) return
  }

  function handleTouchEnd(e: TouchEvent, doc: Document) {
    const touchEndTime = Date.now()
    const touchDuration = touchEndTime - touchStartTime
    lastTouchTime = touchEndTime

    const selection = doc.defaultView?.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.rangeCount > 0

    if (hasSelection) {
      isTextSelectionInProgress = false
      setTimeout(() => handleSelectionEnd(doc), 50)
      return
    }

    if (!isTextSelectionInProgress && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0]!
      const deltaX = touch.clientX - touchStartX
      const deltaY = Math.abs(touch.clientY - touchStartY)

      if (Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > deltaY) {
        // Scrolled flow scrolls the iframe along with its container, so the content stays
        // under the finger and deltaY collapses to roughly zero. Any sideways drift while
        // scrolling would then read as a swipe and turn the page.
        if (isScrolledFlow()) return
        if (isNavigating) return
        isNavigating = true
        if (deltaX < 0) navigateRight()
        else navigateLeft()
        setTimeout(() => (isNavigating = false), 300)
        return
      }

      // Client coordinates move with the scrolling container, so only screen coordinates
      // separate a stationary tap from a flick that scrolled the page under the finger.
      const screenDeltaX = Math.abs(touch.screenX - touchStartScreenX)
      const screenDeltaY = Math.abs(touch.screenY - touchStartScreenY)

      if (touchDuration < 500 && screenDeltaX < TAP_MOVEMENT_THRESHOLD && screenDeltaY < TAP_MOVEMENT_THRESHOLD) {
        const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
        if (!iframe) return
        const iframeRect = iframe.getBoundingClientRect()
        const viewportX = iframeRect.left + touch.clientX
        window.postMessage(
          {
            type: 'foliate-click',
            clientX: viewportX,
            clientY: iframeRect.top + touch.clientY,
            iframeLeft: iframeRect.left,
            iframeWidth: iframeRect.width,
            eventClientX: touch.clientX,
          },
          window.location.origin,
        )
      }
    }

    isTextSelectionInProgress = false
  }

  function attachIframeClicks(doc: Document) {
    if (clickedDocs.has(doc)) return
    clickedDocs.add(doc)

    // Keep keyboard navigation active when focus moves into the EPUB iframe.
    doc.addEventListener('keydown', handleKeydown)

    doc.addEventListener(
      'mousedown',
      () => {
        longHoldTimeout = setTimeout(() => {
          longHoldTimeout = null
        }, 500)
      },
      true,
    )

    doc.addEventListener('mouseup', () => {
      handleSelectionEnd(doc)
    })

    doc.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (Date.now() - lastTouchTime < 500) return
        const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
        if (!iframe) return
        const rect = iframe.getBoundingClientRect()
        const viewportX = rect.left + e.clientX
        const viewportY = rect.top + e.clientY
        window.postMessage(
          {
            type: 'foliate-click',
            clientX: viewportX,
            clientY: viewportY,
            iframeLeft: rect.left,
            iframeWidth: rect.width,
            eventClientX: e.clientX,
          },
          window.location.origin,
        )
      },
      true,
    )

    doc.addEventListener('touchstart', (e: TouchEvent) => handleTouchStart(e), { passive: true })
    doc.addEventListener('touchmove', (e: TouchEvent) => handleTouchMove(e, doc), { passive: true })
    doc.addEventListener('touchend', (e: TouchEvent) => handleTouchEnd(e, doc), { passive: true })

    doc.addEventListener('selectionchange', () => handleSelectionChange(doc))
  }

  function handleWindowMessage(e: MessageEvent) {
    if (e.origin !== window.location.origin) return
    if (e.data?.type !== 'foliate-click') return
    if (isTapNavigationSuppressed()) return
    const view = getViewEl()
    if (!view) return

    const now = Date.now()
    const timeSinceLastClick = now - lastClickTime

    const viewRect = view.getBoundingClientRect?.()
    if (!viewRect) return

    const x = e.data.clientX - viewRect.left
    const width = viewRect.width

    const leftThreshold = width * LEFT_ZONE
    const rightThreshold = width * RIGHT_ZONE

    let currentZone: 'left' | 'middle' | 'right'
    if (x < leftThreshold) currentZone = 'left'
    else if (x > rightThreshold) currentZone = 'right'
    else currentZone = 'middle'

    if (timeSinceLastClick < DOUBLE_CLICK_MS && lastClickZone === currentZone) {
      lastClickTime = now
      lastClickZone = currentZone
      return
    }

    lastClickTime = now
    lastClickZone = currentZone

    setTimeout(() => {
      if (isTapNavigationSuppressed()) return
      if (Date.now() - lastClickTime < DOUBLE_CLICK_MS) return
      if (!longHoldTimeout) return
      if (isNavigating) return

      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

      if (currentZone === 'left' && !isMobile) {
        isNavigating = true
        navigateLeft()
        setTimeout(() => (isNavigating = false), 300)
      } else if (currentZone === 'right' && !isMobile) {
        isNavigating = true
        navigateRight()
        setTimeout(() => (isNavigating = false), 300)
      } else {
        onMiddleTap?.()
      }
    }, DOUBLE_CLICK_MS)
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = (e.composedPath?.()[0] || e.target) as HTMLElement | null
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
    const view = getViewEl()
    if (!view) return
    if (e.key === 'ArrowLeft') {
      navigateLeft()
      e.preventDefault()
    } else if (e.key === 'ArrowRight') {
      navigateRight()
      e.preventDefault()
    } else if (e.key === 'PageUp') {
      navigatePrev()
      e.preventDefault()
    } else if (e.key === 'PageDown') {
      navigateNext()
      e.preventDefault()
    } else if (e.key === ' ' && e.shiftKey) {
      navigatePrev()
      e.preventDefault()
    } else if (e.key === ' ') {
      navigateNext()
      e.preventDefault()
    }
  }

  window.addEventListener('message', handleWindowMessage)
  document.addEventListener('keydown', handleKeydown)

  function cleanup() {
    window.removeEventListener('message', handleWindowMessage)
    document.removeEventListener('keydown', handleKeydown)
  }

  return { attachIframeClicks, suppressNextTapNavigation, cleanup }
}
