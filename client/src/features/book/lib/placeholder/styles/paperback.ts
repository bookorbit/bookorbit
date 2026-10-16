import { fitAuthors, fitBlock, fitHeight, fitLine, metrics, monogram, type TextStyle } from '../typeset'
import { ok, schemeFor, type GenreFamilyKey } from '../palette'
import { SANS, SERIF, glyph, grain, grainPattern, r2, seriesLine, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SANS, weight: 700, tracking: -0.02 }
const SUB: TextStyle = { family: SERIF, weight: 400, italic: true }
const AUTHOR: TextStyle = { family: SANS, weight: 500, tracking: -0.005 }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.22, upper: true }
const NUMBER: TextStyle = { family: SANS, weight: 700, tracking: -0.02 }

// The classic paperback lines coded their covers by genre; the bands follow the same idea.
const BAND_HUE: Record<GenreFamilyKey | 'fiction', number> = {
  fiction: 46,
  mystery: 150,
  nonfiction: 236,
  classic: 312,
  romance: 352,
  horror: 24,
  scifi: 204,
  fantasy: 276,
  young: 88,
}

// Books without a recognised genre still get a band, picked by their series or author, but no genre label.
const UNCODED: readonly (GenreFamilyKey | 'fiction')[] = [
  'fiction',
  'mystery',
  'nonfiction',
  'classic',
  'romance',
  'horror',
  'scifi',
  'fantasy',
  'young',
]

function bands(key: GenreFamilyKey | 'fiction') {
  const h = BAND_HUE[key]
  if (key === 'young') return { band: ok(0.8, 0.155, h), on: ok(0.22, 0.05, h), deep: ok(0.42, 0.1, h), h }
  if (key === 'horror') return { band: ok(0.47, 0.17, h), on: ok(0.98, 0.01, h), deep: ok(0.4, 0.15, h), h }
  if (key === 'classic') return { band: ok(0.5, 0.15, h), on: ok(0.98, 0.01, h), deep: ok(0.42, 0.13, h), h }
  return { band: ok(0.64, 0.165, h), on: ok(0.99, 0.01, h), deep: ok(0.48, 0.13, h), h }
}

export function paperback(c: StyleContext): string {
  const { W, H, sq, p, pal, tier } = c
  const u = unitsFor(c)
  const col = bands(pal.family ?? schemeFor(pal, UNCODED))
  const cream = ok(0.968, 0.014, 88)
  const ink = ok(0.19, 0.012, col.h)
  const t0 = H * (sq ? 0.27 : 0.31)
  const t1 = H * (sq ? 0.73 : 0.69)
  const cx = W / 2
  const rtl = p.script === 'rtl'
  const defs = grainPattern(c)
  const art =
    `<rect width="${W}" height="${H}" fill="${col.band}"/>` +
    `<rect y="${r2(t0)}" width="${W}" height="${r2(t1 - t0)}" fill="${cream}"/>` +
    `<rect y="${r2(t0 + 7)}" width="${W}" height="1.6" fill="${col.band}"/><rect y="${r2(t1 - 8.6)}" width="${W}" height="1.6" fill="${col.band}"/>` +
    grain(c, 0.22)

  if (tier === 'micro') {
    const fs = (t1 - t0) * 0.62
    const mark = p.bare
      ? ''
      : glyph(monogram(p), {
          x: cx,
          y: (t0 + t1) / 2 + (metrics(TITLE).cap * fs) / 2,
          size: fs,
          family: SANS,
          weight: 700,
          fill: ink,
          anchor: 'middle',
        })
    return svg(c, defs, art + mark)
  }

  const full = tier === 'full'
  let words = ''
  // a series name too long for the band gives way to the genre rather than an ellipsis
  const family = pal.family ? [c.strings.family(pal.family)] : []
  const label = [...(seriesLine(c) ?? []), ...family]
  if (label.length && full) {
    const fit = fitLine(label, CAPS, W - 2 * u(34), { min: u(6), max: sq ? 18 : 16 })
    if (fit)
      words += text(fit, CAPS, {
        x: cx,
        top: Math.min(Math.max(u(31) + 4, t0 / 2 - fit.cap / 2 + 4), t0 - fit.cap - 14),
        anchor: 'middle',
        fill: col.on,
      })
  }
  const author = fitAuthors(p, c.strings.list, AUTHOR, W - 80, { min: u(6.6), max: sq ? 26 : 22 }, full ? 2 : 1)
  const showAuthor = author && !(tier === 'compact' && author.truncated) ? author : null
  const subText = full ? (p.subtitle ?? p.kicker) : null
  const sub = subText
    ? fitBlock(subText, SUB, { w: W - 110, h: sq ? 54 : 46 }, { min: u(6.8), max: sq ? 22 : 19, maxLines: 2, leading: 1.14, align: 'center' })
    : null
  const pad = sq ? 30 : 24
  const below = (sub ? sub.height + sub.desc + 12 : 0) + (showAuthor ? 36 + fitHeight(showAuthor) : 0)
  const title = fitBlock(
    p.main,
    TITLE,
    { w: W - (sq ? 100 : 64), h: t1 - t0 - 2 * pad - 14 - below },
    { min: u(tier === 'compact' ? 8.5 : 9.5), max: sq ? 84 : 64, maxLines: 4, leading: 1.06, align: 'center', linePenalty: 0.04 },
  )
  let y = (t0 + t1) / 2 - (title.height + title.desc * 0.3 + below) / 2
  words += text(title, TITLE, { x: cx, top: y, anchor: 'middle', fill: ink, rtl })
  y += title.height + title.desc * 0.3
  if (sub) {
    y += 12
    words += text(sub, SUB, { x: cx, top: y, anchor: 'middle', fill: ok(0.38, 0.02, col.h), rtl })
    y += sub.height + sub.desc
  }
  if (showAuthor) {
    y += 14
    words += `<rect x="${r2(cx - 16)}" y="${r2(y)}" width="32" height="2" fill="${col.band}"/>`
    y += 22
    words += text(showAuthor, AUTHOR, { x: cx, top: y, anchor: 'middle', fill: col.deep })
  }
  const number = p.volume ?? p.series?.index
  if (number) {
    const fit = fitLine([number], NUMBER, 60, { min: u(7), max: sq ? 30 : 26 })
    if (fit) {
      const cy = (t1 + H) / 2 - 6
      const rad = Math.max(fit.width / 2 + 10, fit.cap * 1.25)
      words +=
        `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(rad)}" fill="none" stroke="${col.on}" stroke-width="2"/>` +
        text(fit, NUMBER, { x: cx, top: cy - fit.cap / 2, anchor: 'middle', fill: col.on })
    }
  }
  return svg(c, defs, art + words)
}
