import { fitAuthors, fitBlock, fitHeight, fitLine, metrics, monogram, pick, type Random, type TextStyle } from '../typeset'
import { ok, schemeFor, type Palette } from '../palette'
import { SANS, glyph, grain, grainPattern, r2, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SANS, weight: 850, tracking: -0.025 }
const SUB: TextStyle = { family: SANS, weight: 500, tracking: -0.01 }
const AUTHOR: TextStyle = { family: SANS, weight: 650, tracking: 0 }
const CAPS: TextStyle = { family: SANS, weight: 700, tracking: 0.12, upper: true }
const NUMBER: TextStyle = { family: SANS, weight: 850, tracking: -0.03 }

// Pastel grounds; the candy set is worked out from each so every ground gets contrasting confetti.
const GROUNDS: readonly number[] = [350, 200, 150, 300, 88, 30, 180, 262, 125, 12]

function colors(pal: Palette) {
  const h = schemeFor(pal, GROUNDS)
  return {
    ground: ok(0.9, 0.06, h),
    ink: ok(0.17, 0.02, h),
    card: ok(0.99, 0.004, h),
    sticker: ok(0.87, 0.16, 95),
    candy: [ok(0.72, 0.18, h + 180), ok(0.84, 0.15, 95), ok(0.7, 0.17, h + 60), ok(0.66, 0.2, h - 40), ok(0.8, 0.13, h + 120)],
  }
}

type Shape = 'squiggle' | 'zigzag' | 'triangle' | 'disc' | 'ring' | 'half' | 'dots' | 'plus' | 'bar'
const SHAPES: readonly Shape[] = ['squiggle', 'zigzag', 'triangle', 'disc', 'ring', 'half', 'dots', 'plus', 'bar']

function shape(kind: Shape, x: number, y: number, size: number, angle: number, fill: string, ink: string, stroke: number): string {
  const s = size / 2
  let d = ''
  switch (kind) {
    case 'squiggle': {
      let path = `M${r2(-s)} 0`
      for (let i = 0; i < 4; i++) path += ` q${r2(s / 4)} ${r2((i % 2 ? 1 : -1) * s * 0.45)} ${r2(s / 2)} 0`
      d = `<path d="${path}" fill="none" stroke="${fill}" stroke-width="${r2(stroke * 1.3)}" stroke-linecap="round"/>`
      break
    }
    case 'zigzag': {
      let path = `M${r2(-s)} ${r2(s * 0.2)}`
      for (let i = 1; i <= 5; i++) path += ` L${r2(-s + (i * size) / 5)} ${r2((i % 2 ? -1 : 1) * s * 0.2)}`
      d = `<path d="${path}" fill="none" stroke="${ink}" stroke-width="${r2(stroke)}" stroke-linejoin="miter" stroke-linecap="square"/>`
      break
    }
    case 'triangle':
      d = `<path d="M0 ${r2(-s)} L${r2(s * 0.92)} ${r2(s * 0.6)} L${r2(-s * 0.92)} ${r2(s * 0.6)}Z" fill="${fill}" stroke="${ink}" stroke-width="${r2(stroke * 0.6)}" stroke-linejoin="round"/>`
      break
    case 'disc':
      d = `<circle r="${r2(s * 0.8)}" fill="${fill}"/><circle cx="${r2(s * 0.18)}" cy="${r2(s * 0.18)}" r="${r2(s * 0.8)}" fill="none" stroke="${ink}" stroke-width="${r2(stroke * 0.6)}"/>`
      break
    case 'ring':
      d = `<circle r="${r2(s * 0.7)}" fill="none" stroke="${fill}" stroke-width="${r2(stroke * 1.6)}"/>`
      break
    case 'half':
      d = `<path d="M${r2(-s)} 0 A${r2(s)} ${r2(s)} 0 0 1 ${r2(s)} 0Z" fill="${fill}" stroke="${ink}" stroke-width="${r2(stroke * 0.6)}"/>`
      break
    case 'dots':
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++)
          d += `<circle cx="${r2((col - 1) * s * 0.6)}" cy="${r2((row - 1) * s * 0.6)}" r="${r2(stroke * 0.55)}" fill="${ink}"/>`
      break
    case 'plus':
      d = `<rect x="${r2(-s * 0.7)}" y="${r2(-stroke * 0.8)}" width="${r2(s * 1.4)}" height="${r2(stroke * 1.6)}" fill="${fill}"/><rect x="${r2(-stroke * 0.8)}" y="${r2(-s * 0.7)}" width="${r2(stroke * 1.6)}" height="${r2(s * 1.4)}" fill="${fill}"/>`
      break
    default:
      d = `<rect x="${r2(-s)}" y="${r2(-s * 0.18)}" width="${r2(size)}" height="${r2(s * 0.36)}" fill="${fill}" stroke="${ink}" stroke-width="${r2(stroke * 0.6)}"/>`
  }
  return `<g transform="translate(${r2(x)} ${r2(y)}) rotate(${r2(angle)})">${d}</g>`
}

/** Shapes on a jittered grid, so the confetti reads as composed rather than scattered. */
function confetti(c: StyleContext, r: Random, col: ReturnType<typeof colors>): string {
  const { W, H, sq } = c
  const stroke = W * 0.017
  let out = ''
  for (let i = 0; i < (sq ? 34 : 26); i++)
    out += `<circle cx="${r2(r() * W)}" cy="${r2(r() * H)}" r="${r2(stroke * (0.25 + r() * 0.35))}" fill="${r() < 0.5 ? col.ink : pick(r, col.candy)}"/>`
  const cols = sq ? 4 : 3
  const rows = sq ? 4 : 5
  const cw = W / cols
  const ch = H / rows
  for (let row = 0; row < rows; row++)
    for (let ci = 0; ci < cols; ci++) {
      const kind = pick(r, SHAPES)
      const x = cw * (ci + 0.5 + (r() - 0.5) * 0.5)
      const y = ch * (row + 0.5 + (r() - 0.5) * 0.5)
      const size = Math.min(cw, ch) * (0.42 + r() * 0.22)
      out += shape(kind, x, y, size, r() * 360, pick(r, col.candy), col.ink, stroke)
    }
  return out
}

