import { fitAuthors, fitBlock, fitLine, measure, metrics, monogram, pick, type Random, type TextStyle } from '../typeset'
import { ok, schemeFor, weighted, type Palette } from '../palette'
import { SANS, glyph, grain, grainPattern, r2, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SANS, weight: 800, tracking: -0.035 }
const SUB: TextStyle = { family: SANS, weight: 500, tracking: -0.01 }
const AUTHOR: TextStyle = { family: SANS, weight: 650, tracking: -0.005 }
const CAPS: TextStyle = { family: SANS, weight: 600, tracking: 0.12, upper: true }
const NUMERAL: TextStyle = { family: SANS, weight: 900, tracking: -0.06 }

interface Colors {
  bg: string
  fg: string
  fg2: string
  c1: string
  c2: string
  c3: string
}

// Hand-picked three-colour sets: primary, a lighter partner and a deep third.
const SCHEMES: readonly [number, number, number][] = [
  [27, 255, 90],
  [255, 88, 25],
  [90, 250, 20],
  [45, 200, 262],
  [195, 30, 85],
  [150, 350, 262],
  [295, 85, 190],
  [350, 150, 250],
  [265, 50, 160],
  [115, 15, 240],
  [15, 230, 75],
  [175, 330, 90],
]

function colors(pal: Palette): Colors {
  const [h, h2, h3] = schemeFor(pal, SCHEMES)
  const yellowish = h > 70 && h < 115
  const ground = weighted(pal.s, [
    ['paper', 40],
    ['ink', 35],
    ['color', 25],
  ] as const)
  const c1 = ok(yellowish ? 0.8 : 0.62, yellowish ? 0.16 : 0.19, h)
  const c2 = ok(0.8, 0.14, h2)
  const c3 = ok(0.46, 0.14, h3)
  const paper = ok(0.955, 0.014, 85)
  const ink = ok(0.19, 0.014, h)
  if (ground === 'paper') return { bg: paper, fg: ink, fg2: ok(0.43, 0.02, h), c1, c2, c3 }
  if (ground === 'ink') return { bg: ink, fg: paper, fg2: ok(0.76, 0.02, h), c1, c2, c3 }
  return {
    bg: c1,
    fg: yellowish ? ink : paper,
    fg2: yellowish ? ok(0.3, 0.05, h) : ok(0.93, 0.03, h),
    c1: yellowish ? ink : paper,
    c2,
    c3: ink,
  }
}

