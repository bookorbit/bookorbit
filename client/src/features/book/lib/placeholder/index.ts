import type { PlaceholderCoverStyle } from '@bookorbit/types'
import { paletteFor } from './palette'
import { requestRaster } from './raster'
import { parseBook, type PlaceholderInput, type PlaceholderStrings } from './typeset'
import type { StyleRenderer, Tier } from './svg'
import { aurora } from './styles/aurora'
import { bauhaus } from './styles/bauhaus'
import { clothbound } from './styles/clothbound'
import { constructivist } from './styles/constructivist'
import { marbled } from './styles/marbled'
import { memphis } from './styles/memphis'
import { paperback } from './styles/paperback'
import { poster } from './styles/poster'
import { vista } from './styles/vista'

export type { PlaceholderInput, PlaceholderStrings } from './typeset'

const STYLES: Record<PlaceholderCoverStyle, StyleRenderer> = {
  bauhaus,
  constructivist,
  memphis,
  clothbound,
  poster,
  aurora,
  vista,
  marbled,
  paperback,
}

let noiseTile: string | null | undefined
let nextId = 0

// One shared grain tile with the light and dark specks baked in as alpha, so it composites with
// plain source-over: per-cover blend modes were the largest paint cost in a grid.
function noise(): string | null {
  if (noiseTile !== undefined) return noiseTile
  noiseTile = null
  if (typeof document === 'undefined') return noiseTile
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 150
  const g = canvas.getContext('2d')
  if (!g) return noiseTile
  const img = g.createImageData(150, 150)
  let s = 1234567
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const d = (96 + ((s >> 8) % 128) - 160) / 64
    const v = d > 0 ? 255 : 0
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = Math.round(Math.min(1, Math.abs(d)) * 150)
  }
  g.putImageData(img, 0, 0)
  noiseTile = canvas.toDataURL('image/png')
  return noiseTile
}

export function placeholderTier(width: number): Tier {
  if (width < 60) return 'micro'
  if (width < 100) return 'compact'
  return 'full'
}

/**
 * SVG markup for a book without cover art. Layout is computed for the size it is drawn at, so text
 * keeps a readable pixel floor at every size, and for the slot's shape rather than the book's.
 * Every piece of book text is escaped before it reaches the markup.
 */
export function renderPlaceholder(
  style: PlaceholderCoverStyle,
  input: PlaceholderInput,
  size: { width: number; height: number },
  strings: PlaceholderStrings,
): string {
  const ratio = size.width / Math.max(1, size.height)
  const sq = ratio >= 0.85
  const H = 600
  const W = sq ? 600 : Math.round(600 * Math.max(0.5, ratio))
  const p = parseBook(input, strings)
  const render = STYLES[style] ?? bauhaus
  return render({
    W,
    H,
    sq,
    px: size.width,
    k: size.width / W,
    dpr: typeof window === 'undefined' ? 1 : Math.min(3, Math.max(1, window.devicePixelRatio || 1)),
    tier: p.bare ? 'micro' : placeholderTier(size.width),
    p,
    pal: paletteFor(input, p),
    uid: `pc${(nextId++).toString(36)}`,
    strings,
    genres: input.genres ?? [],
    noise: noise(),
    raster: requestRaster,
  })
}
