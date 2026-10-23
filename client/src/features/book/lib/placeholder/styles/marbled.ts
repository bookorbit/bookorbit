import { fitAuthors, fitBlock, fitHeight, fitLine, metrics, monogram, pick, rng, type TextStyle } from '../typeset'
import { ok, schemeFor, type Palette } from '../palette'
import { rasterWidth } from '../raster'
import { SANS, SERIF, glyph, r2, seriesLine, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SERIF, weight: 620, tracking: -0.005 }
const SUB: TextStyle = { family: SERIF, weight: 400, italic: true }
const AUTHOR: TextStyle = { family: SANS, weight: 650, tracking: 0.12, upper: true }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.14, upper: true }

interface Inks {
  ground: string
  inks: string[]
}

// Hue-led bathes, with classic Turkish paper (red, indigo, ochre, black on cream) for a quarter of them.
const SCHEMES: readonly (number | 'turkish')[] = ['turkish', 250, 20, 160, 'turkish', 300, 200, 45, 340, 'turkish', 120, 270]

function inksFor(pal: Palette): Inks & { h: number } {
  const scheme = schemeFor(pal, SCHEMES)
  if (scheme === 'turkish')
    return {
      h: 60,
      ground: ok(0.92, 0.035, 85),
      inks: [ok(0.44, 0.15, 27), ok(0.34, 0.09, 258), ok(0.74, 0.13, 78), ok(0.22, 0.02, 60), ok(0.92, 0.035, 85)],
    }
  const h = scheme
  return {
    h,
    ground: ok(0.9, 0.035, h + 40),
    inks: [ok(0.4, 0.12, h), ok(0.64, 0.15, h + 24), ok(0.87, 0.06, h + 50), ok(0.26, 0.05, h - 18), ok(0.74, 0.12, h + 165)],
  }
}

function circle(cx: number, cy: number, rad: number, n: number): Float64Array {
  const a = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    a[i * 2] = cx + Math.cos(t) * rad
    a[i * 2 + 1] = cy + Math.sin(t) * rad
  }
  return a
}

function resample(pts: Float64Array, maxLen: number, cap: number): Float64Array {
  const n = pts.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] ?? 0
    const y = pts[i * 2 + 1] ?? 0
    const j = (i + 1) % n
    const nx = pts[j * 2] ?? x
    const ny = pts[j * 2 + 1] ?? y
    out.push(x, y)
    const steps = Math.min(24, Math.floor(Math.hypot(nx - x, ny - y) / maxLen))
    for (let s = 1; s <= steps; s++) out.push(x + ((nx - x) * s) / (steps + 1), y + ((ny - y) * s) / (steps + 1))
    if (out.length / 2 > cap) break
  }
  return Float64Array.from(out)
}

/**
 * Ink marbling after Jaffer and Lu. A drop at c with radius r moves every earlier ink point p to
 * c + (p - c) * sqrt(1 + r^2 / |p - c|^2); a tine stroke then shifts points along the stroke by
 * alpha * lambda / (d + lambda), d being the distance from the stroke. Several inks are dropped
 * on one spot so they spread as rings, which the comb drags into feathers.
 */