/**
 * Memphis: candy confetti on a pastel ground, with the title on a white card that casts a hard
 * offset shadow. The card grows to fit the title, so long titles never crowd the shapes.
 */
export function memphis(c: StyleContext): string {
  const { W, H, sq, p, pal, tier } = c
  const u = unitsFor(c)
  const r = pal.r
  const col = colors(pal)
  const defs = grainPattern(c)
  const shadow = W * 0.02
  const art = `<rect width="${W}" height="${H}" fill="${col.ground}"/>` + confetti(c, r, col) + grain(c, 0.25)
  const card = (x: number, y: number, w: number, h: number) =>
    `<rect x="${r2(x + shadow)}" y="${r2(y + shadow)}" width="${r2(w)}" height="${r2(h)}" fill="${col.ink}"/>` +
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${col.card}" stroke="${col.ink}" stroke-width="${r2(W * 0.008)}"/>`

  if (tier === 'micro') {
    if (p.bare) return svg(c, defs, art)
    const w = W * 0.56
    const fs = w * 0.62
    const y = H / 2 - w / 2
    const mark = glyph(monogram(p), {
      x: W / 2,
      y: H / 2 + (metrics(TITLE).cap * fs) / 2,
      size: fs,
      family: SANS,
      weight: 850,
      fill: col.ink,
      anchor: 'middle',
    })
    return svg(c, defs, art + card(W / 2 - w / 2, y, w, w) + mark)
  }

  const full = tier === 'full'
  const m = sq ? 48 : 34
  const boxW = W - 2 * m
  const padX = sq ? 24 : 18
  const padY = sq ? 24 : 18
  const inner = boxW - 2 * padX
  const series = full && p.series ? fitLine([p.series.name], CAPS, inner, { min: u(6), max: sq ? 15 : 13 }) : null
  const title = fitBlock(
    p.main,
    TITLE,
    { w: inner, h: sq ? 220 : 206 },
    { min: u(tier === 'compact' ? 9 : 9.5), max: sq ? 80 : 62, maxLines: 5, leading: 1.02, align: 'center', linePenalty: 0.035 },
  )
  const subText = full ? (p.subtitle ?? p.kicker) : null
  const sub = subText
    ? fitBlock(subText, SUB, { w: inner, h: sq ? 50 : 44 }, { min: u(6.6), max: sq ? 21 : 18, maxLines: 2, leading: 1.18, align: 'center' })
    : null
  const author = fitAuthors(p, c.strings.list, AUTHOR, inner, { min: u(6.6), max: sq ? 24 : 20 }, full ? 2 : 1)
  const showAuthor = author && !(tier === 'compact' && author.truncated) ? author : null

  const contentH =
    (series ? series.cap + 14 : 0) +
    title.height +
    title.desc * 0.3 +
    (sub ? sub.height + sub.desc * 0.3 + 10 : 0) +
    (showAuthor ? fitHeight(showAuthor) + 30 : 0)
  const boxH = contentH + 2 * padY
  const lo = Math.max(sq ? 70 : 64, u(31)) + 8
  const hi = H - Math.max(70, u(30)) - shadow - boxH
  const boxTop = Math.max(lo, Math.min(hi, H * 0.47 - boxH / 2))
  const cx = W / 2
  const rtl = p.script === 'rtl'
  let y = boxTop + padY
  let words = ''
  if (series) {
    words += text(series, CAPS, { x: cx, top: y, anchor: 'middle', fill: col.ink })
    y += series.cap + 14
  }
  words += text(title, TITLE, { x: cx, top: y, anchor: 'middle', fill: col.ink, rtl })
  y += title.height + title.desc * 0.3
  if (sub) {
    y += 10
    words += text(sub, SUB, { x: cx, top: y, anchor: 'middle', fill: col.ink, rtl, opacity: 0.85 })
    y += sub.height + sub.desc * 0.3
  }
  if (showAuthor) {
    y += 14
    words += `<path d="M${r2(cx - 22)} ${r2(y)} q5.5 -5 11 0 t11 0 t11 0 t11 0" fill="none" stroke="${col.candy[0]}" stroke-width="3" stroke-linecap="round"/>`
    y += 16
    words += text(showAuthor, AUTHOR, { x: cx, top: y, anchor: 'middle', fill: col.ink })
  }

  let sticker = ''
  const number = full || tier === 'compact' ? (p.volume ?? p.series?.index ?? null) : null
  if (number) {
    const fit = fitLine([number], NUMBER, W * 0.12, { min: u(7), max: sq ? 30 : 26 })
    if (fit) {
      const radius = Math.min(W * 0.075, Math.max(fit.width / 2 + 9, fit.cap * 1.2))
      const sx = m + boxW - radius * 0.4
      const sy = boxTop + boxH - radius * 0.2
      sticker =
        `<g transform="rotate(-12 ${r2(sx)} ${r2(sy)})"><circle cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(radius)}" fill="${col.sticker}" stroke="${col.ink}" stroke-width="${r2(W * 0.008)}"/>` +
        text(fit, NUMBER, { x: sx, top: sy - fit.cap / 2, anchor: 'middle', fill: col.ink }) +
        `</g>`
    }
  }
  return svg(c, defs, art + card(m, boxTop, boxW, boxH) + words + sticker)
}
