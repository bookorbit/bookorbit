import { applyCase, type Fit, type ParsedBook, type PlaceholderStrings, type TextStyle, xmlEscape } from './typeset'
import type { Palette } from './palette'

export const SANS = "'Inter Variable', 'Hiragino Sans', 'Noto Sans JP', 'Geeza Pro', 'Noto Sans Arabic', system-ui, sans-serif"
export const SERIF = "'Fraunces Variable', Georgia, 'Times New Roman', 'Hiragino Mincho ProN', 'Noto Serif JP', 'Geeza Pro', serif"

export type Tier = 'full' | 'compact' | 'micro'

export interface RasterRequest {
  key: string
  width: number
  height: number
  draw: (g: CanvasRenderingContext2D) => void
}

export interface StyleContext {
  /** Design canvas: 600 high, 400 wide for portrait slots and 600 for square ones. */
  W: number
  H: number
  sq: boolean
  /** Drawn width in CSS pixels, pixels per design unit, and device pixels per CSS pixel. */
  px: number
  k: number
  dpr: number
  tier: Tier
  p: ParsedBook
  pal: Palette
  uid: string
  strings: PlaceholderStrings
  genres: readonly string[]
  noise: string | null
  /** Returns the rendered bitmap once ready, otherwise queues it and returns null. */
  raster: (request: RasterRequest) => string | null
}

export type StyleRenderer = (c: StyleContext) => string

export const r2 = (v: number): number => Math.round(v * 100) / 100
export const attrFamily = (family: string): string => family.replace(/"/g, "'")
/** Converts on-screen pixels to design units, so floors hold at every drawn size. */
export const unitsFor = (c: StyleContext) => (px: number) => px / c.k

interface TextOptions {
  x: number
  top: number
  anchor?: 'start' | 'middle' | 'end'
  fill: string
  rtl?: boolean
  opacity?: number
  /** Stretch each line to this width; used where lines are set to the full measure. */
  justify?: number
}

export function text(fit: Fit | null, st: TextStyle, o: TextOptions): string {
  if (!fit) return ''
  const anchor = o.anchor ?? 'start'
  const lines = 'lines' in fit ? fit.lines : [fit.text]
  const step = 'step' in fit ? fit.step : 0
  const tracking = (st.tracking ?? 0) * fit.size
  // SVG adds tracking after the last glyph too, so anchored text sits half a step off centre
  const x = anchor === 'middle' ? o.x + tracking / 2 : anchor === 'end' ? o.x + tracking : o.x
  const length = o.justify ? ` textLength="${r2(o.justify)}" lengthAdjust="spacingAndGlyphs"` : ''
  const attrs = [
    `font-family="${attrFamily(st.family)}"`,
    `font-weight="${st.weight}"`,
    `font-size="${r2(fit.size)}"`,
    tracking ? `letter-spacing="${r2(tracking)}"` : '',
    st.italic ? 'font-style="italic"' : '',
    `fill="${o.fill}"`,
    `text-anchor="${anchor}"`,
    o.rtl ? 'direction="rtl"' : '',
    o.opacity != null ? `opacity="${o.opacity}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const spans = lines
    .map((line, i) => `<tspan x="${r2(x)}" y="${r2(o.top + fit.cap + i * step)}"${length}>${xmlEscape(applyCase(line, st))}</tspan>`)
    .join('')
  return `<text ${attrs}>${spans}</text>`
}

/** A single glyph or short string at a fixed size, for monograms and numerals. */
export function glyph(
  value: string,
  o: { x: number; y: number; size: number; family: string; weight: number; fill: string; anchor?: 'start' | 'middle' | 'end'; tracking?: number },
): string {
  const tracking = o.tracking ? ` letter-spacing="${r2(o.tracking * o.size)}"` : ''
  return `<text x="${r2(o.x)}" y="${r2(o.y)}" font-family="${attrFamily(o.family)}" font-weight="${o.weight}" font-size="${r2(o.size)}"${tracking} text-anchor="${o.anchor ?? 'start'}" fill="${o.fill}">${xmlEscape(value)}</text>`
}

// Grain is a texture, not a feature: one speck per device pixel, kept faint.
const GRAIN_STRENGTH = 0.55

export function grainPattern(c: StyleContext): string {
  if (!c.noise) return ''
  const t = r2(150 / (c.k * c.dpr))
  return `<pattern id="${c.uid}n" patternUnits="userSpaceOnUse" width="${t}" height="${t}"><image href="${c.noise}" width="${t}" height="${t}" preserveAspectRatio="none"/></pattern>`
}

export function grain(c: StyleContext, opacity: number, area?: { x: number; y: number; w: number; h: number }): string {
  if (!c.noise) return ''
  const box = area ? `x="${r2(area.x)}" y="${r2(area.y)}" width="${r2(area.w)}" height="${r2(area.h)}"` : `width="${c.W}" height="${c.H}"`
  return `<rect ${box} fill="url(#${c.uid}n)" opacity="${r2(opacity * GRAIN_STRENGTH)}"/>`
}

export function svg(c: StyleContext, defs: string, body: string): string {
  return `<svg viewBox="0 0 ${c.W} ${c.H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" focusable="false" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`
}

export function seriesLine(c: StyleContext): string[] | null {
  const { series, volume } = c.p
  if (series) return series.index != null ? [`${series.name} · ${series.index}`, series.name] : [series.name]
  if (volume) return [c.strings.volume(volume)]
  return null
}

export function kickerLine(c: StyleContext, includeKicker: boolean): string[] | null {
  return seriesLine(c) ?? (includeKicker && c.p.kicker ? [c.p.kicker] : null)
}