type Motif = 'numeral' | 'sun' | 'quarters' | 'stripes' | 'arches' | 'blocks' | 'dots' | 'waves'
const MOTIFS: readonly Motif[] = ['sun', 'quarters', 'stripes', 'arches', 'blocks', 'dots', 'waves']

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function motif(kind: Motif, R: Rect, col: Colors, r: Random, c: StyleContext): string {
  const { W } = c
  const w = R.x1 - R.x0
  const hgt = R.y1 - R.y0
  let s = ''
  if (kind === 'numeral') {
    const num = c.p.volume ?? c.p.series?.index ?? '1'
    const size = Math.min((hgt * 1.08) / metrics(NUMERAL).cap, (w * 0.98) / measure(num, NUMERAL))
    const cx = R.x0 + w * (0.18 + r() * 0.12)
    s += `<circle cx="${r2(cx)}" cy="${r2(R.y0 + hgt * 0.42)}" r="${r2(Math.min(hgt, w) * 0.36)}" fill="${col.c2}"/>`
    s += glyph(num, { x: R.x1 + size * 0.04, y: R.y1 + size * 0.04, size, family: SANS, weight: 900, tracking: -0.06, anchor: 'end', fill: col.c1 })
  } else if (kind === 'sun') {
    const rad = Math.min(hgt * 0.95, w * 0.44)
    const cx = R.x0 + w * (0.3 + r() * 0.4)
    s += `<circle cx="${r2(cx)}" cy="${R.y1}" r="${r2(rad)}" fill="${col.c1}"/>`
    for (let i = 0; i < 4; i++)
      s += `<rect x="${R.x0}" y="${r2(R.y1 - rad * (0.12 + i * 0.16))}" width="${w}" height="${4 + i * 3.5}" fill="${col.bg}"/>`
    const mr = rad * 0.2
    s += `<circle cx="${r2(cx > W / 2 ? R.x0 + w * 0.16 : R.x1 - w * 0.16)}" cy="${r2(R.y0 + Math.max(mr + 8, hgt * 0.26))}" r="${r2(mr)}" fill="${col.c2}"/>`
  } else if (kind === 'quarters') {
    const cell = W / (c.sq ? 6 : 4)
    const cols = Math.round(w / cell)
    const rows = Math.ceil(hgt / cell)
    const fills = [col.c1, col.c2, col.c3, col.fg]
    for (let row = 0; row < rows; row++)
      for (let ci = 0; ci < cols; ci++) {
        const x = R.x0 + ci * cell
        const y = R.y1 - (row + 1) * cell
        const roll = r()
        const fill = pick(r, fills)
        if (roll < 0.14) continue
        if (roll < 0.26) {
          s += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(cell)}" height="${r2(cell)}" fill="${fill}"/>`
          continue
        }
        const corner = Math.floor(r() * 4)
        const sx = corner === 1 || corner === 2 ? -1 : 1
        const sy = corner >= 2 ? -1 : 1
        const ax = x + (sx < 0 ? cell : 0)
        const ay = y + (sy < 0 ? cell : 0)
        s += `<path d="M${r2(ax)} ${r2(ay)}h${r2(sx * cell)}a${r2(cell)} ${r2(cell)} 0 0 ${sx * sy > 0 ? 1 : 0} ${r2(-sx * cell)} ${r2(sy * cell)}z" fill="${fill}"/>`
      }
  } else if (kind === 'stripes') {
    const angle = 35 + r() * 20
    const sw = c.sq ? 30 : 24
    const fills = [col.c1, col.c2, col.c3]
    const count = Math.ceil((W * 2.4) / (sw * 1.9))
    let g = ''
    for (let i = 0; i < count; i++)
      g += `<rect x="${r2(-W * 0.7 + i * sw * 1.9)}" y="${r2(R.y0 - W)}" width="${sw}" height="${r2(hgt + W * 2)}" fill="${fills[i % 3]}"/>`
    s += `<g transform="rotate(${r2(angle)} ${r2(R.x0 + w / 2)} ${r2(R.y0 + hgt / 2)})">${g}</g>`
    s += `<circle cx="${r2(R.x0 + w * (0.25 + r() * 0.5))}" cy="${r2(R.y0 + hgt * 0.5)}" r="${r2(Math.min(hgt, w) * 0.22)}" fill="${col.bg}" stroke="${col.fg}" stroke-width="8"/>`
  } else if (kind === 'arches') {
    const cx = R.x0 + w * pick(r, [0.5, 0.3, 0.7])
    const outer = Math.min(hgt * 1.02, w * 0.62)
    const band = outer / 6.2
    const fills = [col.c1, col.bg, col.c2, col.bg, col.c3, col.bg, col.fg]
    fills.forEach((fill, i) => {
      const rr = outer - i * band
      if (rr > 0) s += `<circle cx="${r2(cx)}" cy="${R.y1}" r="${r2(rr)}" fill="${fill}"/>`
    })
  } else if (kind === 'blocks') {
    const vx = R.x0 + w * (0.34 + r() * 0.2)
    const hy = R.y0 + hgt * (0.38 + r() * 0.24)
    const t = c.sq ? 9 : 8
    s += `<rect x="${R.x0}" y="${R.y0}" width="${r2(vx - R.x0)}" height="${r2(hy - R.y0)}" fill="${col.c1}"/>`
    s += `<rect x="${r2(vx)}" y="${r2(hy)}" width="${r2(R.x1 - vx)}" height="${r2(R.y1 - hy)}" fill="${col.c2}"/>`
    s += `<rect x="${R.x0}" y="${r2(hy)}" width="${r2((vx - R.x0) * 0.5)}" height="${r2(R.y1 - hy)}" fill="${col.c3}"/>`
    s += `<rect x="${r2(vx - t / 2)}" y="${R.y0}" width="${t}" height="${hgt}" fill="${col.fg}"/>`
    s += `<rect x="${R.x0}" y="${r2(hy - t / 2)}" width="${w}" height="${t}" fill="${col.fg}"/>`
    s += `<rect x="${R.x0}" y="${R.y0}" width="${w}" height="${t}" fill="${col.fg}"/>`
    s += `<rect x="${r2(R.x0 + (vx - R.x0) * 0.5 - t / 2)}" y="${r2(hy)}" width="${t}" height="${r2(R.y1 - hy)}" fill="${col.fg}"/>`
  } else if (kind === 'dots') {
    const cols = c.sq ? 7 : 5
    const step = w / cols
    const rows = Math.max(1, Math.floor(hgt / step))
    const big = Math.floor(r() * cols * rows)
    let i = 0
    for (let row = 0; row < rows; row++)
      for (let ci = 0; ci < cols; ci++, i++) {
        const x = R.x0 + step * (ci + 0.5)
        const y = R.y1 - step * (row + 0.5)
        if (i === big) s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(step * 0.95)}" fill="${col.c1}"/>`
        else s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(step * (r() < 0.2 ? 0.3 : 0.17))}" fill="${r() < 0.2 ? col.c2 : col.fg}"/>`
      }
  } else {
    const strokes = [col.c1, col.c2, col.c3, col.fg]
    const n = Math.max(2, Math.min(5, Math.floor(hgt / 46)))
    const amp = 14
    const lam = c.sq ? 150 : 120
    for (let i = 0; i < n; i++) {
      const y = R.y0 + ((i + 0.7) * hgt) / (n + 0.2)
      let d = `M${R.x0 - 20} ${r2(y)}`
      for (let x = R.x0 - 20; x <= R.x1 + 20; x += lam / 2) d += ` q${lam / 4} ${i % 2 ? amp * 2 : -amp * 2} ${lam / 2} 0`
      s += `<path d="${d}" fill="none" stroke="${strokes[i % 4]}" stroke-width="${c.sq ? 20 : 17}" stroke-linecap="round"/>`
    }
  }
  return `<clipPath id="${c.uid}m"><rect x="${R.x0}" y="${R.y0}" width="${w}" height="${hgt}"/></clipPath><g clip-path="url(#${c.uid}m)">${s}</g>`
}

