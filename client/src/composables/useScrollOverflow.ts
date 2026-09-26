import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * Whether a horizontally scrollable element still has content past its start or end edge.
 *
 * A row that hides its scrollbar gives a pointer no hint that anything is out there, so callers use
 * these to fade the edge that has more behind it. Touch discovers the overflow by swiping; a mouse
 * has nothing to go on.
 */
export function useScrollOverflow(target: Ref<HTMLElement | null>) {
  const hasStartOverflow = ref(false)
  const hasEndOverflow = ref(false)
  let observer: ResizeObserver | null = null

  function measure(): void {
    const element = target.value
    if (!element) {
      hasStartOverflow.value = false
      hasEndOverflow.value = false
      return
    }
    // Sub-pixel layout leaves a fraction of a pixel behind on an element that is fully scrolled,
    // which would otherwise read as overflow and leave the fade showing at the end of the row.
    const remaining = element.scrollWidth - element.clientWidth - Math.abs(element.scrollLeft)
    hasStartOverflow.value = Math.abs(element.scrollLeft) > 1
    hasEndOverflow.value = remaining > 1
  }

  watch(
    target,
    (element, _previous, onCleanup) => {
      observer?.disconnect()
      observer = null
      if (!element) return
      element.addEventListener('scroll', measure, { passive: true })
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure)
        observer.observe(element)
        for (const child of element.children) observer.observe(child)
      }
      measure()
      onCleanup(() => {
        element.removeEventListener('scroll', measure)
        observer?.disconnect()
        observer = null
      })
    },
    { immediate: true, flush: 'post' },
  )

  onScopeDispose(() => observer?.disconnect())

  return { hasStartOverflow, hasEndOverflow, measure }
}
