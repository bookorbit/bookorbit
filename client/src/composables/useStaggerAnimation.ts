import { type CSSProperties } from 'vue'

const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface StaggerOptions {
  baseDelay?: number
  maxDelay?: number
}

export function useStaggerAnimation(options: StaggerOptions = {}) {
  const { baseDelay = 35, maxDelay = 500 } = options

  function getStaggerStyle(index: number): CSSProperties {
    if (prefersReducedMotion) return {}
    return { animationDelay: `${Math.min(index * baseDelay, maxDelay)}ms` }
  }

  return { getStaggerStyle }
}
