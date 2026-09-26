import { isReadAlongFormatKey } from '@bookorbit/types'

const DEFAULT_FORMAT_COLOR = '#6b7280'

/**
 * Every format BookOrbit imports, plus `txt` and the read-along EPUB. Each one also has a
 * `--pill-format-*` token. Keys are formats, or `epub:readalong` via `paletteKey`.
 */
const FORMAT_COLORS: Record<string, string> = {
  epub: '#16a34a',
  readalong: '#0f766e',
  kepub: '#0d9488',
  mobi: '#6366f1',
  azw3: '#14b8a6',
  azw: '#0ea5e9',
  fb2: '#ec4899',
  djvu: '#64748b',
  txt: '#78716c',
  pdf: '#dc2626',
  cbz: '#3b82f6',
  cbr: '#f97316',
  cb7: '#8b5cf6',
  cbx: '#c026d3',
  m4b: '#f59e0b',
  m4a: '#eab308',
  mp3: '#22c55e',
  opus: '#06b6d4',
  ogg: '#84cc16',
  flac: '#10b981',
}

function paletteKey(formatOrKey: string): string {
  return isReadAlongFormatKey(formatOrKey) ? 'readalong' : formatOrKey.toLowerCase()
}

/**
 * A fixed hex per format, for the places a CSS variable cannot reach: a chart draws to a canvas,
 * where `var(--x)` is not a colour. It is also fine as a solid fill under white text. Everything
 * that paints text in a format colour uses `formatColorVar`.
 */
export function getFormatColor(format: string | null | undefined): string {
  if (!format) return DEFAULT_FORMAT_COLOR
  return FORMAT_COLORS[paletteKey(format)] ?? DEFAULT_FORMAT_COLOR
}

/**
 * The same palette as a per-theme token.
 *
 * One hex for both themes cannot be a text colour: `#eab308` is about 1.9:1 on white, and the
 * darker end of the palette is as bad against a dark surface. The tokens in `theme/tokens.css`
 * are tuned per theme the way every other text colour is, so this is what a format chip, badge or
 * label paints with. Alpha variants belong in `color-mix`, never composited onto the text itself.
 */
export function formatColorVar(format: string | null | undefined): string {
  const key = format ? paletteKey(format) : null
  return key && key in FORMAT_COLORS ? `var(--pill-format-${key})` : 'var(--pill-format-default)'
}

export type FormatChipVariant = 'soft' | 'solid'

/**
 * How every format chip is painted. `soft` carries the colour in its text over a faint tint;
 * `solid` is only the fill, for a chip whose text is white (over a cover, in a dense table).
 */
export function formatChipStyle(format: string | null | undefined, variant: FormatChipVariant = 'soft'): Record<string, string> {
  if (variant === 'solid') {
    const fill = getFormatColor(format)
    return { borderColor: fill, backgroundColor: fill }
  }
  const color = formatColorVar(format)
  return {
    color,
    borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
  }
}