function paintMarbling(g: CanvasRenderingContext2D, W: number, H: number, pal: Palette, scale: number) {
  const r = rng(pal.item ^ 0x2545f491)
  const { ground, inks } = inksFor(pal)
  const style = pick(r, ['combed', 'combed', 'wave', 'chevron', 'stone'] as const)
  const drops: { pts: Float64Array; color: string }[] = []
  let ink = 0
  const dropAt = (cx: number, cy: number, rad: number, color: string) => {
    const rr = rad * rad
    for (const d of drops) {
      const a = d.pts
      for (let j = 0; j < a.length; j += 2) {
        const dx = (a[j] ?? 0) - cx
        const dy = (a[j + 1] ?? 0) - cy
        const f = Math.sqrt(1 + rr / (dx * dx + dy * dy + 1e-6))
        a[j] = cx + dx * f
        a[j + 1] = cy + dy * f
      }
    }
    drops.push({ pts: circle(cx, cy, rad, 120), color })
  }
  const centres = style === 'stone' ? 30 : 22
  for (let i = 0; i < centres; i++) {
    const cx = r() * W
    const cy = r() * H
    const rings = 3 + Math.floor(r() * 3)
    let rad = (style === 'stone' ? 24 : 32) + r() * 30
    for (let k = 0; k < rings; k++) {
      dropAt(cx, cy, rad, inks[ink++ % inks.length] ?? ground)
      rad *= 0.74
    }
    for (const d of drops) d.pts = resample(d.pts, 4, 3000)
  }
  const tine = (bx: number, by: number, mx: number, my: number, alpha: number, lambda: number) => {
    for (const d of drops) {
      const a = d.pts
      for (let j = 0; j < a.length; j += 2) {
        const dist = Math.abs(((a[j] ?? 0) - bx) * -my + ((a[j + 1] ?? 0) - by) * mx)
        const s = (alpha * lambda) / (dist + lambda)
        a[j] = (a[j] ?? 0) + mx * s
        a[j + 1] = (a[j + 1] ?? 0) + my * s
      }
    }
  }
  const refine = () => {
    for (const d of drops) d.pts = resample(d.pts, 2.2, 5000)
  }
  if (style !== 'stone') {
    refine()
    const spacing = 24 + r() * 14
    const alpha = 30 + r() * 22
    const lambda = 7 + r() * 6
    for (let y = spacing / 2, i = 0; y < H + spacing; y += spacing, i++) tine(0, y, i % 2 ? 1 : -1, 0, alpha, lambda)
    if (style === 'chevron') {
      refine()
      const spacing2 = 36 + r() * 16
      for (let x = spacing2 / 2, i = 0; x < W + spacing2; x += spacing2, i++) tine(x, 0, 0, i % 2 ? 1 : -1, alpha * 0.8, lambda)
    }
    if (style === 'wave') {
      refine()
      const amplitude = 10 + r() * 10
      const period = 70 + r() * 50
      const phase = r() * 6.28
      for (const d of drops)
        for (let j = 0; j < d.pts.length; j += 2) d.pts[j] = (d.pts[j] ?? 0) + amplitude * Math.sin(((d.pts[j + 1] ?? 0) / period) * 6.283 + phase)
    }
  }
  g.fillStyle = ground
  g.fillRect(0, 0, W * scale, H * scale)
  for (const d of drops) {
    const a = d.pts
    g.beginPath()
    g.moveTo((a[0] ?? 0) * scale, (a[1] ?? 0) * scale)
    for (let j = 2; j < a.length; j += 2) g.lineTo((a[j] ?? 0) * scale, (a[j + 1] ?? 0) * scale)
    g.closePath()
    g.fillStyle = d.color
    g.fill()
  }
}

