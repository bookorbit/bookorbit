export type PosterShape = 'square' | 'story' | 'wide'
export type PosterLook = 'dark' | 'light'

export const POSTER_SIZES: Record<PosterShape, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1600, height: 900 },
}

export interface PosterTile {
  image: HTMLImageElement | null
  title: string
  /** Completed reads of this book in the period; drawn as ×N when above one. */
  count: number
  rating: number | null
}

export interface PosterContent {
  eyebrow: string
  big: string
  stats: { value: string; label: string }[]
  tiles: PosterTile[]
  facts: { label: string; value: string; meta: string }[]
  moreLabel: (count: number) => string
  /** The app's own lockup, split so the second word takes the accent, as in the sidebar. */
  brand: [string, string]
}

export interface PosterStyle {
  look: PosterLook
  /** The reader's accent and the ink drawn on it, as canvas colours. */
  accent: string
  accentInk: string
  sans: string
  serif: string
  showTitles: boolean
  showRereads: boolean
  showRatings: boolean
}

/** Lucide's Orbit, the glyph in the sidebar's brand tile, on its 24-unit grid. */
function orbitGlyph(): Path2D[] {
  return [
    new Path2D('M20.341 6.484A10 10 0 0 1 10.266 21.85'),
    new Path2D('M3.659 17.516A10 10 0 0 1 13.74 2.152'),
    circlePath(12, 12, 3),
    circlePath(19, 5, 2),
    circlePath(5, 19, 2),
  ]
}

function circlePath(x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  path.arc(x, y, r, 0, Math.PI * 2)
  return path
}

/** The accent at a given opacity. Accepts the hex and rgb()/rgba() forms `toLegacyColor` returns. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const rgb = /rgba?\(([^)]+)\)/
    .exec(color)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)
  if (rgb && rgb.length >= 3) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
  return color
}

function palette(style: PosterStyle) {
  return style.look === 'dark'
    ? {
        base: '#101417',
        ink: '#f2f5f6',
        muted: 'rgba(242, 245, 246, 0.72)',
        rule: 'rgba(242, 245, 246, 0.18)',
        blank: 'rgba(255, 255, 255, 0.08)',
        glow: withAlpha(style.accent, 0.34),
      }
    : {
        base: '#f8f8f5',
        ink: '#13181b',
        muted: 'rgba(19, 24, 27, 0.68)',
        rule: 'rgba(19, 24, 27, 0.16)',
        blank: 'rgba(19, 24, 27, 0.07)',
        glow: withAlpha(style.accent, 0.16),
      }
}

function font(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${text.slice(0, low).trimEnd()}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Largest 2:3 tiles that show every cover, else a floor below which the rest fold into "+N". */
export function fitTiles(count: number, width: number, height: number, gap: number): { columns: number; tile: number; shown: number } {
  let best = { columns: 1, tile: 0 }
  for (let rows = 1; rows <= Math.max(1, count); rows++) {
    const columns = Math.ceil(count / rows)
    const tile = Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows / 1.5)
    if (tile > best.tile) best = { columns, tile }
  }
  if (best.tile >= 40 || count === 0) return { ...best, tile: Math.floor(best.tile), shown: count }
  const tile = 40
  const columns = Math.floor((width + gap) / (tile + gap))
  const rows = Math.floor((height + gap) / (tile * 1.5 + gap))
  return { columns, tile, shown: Math.max(0, columns * rows - 1) }
}

