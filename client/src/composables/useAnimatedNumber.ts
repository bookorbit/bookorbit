import { ref, watch, type Ref } from 'vue'

const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useAnimatedNumber(source: Ref<number>, duration = 600) {
  const displayed = ref(source.value)

  watch(source, (to, from) => {
    if (prefersReducedMotion || from === undefined) {
      displayed.value = to
      return
    }

    const start = performance.now()
    const diff = to - from

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      displayed.value = Math.round(from + diff * eased)
      if (progress < 1) requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  })

  return displayed
}
