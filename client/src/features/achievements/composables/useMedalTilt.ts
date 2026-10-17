import { useMediaQuery } from '@vueuse/core'

const MAX_TILT_DEG = 11

/**
 * Tilts a medal toward a mouse pointer. Writes the transform straight onto the medal, promoted to its
 * own layer for the length of the hover, at most once per frame: measured cheaper than routing it
 * through CSS variables, which restyle the whole medal subtree. Touch and reduced motion get no tilt.
 */
export function useMedalTilt() {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  let frame = 0
  let pending: { medal: SVGElement; x: number; y: number } | null = null
  // Measured once per hover: reading the box on every move would force a layout each time.
  let hovered: { target: HTMLElement; medal: SVGElement; rect: DOMRect } | null = null

  function flush() {
    frame = 0
    if (!pending) return
    const { medal, x, y } = pending
    pending = null
    medal.style.transform = `perspective(520px) rotateX(${(-y * MAX_TILT_DEG * 2).toFixed(1)}deg) rotateY(${(x * MAX_TILT_DEG * 2).toFixed(1)}deg) translateY(-3px)`
  }

  function handlePointerMove(event: PointerEvent) {
    if (reducedMotion.value || event.pointerType !== 'mouse') return
    const target = event.currentTarget as HTMLElement | null
    if (!target) return
    if (hovered?.target !== target) {
      const medal = target.querySelector<SVGElement>('.achievement-medal')
      if (!medal) return
      medal.style.willChange = 'transform'
      medal.style.transitionDuration = '80ms'
      hovered = { target, medal, rect: target.getBoundingClientRect() }
    }
    const { medal, rect } = hovered
    pending = { medal, x: (event.clientX - rect.left) / rect.width - 0.5, y: (event.clientY - rect.top) / rect.height - 0.5 }
    if (!frame) frame = requestAnimationFrame(flush)
  }

  function handlePointerLeave(event: PointerEvent) {
    if (!hovered || hovered.target !== event.currentTarget) return
    const { medal } = hovered
    if (pending?.medal === medal) pending = null
    hovered = null
    medal.style.transform = ''
    medal.style.transitionDuration = ''
    medal.style.willChange = ''
  }

  return { handlePointerMove, handlePointerLeave }
}
