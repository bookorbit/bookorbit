import { fitAuthors, fitBlock, fitHeight, fitLine, monogram, type TextStyle } from '../typeset'
import { ok, schemeFor } from '../palette'
import { SANS, glyph, grain, grainPattern, kickerLine, r2, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SANS, weight: 750, tracking: -0.035 }
const SUB: TextStyle = { family: SANS, weight: 500, tracking: -0.01 }
const AUTHOR: TextStyle = { family: SANS, weight: 600 }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.14, upper: true }

// Eight deep bases and four light ones, so roughly two in three covers are dark.
const SCHEMES: readonly [number, boolean][] = [
  [270, true],
  [350, false],
  [230, true],
  [330, true],
  [40, false],
  [200, true],
  [160, true],
  [180, false],
  [20, true],
  [290, true],
  [300, false],
  [250, true],
]

export function aurora(c: StyleContext): string {
  const { W, H, sq, p, pal, tier, uid } = c
  const u = unitsFor(c)
  const r = pal.r
  const [h, dark] = schemeFor(pal, SCHEMES)
  const base = dark ? ok(0.24, 0.055, h) : ok(0.9, 0.045, h)
  const fg = dark ? ok(0.985, 0.012, h) : ok(0.2, 0.05, h)
  const fg2 = dark ? ok(0.86, 0.04, h) : ok(0.36, 0.07, h)
  const spin = r() < 0.5 ? 1 : -1
  const blobs: [number, number, number, number][] = [
    [dark ? 0.6 : 0.8, 0.2, h, 0.55],
    [dark ? 0.52 : 0.76, 0.19, h + spin * 34, 0.5],
    [dark ? 0.44 : 0.7, 0.17, h - spin * 26, 0.46],
    [dark ? 0.78 : 0.9, 0.13, h + spin * 70, 0.24],
  ]
  let shapes = ''
  for (const [l, ch, hh, scale] of blobs) {
    const cx = W * (0.1 + r() * 0.8)
    const cy = H * (0.05 + r() * 0.6)
    const rx = W * scale * (0.8 + r() * 0.5)
    const ry = H * scale * (0.5 + r() * 0.4)
    shapes += `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="${ok(l, ch, hh)}"/>`
  }
  const defs =
    grainPattern(c) +
    `<filter id="${uid}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${r2(W * 0.15)}"/></filter>` +
    `<linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1"><stop offset=".38" stop-color="${base}" stop-opacity="0"/><stop offset="1" stop-color="${base}" stop-opacity="${dark ? 0.82 : 0.7}"/></linearGradient>`
  const art =
    `<rect width="${W}" height="${H}" fill="${base}"/><g filter="url(#${uid}f)">${shapes}</g>` +
    `<rect width="${W}" height="${H}" fill="url(#${uid}s)"/>` +
    grain(c, dark ? 0.32 : 0.4)

  const rtl = p.script === 'rtl'
  const x0 = sq ? 40 : 32
  const tx = rtl ? W - x0 : x0
  const tw = W - x0 * 2

  if (tier === 'micro') {
    const mark = p.bare ? '' : glyph(monogram(p), { x: x0, y: H * 0.9, size: W * 0.5, family: SANS, weight: 750, fill: fg })
    return svg(c, defs, art + mark)
  }

  const full = tier === 'full'
  let body = ''
  let bottom = sq ? 512 : 516
  const author = fitAuthors(p, c.strings.list, AUTHOR, tw, { min: u(6.6), max: sq ? 26 : 22 }, 1)
  if (author && !(tier === 'compact' && author.truncated)) {
    body += text(author, AUTHOR, { x: tx, top: bottom - fitHeight(author), fill: fg2 })
    bottom -= fitHeight(author) + 20
  } else bottom -= 6
  if (full && p.subtitle) {
    const sub = fitBlock(p.subtitle, SUB, { w: tw, h: sq ? 62 : 56 }, { min: u(6.6), max: sq ? 26 : 22, maxLines: 2, leading: 1.16, align: 'start' })
    const top = bottom - sub.height
    body += text(sub, SUB, { x: tx, top, fill: fg, rtl, opacity: 0.92 })
    bottom = top - 14
  }
  const kickerText = tier === 'compact' ? null : kickerLine(c, full)
  const kicker = kickerText ? fitLine(kickerText, CAPS, tw, { min: u(6), max: sq ? 17 : 15 }) : null
  const titleH = Math.min(sq ? 300 : 330, bottom - (kicker ? kicker.cap + 18 : 0) - 78)
  const title = fitBlock(
    p.main,
    TITLE,
    { w: tw, h: titleH },
    { min: u(tier === 'compact' ? 9 : 9.5), max: sq ? 104 : 86, maxLines: 5, leading: 1.0, align: 'start', linePenalty: 0.03 },
  )
  const titleTop = bottom - title.height
  body += text(title, TITLE, { x: tx, top: titleTop, fill: fg, rtl })
  if (kicker) body += text(kicker, CAPS, { x: tx, top: titleTop - 18 - kicker.cap, fill: fg2, rtl })
  return svg(c, defs, art + body)
}
