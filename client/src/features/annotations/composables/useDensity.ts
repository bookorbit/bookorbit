import { ref, watch } from 'vue'

export type AnnotationDensity = 'compact' | 'comfortable'

const STORAGE_KEY = 'annotations:density'

/** Density preference shared across the annotations hub and the book highlights tab. */
export function useDensity() {
  const stored = localStorage.getItem(STORAGE_KEY)
  const density = ref<AnnotationDensity>(stored === 'compact' || stored === 'comfortable' ? stored : 'comfortable')

  watch(density, (value) => localStorage.setItem(STORAGE_KEY, value))

  return { density }
}