export function marbled(c: StyleContext): string {
  const { W, H, sq, p, pal, px, tier } = c
  const u = unitsFor(c)
  const paper = ok(0.965, 0.018, 88)
  const scheme = inksFor(pal)
  const ink = ok(0.18, 0.02, scheme.h)
  const rtl = p.script === 'rtl'
  const width = rasterWidth(px)
  const height = Math.round((width * H) / W)
  const image = c.raster({
    key: `marbled|${pal.group}|${pal.item}|${W}x${H}|${width}`,
    width,
    height,
    draw: (g) => paintMarbling(g, W, H, pal, width / W),
  })
  const art = image
    ? `<image href="${image}" width="${W}" height="${H}" preserveAspectRatio="none"/>`
    : `<rect width="${W}" height="${H}" fill="${scheme.ground}"/>`

  if (tier === 'micro') {
    if (p.bare) return svg(c, '', art)
    const fs = W * 0.42
    const cap = metrics(TITLE).cap * fs
    const band = cap * 1.7
    return svg(
      c,
      '',
      art +
        `<rect y="${r2(H / 2 - band / 2)}" width="${W}" height="${r2(band)}" fill="${paper}"/>` +
        glyph(monogram(p), { x: W / 2, y: H / 2 + cap / 2, size: fs, family: SERIF, weight: 620, fill: ink, anchor: 'middle' }),
    )
  }

  const full = tier === 'full'
  const compact = tier === 'compact'
  const x0 = sq ? 36 : 26
  const avail = W - x0 * 2
  const title = fitBlock(
    p.main,
    TITLE,
    { w: avail - 28, h: sq ? 230 : 210 },
    { min: u(compact ? 8.5 : 9.5), max: sq ? 84 : 66, maxLines: 5, leading: 1.36, align: 'start', linePenalty: 0.04 },
  )
  const padX = Math.max(10, title.size * 0.36)
  const padY = title.size * 0.24
  const seriesText = full ? seriesLine(c) : null
  const series = seriesText ? fitLine(seriesText, CAPS, avail - 20, { min: u(6), max: sq ? 16 : 14 }) : null
  const subText = full ? (p.subtitle ?? p.kicker) : null
  const sub = subText
    ? fitBlock(subText, SUB, { w: avail - 24, h: sq ? 56 : 50 }, { min: u(6.8), max: sq ? 23 : 20, maxLines: 2, leading: 1.36, align: 'start' })
    : null
  const author = fitAuthors(p, c.strings.list, AUTHOR, avail - 24, { min: u(6.2), max: sq ? 19 : 17 }, 1)
  const showAuthor = author && 'text' in author && !(compact && author.truncated) ? author : null

  const gap = Math.max(4, title.size * 0.1)
  const block =
    (series ? series.cap + 26 : 0) +
    title.L * (title.cap + 2 * padY) +
    (title.L - 1) * gap +
    (sub ? sub.height + sub.desc + 26 : 0) +
    (showAuthor ? fitHeight(showAuthor) + 28 : 0)
  const lo = Math.max(sq ? 70 : 66, u(31))
  const hi = H - Math.max(70, u(32))
  let y = Math.max(lo, Math.min(hi - block, (sq ? 0.52 : 0.54) * H - block / 2))
  const left = (w: number) => (rtl ? W - x0 - w : x0)
  // paper strips hug each line, so a long title and a short one both look deliberate
  const strip = (w: number, h: number, top: number, fill: string) =>
    `<rect x="${r2(left(w))}" y="${r2(top + u(0.7))}" width="${r2(w)}" height="${r2(h)}" fill="#000" opacity=".28"/><rect x="${r2(left(w))}" y="${r2(top)}" width="${r2(w)}" height="${r2(h)}" fill="${fill}"/>`

  let strips = ''
  if (series) {
    const w = series.width + 20
    strips +=
      strip(w, series.cap + 14, y, ink) +
      text(series, CAPS, { x: rtl ? W - x0 - 10 : x0 + 10, top: y + 7, fill: paper, anchor: rtl ? 'end' : 'start' })
    y += series.cap + 26
  }
  title.lines.forEach((line, i) => {
    const w = (title.widths[i] ?? 0) * title.size + 2 * padX
    strips += strip(w, title.cap + 2 * padY, y, paper)
    strips += text({ ...title, lines: [line], step: 0 }, TITLE, { x: rtl ? W - x0 - padX : left(w) + padX, top: y + padY, fill: ink, rtl })
    y += title.cap + 2 * padY + gap
  })
  y -= gap
  if (sub) {
    y += 10
    const w = sub.width + 24
    strips += strip(w, sub.height + sub.desc + 16, y, paper) + text(sub, SUB, { x: rtl ? W - x0 - 12 : left(w) + 12, top: y + 8, fill: ink, rtl })
    y += sub.height + sub.desc + 16
  }
  if (showAuthor) {
    y += 12
    const w = showAuthor.width + 24
    strips += strip(w, showAuthor.cap + 16, y, ink) + text(showAuthor, AUTHOR, { x: left(w) + 12, top: y + 8, fill: paper })
  }
  return svg(c, '', art + strips)
}
