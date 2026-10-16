import { fitAuthors, fitBlock, fitHeight, fitLine, metrics, monogram, type Fit, type TextStyle } from '../typeset'
import { ok, schemeFor, type Palette } from '../palette'
import { SANS, SERIF, glyph, grain, grainPattern, r2, seriesLine, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SERIF, weight: 600 }
const SUB: TextStyle = { family: SERIF, weight: 400, italic: true }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.16, upper: true }
const AUTHOR: TextStyle = { family: SANS, weight: 600, tracking: 0.13, upper: true }

// Book cloth as binders stocked it: oxblood, bottle green, navy, ochre, slate, plum, teal,
// buckram, charcoal, rust, dusk blue and forest.
const CLOTHS: readonly [number, number, number][] = [
  [0.32, 0.11, 25],
  [0.33, 0.08, 155],
  [0.29, 0.08, 258],
  [0.6, 0.12, 72],
  [0.37, 0.03, 250],
  [0.31, 0.08, 330],
  [0.4, 0.07, 200],
  [0.54, 0.07, 62],
  [0.27, 0.015, 60],
  [0.46, 0.12, 40],
  [0.44, 0.08, 240],
  [0.34, 0.07, 170],
]

function cloth(pal: Palette) {
  const [L, C, h] = schemeFor(pal, CLOTHS)
  return { L, C, h }
}

