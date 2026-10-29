import { ref } from 'vue'

const STORAGE_KEY = 'bookorbit:folder-picker:plan-width'

export const PLAN_WIDTH = { min: 288, default: 384, treeMin: 420, step: 16 } as const

/** The plan's width is a per-browser preference: the divider between the halves drags. */
export function usePickerPlanWidth() {
  const width = ref<number>(read())

  function read(): number {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY))
      return Number.isFinite(stored) && stored >= PLAN_WIDTH.min ? stored : PLAN_WIDTH.default
    } catch {
      return PLAN_WIDTH.default
    }
  }

  function clamp(value: number, gridWidth: number): number {
    return Math.round(Math.max(PLAN_WIDTH.min, Math.min(value, gridWidth - PLAN_WIDTH.treeMin)))
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, String(width.value))
    } catch {
      // Private windows forget it; the default still works.
    }
  }

  return { width, clamp, save }
}
