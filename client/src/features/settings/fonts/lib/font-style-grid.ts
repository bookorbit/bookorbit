import type { FontNamedInstance, FontStyle, UserFont } from '@bookorbit/types'
import { isVariableFont } from '@bookorbit/types'
import { familyVariants } from '@/features/reader/shared/lib/font-variants'

/** The nine standard weights, one grid column each. */
export const GRID_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/**
 * `static`: a file renders exactly this weight. `range`: a variable file offers this weight as one
 * of its styles. `none`: nothing on the server renders it; the browser would fake it.
 */
export type StyleGridCellState = 'none' | 'static' | 'range'

export interface StyleGridCell {
  weight: number
  state: StyleGridCellState
  /** The style the reader offers here, when it offers one. */
  variant: FontNamedInstance | null
}

export interface StyleGridRow {
  style: FontStyle
  cells: StyleGridCell[]
  /** Column spans of variable axes, as indexes into GRID_WEIGHTS. */
  ranges: Array<{ from: number; to: number }>
}

/** Off-grid weights (350, 450) sit in the nearest column, because that is the face they look like. */
function columnOf(weight: number): number {
  return Math.min(GRID_WEIGHTS.length - 1, Math.max(0, Math.round(weight / 100) - 1))
}

/** Upright over italic, each with nine weight cells and the spans of any variable axes. */
export function styleGrid(fonts: readonly UserFont[]): StyleGridRow[] {
  const variants = familyVariants(fonts)

  return (['normal', 'italic'] as const).map((style) => {
    const files = fonts.filter((font) => font.style === style)
    const variable = files.filter(isVariableFont)
    const ranges = variable.map((font) => ({ from: columnOf(font.weightMin!), to: columnOf(font.weightMax!) }))
    const offered = variants.filter((variant) => variant.style === style)

    const cells = GRID_WEIGHTS.map((weight, column): StyleGridCell => {
      const variant = offered.find((candidate) => columnOf(candidate.weight) === column) ?? null
      if (!variant) return { weight, state: 'none', variant: null }
      const fromAxis = variable.some((font) => variant.weight >= font.weightMin! && variant.weight <= font.weightMax!)
      return { weight, state: fromAxis ? 'range' : 'static', variant }
    })

    return { style, cells, ranges }
  })
}

export type StyleSummary = { kind: 'single'; variant: FontNamedInstance } | { kind: 'many'; count: number; italics: boolean } | { kind: 'empty' }

/**
 * What a family gives readers, in the reader's own terms: one named style, or how many styles and
 * whether any of them is italic. A family without italics still gets slanted text, faked by the browser.
 */
export function styleSummary(fonts: readonly UserFont[]): StyleSummary {
  const variants = familyVariants(fonts)
  if (variants.length === 0) return { kind: 'empty' }
  if (variants.length === 1) return { kind: 'single', variant: variants[0]! }
  return { kind: 'many', count: variants.length, italics: variants.some((variant) => variant.style === 'italic') }
}