export function clothbound(c: StyleContext): string {
  const { W, H, sq, p, pal, tier, uid } = c
  const u = unitsFor(c)
  const { L, C, h } = cloth(pal)
  const gilt = L < 0.5
  const clothDeep = ok(L - 0.075, C * 1.05, h)
  const ink = ok(Math.min(0.3, L - 0.06), Math.min(0.15, C * 1.25), h)
  const paper = ok(0.953, 0.02, 86)
  const rule = ok(Math.min(0.45, L), C, h)
  const foil = gilt ? `url(#${uid}g)` : ok(0.2, Math.min(0.06, C), h)
  const hinge = sq ? 26 : 22
  const fx0 = hinge + 16
  const fy0 = 24
  const fx1 = W - 24
  const fy1 = H - 24
  const cx = (fx0 + fx1) / 2
  const rtl = p.script === 'rtl'

  const defs =
    grainPattern(c) +
    `<linearGradient id="${uid}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></linearGradient>` +
    `<linearGradient id="${uid}s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${uid}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(0.9 0.075 92)"/><stop offset=".45" stop-color="oklch(0.74 0.11 78)"/><stop offset=".7" stop-color="oklch(0.91 0.07 95)"/><stop offset="1" stop-color="oklch(0.69 0.1 74)"/></linearGradient>`

  const base =
    `<rect width="${W}" height="${H}" fill="${ok(L, C, h)}"/>` +
    grain(c, 0.26) +
    `<rect width="${W}" height="${H}" fill="url(#${uid}l)"/>` +
    `<rect width="${hinge}" height="${H}" fill="url(#${uid}s)"/>` +
    `<rect x="${hinge - 1.5}" width="3" height="${H}" fill="#000" opacity=".3"/><rect x="${hinge + 1.5}" width="1.4" height="${H}" fill="#fff" opacity=".1"/>`

  if (tier === 'micro') {
    const lw = W * 0.6
    const lh = H * (sq ? 0.42 : 0.3)
    const ly = H * (sq ? 0.29 : 0.22)
    const fs = lh * 0.62
    const label = `<rect x="${r2(cx - lw / 2)}" y="${r2(ly)}" width="${r2(lw)}" height="${r2(lh)}" fill="${paper}"/>`
    const mark = p.bare
      ? ''
      : glyph(monogram(p), {
          x: cx,
          y: ly + lh / 2 + (metrics(TITLE).cap * fs) / 2,
          size: fs,
          family: SERIF,
          weight: 600,
          fill: ink,
          anchor: 'middle',
        })
    return svg(c, defs, base + label + mark)
  }

  const full = tier === 'full'
  const compact = tier === 'compact'
  const frame =
    `<rect x="${fx0}" y="${fy0}" width="${fx1 - fx0}" height="${fy1 - fy0}" fill="none" stroke="${clothDeep}" stroke-width="2.4"/>` +
    `<rect x="${fx0 + 1.4}" y="${fy0 + 1.4}" width="${fx1 - fx0}" height="${fy1 - fy0}" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="1"/>` +
    (full
      ? `<rect x="${fx0 + 8}" y="${fy0 + 8}" width="${fx1 - fx0 - 16}" height="${fy1 - fy0 - 16}" fill="none" stroke="${clothDeep}" stroke-width="1.1"/>`
      : '')

  const labelW = compact ? W - (sq ? 96 : 72) : sq ? 392 : 296
  const pad = compact ? 14 : sq ? 26 : 22
  const innerW = labelW - pad * 2 - 6
  const labelTop = sq ? 104 : 92
  const authorBase = sq ? 506 : 514

  let series: Fit | null = null
  const seriesText = full && p.series ? seriesLine(c) : null
  if (seriesText) {
    const opts = { min: u(6), max: sq ? 17 : 15 }
    const one = fitLine(seriesText, CAPS, innerW, opts)
    const two =
      one?.truncated && seriesText[0]
        ? fitBlock(seriesText[0], CAPS, { w: innerW, h: Math.max(opts.min, opts.max) * 3.2 }, { ...opts, maxLines: 2, leading: 1.4, align: 'center' })
        : null
    series = two && !two.truncated ? two : one
  }
  const volume = p.volume ? fitLine([c.strings.volume(p.volume)], CAPS, innerW, { min: u(6.5), max: sq ? 22 : 19 }) : null
  const subText = full ? (p.subtitle ?? p.kicker) : null
  const sub = subText
    ? fitBlock(subText, SUB, { w: innerW, h: sq ? 66 : 58 }, { min: u(6.8), max: sq ? 26 : 22, maxLines: 2, leading: 1.14, align: 'center' })
    : null

  const reserve = (series ? fitHeight(series) + 18 : 0) + (volume ? volume.cap + 18 : 0) + (sub ? sub.height + sub.desc + 26 : 0)
  const maxLabelBottom = authorBase - (sq ? 92 : 96)
  const titleH = Math.max(60, maxLabelBottom - labelTop - pad * 2 - reserve)
  const title = fitBlock(
    p.main,
    TITLE,
    { w: innerW, h: titleH },
    { min: u(compact ? 8.5 : 9), max: sq ? 100 : 82, maxLines: 5, leading: 1.04, align: 'center', linePenalty: 0.035 },
  )

  let y = labelTop + pad + 2
  let inner = ''
  if (series) {
    inner += text(series, CAPS, { x: cx, top: y, anchor: 'middle', fill: rule })
    y += fitHeight(series) + 9
    inner += `<path d="M${r2(cx - 9)} ${r2(y)}h18" stroke="${rule}" stroke-width="1.2" opacity=".6"/>`
    y += 9
  }
  inner += text(title, TITLE, { x: cx, top: y, anchor: 'middle', fill: ink, rtl })
  y += title.height + title.desc * 0.35
  if (volume) {
    y += 16
    inner += text(volume, CAPS, { x: cx, top: y, anchor: 'middle', fill: rule })
    y += volume.cap
  }
  if (sub) {
    y += 13
    inner += `<path d="M${r2(cx - 14)} ${r2(y)}h28" stroke="${rule}" stroke-width="1.2" opacity=".55"/>`
    y += 13
    inner += text(sub, SUB, { x: cx, top: y, anchor: 'middle', fill: ink, rtl })
    y += sub.height + sub.desc * 0.5
  }
  const labelH = y - labelTop + pad
  const lx = cx - labelW / 2
  const shift = Math.max(0, (maxLabelBottom - labelTop - labelH) * 0.32)
  const label =
    `<g transform="translate(0 ${r2(shift)})">` +
    `<rect x="${r2(lx - 1)}" y="${labelTop + 1}" width="${labelW + 2}" height="${r2(labelH + 3)}" fill="#000" opacity=".16"/>` +
    `<rect x="${r2(lx)}" y="${labelTop + 2}" width="${labelW}" height="${r2(labelH + 2)}" fill="#000" opacity=".22"/>` +
    `<rect x="${r2(lx)}" y="${labelTop}" width="${labelW}" height="${r2(labelH)}" fill="${paper}"/>` +
    grain(c, 0.2, { x: lx, y: labelTop, w: labelW, h: labelH }) +
    `<rect x="${r2(lx + 6)}" y="${labelTop + 6}" width="${labelW - 12}" height="${r2(labelH - 12)}" fill="none" stroke="${rule}" stroke-width="1.3" opacity=".55"/>` +
    inner +
    `</g>`

  const author = fitAuthors(p, c.strings.list, AUTHOR, fx1 - fx0 - 44, { min: u(6.2), max: sq ? 26 : 22 }, full ? 2 : 1)
  let foilLayer = ''
  if (author && !(compact && author.truncated)) {
    const top = authorBase - fitHeight(author)
    if (labelTop + shift + labelH < top - 52) {
      const oy = top - 26
      foilLayer += `<g fill="${foil}"><rect x="${r2(cx - 3.5)}" y="${r2(oy - 3.5)}" width="7" height="7" transform="rotate(45 ${r2(cx)} ${r2(oy)})"/><rect x="${r2(cx - 36)}" y="${r2(oy - 0.6)}" width="24" height="1.2"/><rect x="${r2(cx + 12)}" y="${r2(oy - 0.6)}" width="24" height="1.2"/></g>`
    }
    if (!gilt) foilLayer += text(author, AUTHOR, { x: cx, top: top + 1.2, anchor: 'middle', fill: '#fff', opacity: 0.14 })
    foilLayer += text(author, AUTHOR, { x: cx, top, anchor: 'middle', fill: foil })
  }
  return svg(c, defs, base + frame + label + foilLayer)
}