function drawBrand(
  ctx: CanvasRenderingContext2D,
  style: PosterStyle,
  ink: string,
  brand: [string, string],
  right: number,
  centerY: number,
  scale: number,
) {
  const tile = 46 * scale
  ctx.font = font(600, 32 * scale, style.serif)
  const first = brand[0]
  const second = ` ${brand[1]}`
  const textWidth = ctx.measureText(first).width + ctx.measureText(second).width
  const gap = 14 * scale
  const left = right - textWidth - gap - tile
  roundRect(ctx, left, centerY - tile / 2, tile, tile, 11 * scale)
  ctx.fillStyle = style.accent
  ctx.fill()
  ctx.save()
  const glyph = tile * 0.6
  ctx.translate(left + (tile - glyph) / 2, centerY - glyph / 2)
  ctx.scale(glyph / 24, glyph / 24)
  ctx.strokeStyle = style.accentInk
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const path of orbitGlyph()) ctx.stroke(path)
  ctx.restore()
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink
  ctx.fillText(first, left + tile + gap, centerY + 2 * scale)
  ctx.fillStyle = style.accent
  ctx.fillText(second, left + tile + gap + ctx.measureText(first).width, centerY + 2 * scale)
  ctx.textBaseline = 'alphabetic'
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: PosterTile,
  x: number,
  y: number,
  w: number,
  style: PosterStyle,
  colors: ReturnType<typeof palette>,
) {
  const h = w * 1.5
  const radius = Math.max(4, w * 0.06)
  ctx.save()
  if (style.look === 'dark') {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 6
  }
  roundRect(ctx, x, y, w, h, radius)
  ctx.fillStyle = colors.blank
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  if (tile.image && tile.image.naturalWidth > 0) {
    const ratio = tile.image.naturalWidth / tile.image.naturalHeight
    const sw = ratio > 2 / 3 ? tile.image.naturalHeight * (2 / 3) : tile.image.naturalWidth
    const sh = ratio > 2 / 3 ? tile.image.naturalHeight : tile.image.naturalWidth * 1.5
    ctx.drawImage(tile.image, (tile.image.naturalWidth - sw) / 2, (tile.image.naturalHeight - sh) / 2, sw, sh, x, y, w, h)
  } else {
    ctx.fillStyle = colors.muted
    ctx.font = font(700, Math.max(11, w * 0.13), style.sans)
    ctx.textAlign = 'center'
    ctx.fillText(fitText(ctx, tile.title, w - 10), x + w / 2, y + h / 2)
    ctx.textAlign = 'start'
  }
  if (style.showTitles && tile.image) {
    const band = Math.min(h * 0.42, 64)
    const gradient = ctx.createLinearGradient(0, y + h - band, 0, y + h)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.82)')
    ctx.fillStyle = gradient
    ctx.fillRect(x, y + h - band, w, band)
    ctx.fillStyle = '#ffffff'
    ctx.font = font(600, Math.max(10, Math.min(16, w * 0.12)), style.sans)
    ctx.fillText(fitText(ctx, tile.title, w - 12), x + 6, y + h - 8)
  }
  ctx.restore()

  const badge = Math.max(14, Math.min(24, w * 0.2))
  if (style.showRereads && tile.count > 1) {
    const label = `×${tile.count}`
    ctx.font = font(800, badge * 0.82, style.sans)
    const bw = ctx.measureText(label).width + badge * 0.7
    const bx = x + w - bw - 5
    const by = y + h - badge - 5 - (style.showTitles && tile.image ? Math.min(h * 0.42, 64) - 6 : 0)
    roundRect(ctx, bx, by, bw, badge, badge / 2)
    ctx.fillStyle = style.accent
    ctx.fill()
    ctx.fillStyle = style.accentInk
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + badge * 0.35, by + badge / 2 + 1)
    ctx.textBaseline = 'alphabetic'
  }
  if (style.showRatings && tile.rating) {
    const label = '★'.repeat(tile.rating)
    ctx.font = font(700, badge * 0.7, style.sans)
    const bw = ctx.measureText(label).width + badge * 0.6
    roundRect(ctx, x + 5, y + 5, bw, badge, badge / 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.66)'
    ctx.fill()
    ctx.fillStyle = '#ffd36b'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 5 + badge * 0.3, y + 5 + badge / 2 + 1)
    ctx.textBaseline = 'alphabetic'
  }
}