export function bauhaus(c: StyleContext): string {
  const { W, H, sq, p, pal, tier } = c
  const u = unitsFor(c)
  const r = pal.r
  const col = colors(pal)
  const rtl = p.script === 'rtl'
  const x0 = sq ? 40 : 30
  const tw = W - x0 * 2
  const tx = rtl ? W - x0 : x0
  const kind: Motif = p.volume || p.series?.index ? 'numeral' : (MOTIFS[pal.item % MOTIFS.length] ?? 'sun')
  const defs = grainPattern(c)
  const texture = grain(c, 0.28)

  if (tier === 'micro') {
    const art = motif(kind === 'numeral' ? 'sun' : kind, { x0: 0, y0: H * 0.45, x1: W, y1: H }, col, r, c)
    const fs = W * 0.5
    const mark = p.bare ? '' : glyph(monogram(p), { x: x0, y: H * 0.08 + metrics(TITLE).cap * fs, size: fs, family: SANS, weight: 800, fill: col.fg })
    return svg(c, defs, `<rect width="${W}" height="${H}" fill="${col.bg}"/>${art}${texture}${mark}`)
  }

  const full = tier === 'full'
  // status and series badges sit 6px in and 20px tall at every cover size
  let y = Math.max(sq ? 76 : 70, u(31))
  const title = fitBlock(
    p.main,
    TITLE,
    { w: tw, h: sq ? 214 : 196 },
    { min: u(tier === 'compact' ? 9 : 9.5), max: sq ? 104 : 94, maxLines: 4, leading: 0.98, align: 'start', linePenalty: 0.03 },
  )
  let body = text(title, TITLE, { x: tx, top: y, fill: col.fg, rtl })
  y += title.height + title.desc * 0.25
  const subText = full ? (p.subtitle ?? p.kicker) : null
  if (subText) {
    const sub = fitBlock(subText, SUB, { w: tw, h: sq ? 60 : 54 }, { min: u(6.6), max: sq ? 26 : 22, maxLines: 2, leading: 1.16, align: 'start' })
    y += 16
    body += text(sub, SUB, { x: tx, top: y, fill: col.fg2, rtl })
    y += sub.height + sub.desc * 0.4
  }
  const author = fitAuthors(p, c.strings.list, AUTHOR, tw, { min: u(6.6), max: sq ? 26 : 22 }, 1)
  if (author && 'text' in author && !(tier === 'compact' && author.truncated)) {
    y += 18
    body += text(author, AUTHOR, { x: tx, top: y, fill: col.fg, rtl })
    y += author.cap
  }
  if (full && p.series) {
    const series = fitLine([p.series.name], CAPS, tw, { min: u(6), max: sq ? 16 : 14 })
    if (series) {
      y += 14
      body += text(series, CAPS, { x: tx, top: y, fill: col.fg2 })
      y += series.cap
    }
  }
  let motifTop = Math.max(y + 30, H * (sq ? 0.5 : 0.48))
  if (motifTop > H - 110) motifTop = Math.min(y + 22, H - 70)
  const art = motif(kind, { x0: 0, y0: motifTop, x1: W, y1: H }, col, r, c)
  return svg(c, defs, `<rect width="${W}" height="${H}" fill="${col.bg}"/>${art}${texture}${body}`)
}
