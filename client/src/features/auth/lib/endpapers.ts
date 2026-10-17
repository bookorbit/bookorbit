// Endpapers for the sign-in pages: traditional bookbinding repeats, drawn as one-colour
// SVG tiles. The tile is a mask over --endpaper-ink, so every pattern follows the accent and the theme.

export const ENDPAPER_IDS = ['seigaiha', 'shippo', 'asanoha', 'quatrefoil', 'ogee', 'harlequin', 'greek-key', 'plain'] as const
export type Endpaper = (typeof ENDPAPER_IDS)[number]

export const DEFAULT_ENDPAPER: Endpaper = 'seigaiha'

export interface EndpaperTile {
  /** Data URI of a black-on-transparent SVG tile; opacity inside it sets the tone. */
  mask: string
  width: number
  height: number
}

const svg = (width: number, height: number, body: string): EndpaperTile => ({
  mask: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}")`,
  width,
  height,
})

const LINE = 'fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="square"'
const DOT = 'fill="#000" fill-opacity=".6"'
const R = 28.284
const CELL_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [48, 0],
  [0, 48],
  [48, 48],
]

/** Seigaiha is drawn with CSS gradients instead: its fans overlap, which a mask cannot express. Plain has no tile. */
export const ENDPAPER_TILES: Partial<Record<Endpaper, EndpaperTile>> = {
  // Shippō: circles through their neighbours' centres, a dot where four meet.
  shippo: svg(
    40,
    40,
    `<g ${LINE}>${[
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
      [20, 20],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${R}"/>`)
      .join(
        '',
      )}</g><g ${DOT}><circle cx="20" cy="0" r="2"/><circle cx="0" cy="20" r="2"/><circle cx="40" cy="20" r="2"/><circle cx="20" cy="40" r="2"/></g>`,
  ),
  // Asanoha: a triangular grid with every corner joined to its triangle's centre, the hemp-leaf star.
  asanoha: svg(
    28,
    48.5,
    `<path ${LINE.replace('1.4', '1.1')} d="M0 0L14 -24.25M-14 -24.25L0 0M0 -16.17L0 0M-28 0L0 0M-14 -8.08L0 0M28 0L42 -24.25M14 -24.25L28 0M28 -16.17L28 0M0 0L28 0M14 -8.08L28 0M0 0L14 -8.08M28 0L56 0M28 0L42 -8.08M-14 24.25L0 0M-14 8.08L0 0M0 0L14 8.08M14 24.25L28 0M14 8.08L28 0M0 0L14 24.25M14 24.25L14 8.08M0 0L0 16.17M-14 24.25L14 24.25M0 16.17L14 24.25M-14 24.25L0 16.17M28 0L42 8.08M28 0L42 24.25M28 0L28 16.17M14 24.25L42 24.25M28 16.17L42 24.25M14 24.25L28 16.17M-14 24.25L0 32.33M0 48.5L14 24.25M0 32.33L14 24.25M-14 24.25L0 48.5M0 32.33L0 48.5M-28 48.5L0 48.5M-14 40.41L0 48.5M14 24.25L28 32.33M28 48.5L42 24.25M28 32.33L42 24.25M14 24.25L28 48.5M28 32.33L28 48.5M14 24.25L14 40.41M0 48.5L28 48.5M14 40.41L28 48.5M0 48.5L14 40.41M28 48.5L56 48.5M28 48.5L42 40.41M-14 72.75L0 48.5M-14 56.58L0 48.5M0 48.5L14 56.58M14 72.75L28 48.5M14 56.58L28 48.5M0 48.5L14 72.75M0 48.5L0 64.66M28 48.5L42 56.58M28 48.5L42 72.75M28 48.5L28 64.66"/>`,
  ),
  // Gothic tracery: a quatrefoil per cell with a diamond where four cells meet.
  quatrefoil: svg(
    48,
    48,
    `<path ${LINE} d="M32 32A8 8 0 0 0 32 16A8 8 0 0 0 16 16A8 8 0 0 0 16 32A8 8 0 0 0 32 32Z"/><circle cx="24" cy="24" r="2.5" ${DOT}/><g ${DOT}>${CELL_CORNERS.map(([x, y]) => `<path d="M${x} ${y - 5}L${x + 5} ${y}L${x} ${y + 5}L${x - 5} ${y}Z"/>`).join('')}</g>`,
  ),
  // Ogee: mirrored S-curves that close into onion-domed cells, the damask lattice.
  ogee: svg(
    40,
    56,
    `<g ${LINE}><path d="M0 0C0 14 20 14 20 28C20 42 40 42 40 56"/><path d="M40 0C40 14 20 14 20 28C20 42 0 42 0 56"/></g><g ${DOT}><circle cx="0" cy="28" r="2"/><circle cx="40" cy="28" r="2"/><circle cx="20" cy="0" r="2"/><circle cx="20" cy="56" r="2"/></g>`,
  ),
  // Harlequin: alternating diamonds, the old playing-card and marbled-board ground.
  harlequin: svg(32, 48, `<path d="M16 0L32 24L16 48L0 24Z" fill="#000" fill-opacity=".42" stroke="#000" stroke-width="1"/>`),
  // Greek key: a running fret, one spiral per cell hung from a continuous rail.
  'greek-key': svg(40, 40, `<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="square" d="M0 36H40M4 36V4H36V28H12V12H28V20H20"/>`),
}

export function endpaperLabelKey(id: Endpaper): string {
  return `auth.endpaper.options.${id === 'greek-key' ? 'greekKey' : id}`
}