/** Draws the whole share image at its real size. Covers must already be decoded. */
export function drawPoster(canvas: HTMLCanvasElement, shape: PosterShape, content: PosterContent, style: PosterStyle) {
  const { width: W, height: H } = POSTER_SIZES[shape]
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const colors = palette(style)
  const wide = shape === 'wide'
  const story = shape === 'story'
  const pad = wide ? 64 : 72

  ctx.fillStyle = colors.base
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * (style.look === 'dark' ? 1.05 : 0.8))
  glow.addColorStop(0, colors.glow)
  glow.addColorStop(1, withAlpha(style.accent, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Header: whose, which period, the four numbers, and the app's sign-off top right.
  const eyebrowY = pad + 30
  ctx.fillStyle = colors.muted
  ctx.font = font(700, 30, style.sans)
  ctx.letterSpacing = '4.8px'
  ctx.fillText(fitText(ctx, content.eyebrow.toUpperCase(), W - pad * 2 - 300), pad, eyebrowY)
  ctx.letterSpacing = '0px'
  drawBrand(ctx, style, colors.ink, content.brand, W - pad, eyebrowY - 11, 1)

  const bigSize = wide ? 150 : story ? 260 : 200
  const bigY = eyebrowY + 18 + bigSize * 0.86
  ctx.fillStyle = colors.ink
  ctx.font = font(800, bigSize, style.sans)
  ctx.letterSpacing = `${-bigSize * 0.04}px`
  ctx.fillText(content.big, pad - bigSize * 0.03, bigY)
  const bigWidth = ctx.measureText(content.big).width
  ctx.letterSpacing = '0px'

  const statSize = story ? 72 : 64
  let statX = wide ? pad + bigWidth + 64 : pad
  const statY = wide ? bigY - 30 : bigY + 28 + statSize
  for (const stat of content.stats) {
    ctx.fillStyle = colors.ink
    ctx.font = font(800, statSize, style.sans)
    ctx.fillText(stat.value, statX, statY)
    const valueWidth = ctx.measureText(stat.value).width
    ctx.fillStyle = colors.muted
    ctx.font = font(600, 24, style.sans)
    ctx.fillText(stat.label, statX, statY + 32)
    statX += Math.max(valueWidth, ctx.measureText(stat.label).width) + 44
  }

  // Footer facts, bottom up: three columns, or three rows on a story.
  const factBlock = story ? content.facts.length * 112 : 128
  const footerTop = H - pad - factBlock
  if (content.facts.length) {
    ctx.fillStyle = colors.rule
    ctx.fillRect(pad, footerTop, W - pad * 2, 2)
    const columns = story ? 1 : content.facts.length
    const columnWidth = (W - pad * 2 - 36 * (columns - 1)) / columns
    content.facts.forEach((fact, index) => {
      const x = story ? pad : pad + index * (columnWidth + 36)
      const y = story ? footerTop + 46 + index * 112 : footerTop + 50
      ctx.fillStyle = colors.muted
      ctx.font = font(700, story ? 22 : 18, style.sans)
      ctx.letterSpacing = '2.6px'
      ctx.fillText(fitText(ctx, fact.label.toUpperCase(), columnWidth), x, y)
      ctx.letterSpacing = '0px'
      ctx.fillStyle = colors.ink
      ctx.font = font(700, story ? 32 : 24, style.sans)
      ctx.fillText(fitText(ctx, fact.value, columnWidth), x, y + (story ? 40 : 34))
      ctx.fillStyle = colors.muted
      ctx.font = font(500, story ? 26 : 20, style.sans)
      ctx.fillText(fitText(ctx, fact.meta, columnWidth), x, y + (story ? 74 : 62))
    })
  }

  // Covers fill what is left between the header and the footer.
  const gridTop = (wide ? bigY : statY + 32) + 40
  const gridBottom = (content.facts.length ? footerTop : H - pad) - 32
  const gap = 12
  const fit = fitTiles(content.tiles.length, W - pad * 2, gridBottom - gridTop, gap)
  const shown = content.tiles.slice(0, fit.shown)
  const rows = Math.ceil((shown.length + (content.tiles.length > fit.shown ? 1 : 0)) / Math.max(1, fit.columns))
  const gridHeight = rows * fit.tile * 1.5 + Math.max(0, rows - 1) * gap
  const top = gridTop + Math.max(0, (gridBottom - gridTop - gridHeight) / 2)
  shown.forEach((tile, index) => {
    const column = index % fit.columns
    const row = Math.floor(index / fit.columns)
    drawTile(ctx, tile, pad + column * (fit.tile + gap), top + row * (fit.tile * 1.5 + gap), fit.tile, style, colors)
  })
  const rest = content.tiles.length - shown.length
  if (rest > 0) {
    const index = shown.length
    const x = pad + (index % fit.columns) * (fit.tile + gap)
    const y = top + Math.floor(index / fit.columns) * (fit.tile * 1.5 + gap)
    ctx.save()
    ctx.setLineDash([6, 5])
    ctx.strokeStyle = colors.muted
    ctx.lineWidth = 2
    roundRect(ctx, x + 1, y + 1, fit.tile - 2, fit.tile * 1.5 - 2, 6)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = colors.muted
    ctx.font = font(700, Math.max(14, fit.tile * 0.24), style.sans)
    ctx.textAlign = 'center'
    ctx.fillText(content.moreLabel(rest), x + fit.tile / 2, y + fit.tile * 0.82)
    ctx.textAlign = 'start'
  }
}
