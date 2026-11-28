import { onBeforeUnmount } from 'vue'

const DEFAULT_DELAY_MS = 450
const MOVE_TOLERANCE_PX = 10

/**
 * Calls `onLongPress` when a touch is held still. Mouse and pen are ignored: they have hover. The
 * click a browser may still fire after the hold is reported by `consumeClick`, so it is not also
 * taken as a tap.
 */
export function useLongPress(onLongPress: () => void, delayMs = DEFAULT_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let origin: { x: number; y: number } | null = null
  let swallowClick = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    origin = null
  }

  function onPointerDown(event: PointerEvent) {
    swallowClick = false
    if (event.pointerType !== 'touch') return
    cancel()
    origin = { x: event.clientX, y: event.clientY }
    timer = setTimeout(() => {
      timer = null
      origin = null
      swallowClick = true
      onLongPress()
    }, delayMs)
  }

  function onPointerMove(event: PointerEvent) {
    if (!origin) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_TOLERANCE_PX) cancel()
  }

  function consumeClick(): boolean {
    const swallowed = swallowClick
    swallowClick = false
    return swallowed
  }

  onBeforeUnmount(cancel)

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, consumeClick }
}
