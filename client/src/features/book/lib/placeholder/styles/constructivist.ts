import { fitAuthors, fitBlock, fitHeight, fitLine, measure, metrics, monogram, type TextStyle } from '../typeset'
import { ok, schemeFor, type Palette } from '../palette'
import { SANS, glyph, grain, grainPattern, kickerLine, r2, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SANS, weight: 900, tracking: -0.015, upper: true }
const AUTHOR: TextStyle = { family: SANS, weight: 800, tracking: 0.04, upper: true }
const SUB: TextStyle = { family: SANS, weight: 500, tracking: 0 }
const SMALL: TextStyle = { family: SANS, weight: 700, tracking: 0.12, upper: true }
const NUMERAL: TextStyle = { family: SANS, weight: 900, tracking: -0.04 }

// Red carries the movement, so it appears three times; the rest keep a shelf from reading as one colour.
const ACCENTS: readonly number[] = [27, 255, 27, 45, 195, 150, 27, 295, 340, 80, 15, 265]

function colors(pal: Palette) {
  const h = schemeFor(pal, ACCENTS)
  const light = h > 70 && h < 115
  const paper = ok(0.93, 0.03, 85)
  const ink = ok(0.17, 0.012, h)
  return {
    paper,
    ink,
    accent: ok(light ? 0.8 : 0.56, light ? 0.16 : 0.2, h),
    onAccent: light ? ink : paper,
    accentText: light ? ink : ok(0.5, 0.19, h),
  }
}

/**
 * Russian avant-garde: a dominant circle, a heavy bar cutting across it, and the title knocked out
 * of a black band on a rising diagonal. The band's height and slope are solved together so a long
 * title thickens the band instead of running off the cover.
 */
export function constructivist(c: StyleContext): string {
  const { W, H, sq, p, pal, tier } = c
  const u = unitsFor(c)
  const r = pal.r
  const col = colors(pal)
  const angle = -(12 + r() * 8)
  const rad = (-angle * Math.PI) / 180
  const tan = Math.tan(rad)
  const cos = Math.cos(rad)
  const left = r() < 0.5
  const circleR = W * (sq ? 0.3 : 0.36)
  const circle = { x: left ? W * 0.27 : W * 0.73, y: H * (sq ? 0.22 : 0.17) }
  const cx = W / 2
  const defs = grainPattern(c)
  const texture = grain(c, 0.32)
  const ground = `<rect width="${W}" height="${H}" fill="${col.paper}"/>`
  const disc = `<circle cx="${r2(circle.x)}" cy="${r2(circle.y)}" r="${r2(circleR)}" fill="${col.accent}"/>`
  const bar = (fromY: number, toY: number) => {
    const sx = left ? W * 0.72 : W * 0.28
    const ex = left ? W * 0.44 : W * 0.56
    return `<line x1="${r2(sx)}" y1="${r2(fromY)}" x2="${r2(ex)}" y2="${r2(toY)}" stroke="${col.ink}" stroke-width="${r2(W * 0.085)}"/>`
  }
  const band = (cy: number, hb: number, inner: string) =>
    `<g transform="rotate(${r2(angle)} ${r2(cx)} ${r2(cy)})">` +
    `<rect x="${-W}" y="${r2(cy - hb / 2 - 13)}" width="${W * 3}" height="2.5" fill="${col.ink}"/>` +
    `<rect x="${-W}" y="${r2(cy - hb / 2)}" width="${W * 3}" height="${r2(hb)}" fill="${col.ink}"/>` +
    `<rect x="${-W}" y="${r2(cy + hb / 2 + 10)}" width="${W * 3}" height="2.5" fill="${col.ink}"/>` +
    inner +
    `</g>`

  if (tier === 'micro') {
    const cy = H * 0.56
    const hb = H * 0.2
    const fs = hb * 0.95
    const mark = p.bare
      ? ''
      : glyph(monogram(p), { x: cx, y: cy + (metrics(TITLE).cap * fs) / 2, size: fs, family: SANS, weight: 900, fill: col.paper, anchor: 'middle' })
    return svg(c, defs, ground + disc + bar(-20, cy) + texture + band(cy, hb, mark))
  }

  const full = tier === 'full'
  const x0 = sq ? 40 : 30
  const stackW = (W - 2 * x0) * 0.8
  let y = H - Math.max(70, u(30))
  let stack = ''
  const author = fitAuthors(p, c.strings.list, AUTHOR, stackW, { min: u(6.6), max: sq ? 24 : 21 }, full ? 2 : 1)
  if (author && !(tier === 'compact' && author.truncated)) {
    y -= fitHeight(author)
    stack += text(author, AUTHOR, { x: x0, top: y, fill: col.ink })
    y -= 12
  }
  const subText = full ? (p.subtitle ?? null) : null
  if (subText) {
    const sub = fitBlock(subText, SUB, { w: stackW, h: sq ? 52 : 46 }, { min: u(6.4), max: sq ? 20 : 17, maxLines: 2, leading: 1.2, align: 'start' })
    y -= sub.height + sub.desc * 0.3
    stack += text(sub, SUB, { x: x0, top: y, fill: col.ink, rtl: p.script === 'rtl' })
    y -= 12
  }
  const kicker = full ? kickerLine(c, true) : null
  if (kicker) {
    const fit = fitLine(kicker, SMALL, stackW, { min: u(6), max: sq ? 16 : 14 })
    if (fit) {
      y -= fit.cap
      stack += text(fit, SMALL, { x: x0, top: y, fill: col.accentText })
      y -= 10
    }
  }
  const square = `<rect x="${r2(W - x0 - 26)}" y="${r2(H - Math.max(70, u(30)) - 26)}" width="26" height="26" fill="${col.accent}"/>`

  // the band's full vertical extent is its own height plus the rise across the cover
  const top = u(34)
  const reach = (W / 2) * tan
  const room = y - 22 - top
  const bandMax = Math.max(48, (room - 2 * reach) * cos)
  const padY = sq ? 20 : 16
  const textW = (W - 2 * x0) / cos - bandMax * tan
  const title = fitBlock(
    p.main,
    TITLE,
    { w: textW, h: bandMax - 2 * padY },
    { min: u(tier === 'compact' ? 9 : 9.5), max: sq ? 92 : 78, maxLines: 4, leading: 0.98, align: 'start', linePenalty: 0.03 },
  )
  const hb = title.height + title.desc * 0.2 + 2 * padY
  const extent = hb / 2 / cos + reach
  const cy = Math.min(y - 22 - extent, Math.max(top + extent, H * (sq ? 0.42 : 0.4)))
  const rtl = p.script === 'rtl'
  const words = text(title, TITLE, { x: rtl ? cx + textW / 2 : cx - textW / 2, top: cy - hb / 2 + padY, fill: col.paper, rtl })

  const number = p.volume ?? p.series?.index ?? null
  let numeral = ''
  if (number) {
    // sits in the upper half of the disc, clear of the band that crosses its lower edge
    const size = Math.min((circleR * 0.72) / metrics(NUMERAL).cap, (circleR * 1.2) / Math.max(0.3, measure(number, NUMERAL)))
    const baseline = circle.y - circleR * 0.1 + (metrics(NUMERAL).cap * size) / 2
    numeral = glyph(number, { x: circle.x, y: baseline, size, family: SANS, weight: 900, tracking: -0.04, fill: col.onAccent, anchor: 'middle' })
  }
  return svg(c, defs, ground + disc + numeral + bar(-20, cy + hb / 2 / cos + 30) + texture + band(cy, hb, words) + square + stack)
}
