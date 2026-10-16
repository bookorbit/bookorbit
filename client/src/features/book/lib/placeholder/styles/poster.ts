import {
  SMALL_WORDS,
  fitAuthors,
  fitBlock,
  fitHeight,
  fitLine,
  measure,
  metrics,
  monogram,
  type BlockFit,
  type Fit,
  type TextStyle,
} from '../typeset'
import { ok, schemeFor, type Palette } from '../palette'
import { SANS, SERIF, glyph, grain, grainPattern, r2, seriesLine, svg, text, unitsFor, type StyleContext } from '../svg'

const LINE: TextStyle = { family: SANS, weight: 900, tracking: -0.02, upper: true }
const CONNECTOR: TextStyle = { family: SERIF, weight: 500, italic: true }
const SUB: TextStyle = { family: SERIF, weight: 500, italic: true }
const AUTHOR: TextStyle = { family: SANS, weight: 750, tracking: -0.01 }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.12, upper: true }
const BLOCK: TextStyle = { family: SANS, weight: 900 }

const words = (s: string) => s.split(/\s+/).filter(Boolean)
const isSmall = (w: string) => SMALL_WORDS.has(w.toLowerCase())

type Scheme = { kind: 'vivid'; h: number } | { kind: 'deep'; h: number; ink: number } | { kind: 'pale'; h: number }

// Six vivid fields with cream type, four dark fields with bright type, two pale fields with deep type.
const SCHEMES: readonly Scheme[] = [
  { kind: 'vivid', h: 27 },
  { kind: 'deep', h: 260, ink: 95 },
  { kind: 'vivid', h: 255 },
  { kind: 'pale', h: 350 },
  { kind: 'vivid', h: 150 },
  { kind: 'deep', h: 160, ink: 70 },
  { kind: 'vivid', h: 45 },
  { kind: 'deep', h: 20, ink: 95 },
  { kind: 'vivid', h: 300 },
  { kind: 'pale', h: 200 },
  { kind: 'vivid', h: 90 },
  { kind: 'deep', h: 300, ink: 85 },
]

function colors(pal: Palette) {
  const scheme = schemeFor(pal, SCHEMES)
  const h = scheme.h
  if (scheme.kind === 'deep') return { field: ok(0.235, 0.055, h), ink: ok(0.87, 0.16, scheme.ink) }
  if (scheme.kind === 'pale') return { field: ok(0.92, 0.055, h), ink: ok(0.3, 0.14, h) }
  const yellowish = h > 70 && h < 115
  return { field: ok(yellowish ? 0.82 : 0.6, yellowish ? 0.16 : 0.2, h), ink: yellowish ? ok(0.22, 0.05, h) : ok(0.975, 0.025, h + 20) }
}

function* splits(arr: string[], maxParts: number): Generator<string[]> {
  const n = arr.length
  function* rec(start: number, left: number): Generator<string[]> {
    if (left === 1) {
      yield [arr.slice(start).join(' ')]
      return
    }
    for (let cut = start + 1; cut <= n - (left - 1); cut++) for (const rest of rec(cut, left - 1)) yield [arr.slice(start, cut).join(' '), ...rest]
  }
  for (let L = 1; L <= Math.min(maxParts, n); L++) yield* rec(0, L)
}

interface PosterLine {
  t: string
  conn: boolean
  size: number
  h: number
}

interface PosterSet {
  lines: PosterLine[]
  height: number
  scaled: boolean
}

/**
 * Stacked type: every content line is scaled to the full measure and small joining words drop to
 * an italic connector between them, so length variance becomes the composition itself.
 */
function stack(title: string, box: { w: number; h: number }, c: StyleContext): PosterSet {
  const u = unitsFor(c)
  const ws = words(title)
  const items: { conn: boolean; words: string[] }[] = []
  ws.forEach((w, i) => {
    const seenContent = items.some((it) => !it.conn && it.words.some((x) => !isSmall(x)))
    const conn = isSmall(w) && i > 0 && i < ws.length - 1 && seenContent
    const last = items.at(-1)
    if (last && last.conn === conn) last.words.push(w)
    else items.push({ conn, words: [w] })
  })
  const capLine = metrics(LINE).cap
  const capConn = metrics(CONNECTOR).cap
  const maxLine = c.sq ? 200 : 168
  const floor = u(10)
  const options = items.map((it) => (it.conn ? [[it.words.join(' ')]] : [...splits(it.words, 4)]))
  let combos: string[][][] = [[]]
  for (const option of options) {
    const next: string[][][] = []
    for (const combo of combos) for (const o of option) next.push([...combo, o])
    combos = next.length > 4000 ? next.slice(0, 4000) : next
  }
  let best: { score: number; lines: PosterLine[]; height: number } | null = null
  for (const combo of combos) {
    const lines: PosterLine[] = []
    combo.forEach((part, i) => part.forEach((t) => lines.push({ t, conn: items[i]?.conn ?? false, size: 0, h: 0 })))
    const content = lines.filter((l) => !l.conn)
    for (const l of content) l.size = Math.min(maxLine, box.w / measure(l.t, LINE))
    const avg = content.reduce((a, l) => a + l.size, 0) / Math.max(1, content.length)
    for (const l of lines) if (l.conn) l.size = Math.max(u(7.5), Math.min(c.sq ? 52 : 46, avg * 0.42))
    let height = 0
    lines.forEach((l, i) => {
      l.h = (l.conn ? capConn : capLine) * l.size
      const prev = lines[i - 1]
      height += l.h + (prev ? Math.max(7, 0.12 * Math.min(l.size, prev.size)) : 0)
    })
    const sizes = content.map((l) => l.size)
    const ratio = Math.max(...sizes) / Math.min(...sizes)
    let pen = Math.max(0, ratio - 2.4) * 0.12 + lines.length * 0.015
    if (content.some((l) => l.size < floor)) pen += 1
    for (const l of content) {
      if (content.length > 1 && words(l.t).every(isSmall)) pen += 1
      else if (content.length > 1 && l.t.replace(/[^\p{L}\p{N}]/gu, '').length <= 2) pen += 0.5
    }
    const fill = height / box.h
    const score = (fill <= 1 ? fill : 1 - (fill - 1) * 3) - pen
    if (!best || score > best.score) best = { score, lines, height }
  }
  if (!best) return { lines: [], height: 0, scaled: false }
  if (best.height <= box.h) return { lines: best.lines, height: best.height, scaled: false }
  const s = box.h / best.height
  for (const l of best.lines) {
    l.size *= s
    l.h *= s
  }
  return { lines: best.lines, height: box.h, scaled: true }
}

export function poster(c: StyleContext): string {
  const { W, H, sq, p, pal, tier } = c
  const u = unitsFor(c)
  const col = colors(pal)
  const x0 = 26
  const w = W - x0 * 2
  const latin = p.script === 'latin'
  const defs = grainPattern(c)
  const texture = grain(c, 0.3)

  if (tier === 'micro') {
    const fs = W * 0.78
    const mark = p.bare
      ? ''
      : glyph(monogram(p), {
          x: W / 2,
          y: H * 0.35 + (metrics(LINE).cap * fs) / 2,
          size: fs,
          family: SANS,
          weight: 900,
          fill: col.ink,
          anchor: 'middle',
        })
    return svg(
      c,
      defs,
      `<rect width="${W}" height="${H}" fill="${col.field}"/><rect y="${H * 0.7}" width="${W}" height="${H * 0.3}" fill="${col.ink}"/>${mark}${texture}`,
    )
  }

  const y0 = Math.max(64, u(31))
  const box = { w, h: H - (sq ? 156 : 158) - y0 - 30 }
  let block = ''
  let blockHeight: number
  let centred: BlockFit | null = null
  let set: PosterSet | null = null
  if (latin) {
    set = stack(p.main, box, c)
    blockHeight = set.height
  } else {
    centred = fitBlock(p.main, BLOCK, box, { min: u(10), max: sq ? 120 : 100, maxLines: 4, leading: 1.02, align: 'center' })
    blockHeight = centred.height
  }
  const panelTop = Math.max(y0 + blockHeight + 34, H * (sq ? 0.56 : 0.58))
  const blockTop = Math.max(y0, y0 + (panelTop - 30 - y0 - blockHeight) / 2)
  if (centred) block = text(centred, BLOCK, { x: W / 2, top: blockTop, anchor: 'middle', fill: col.ink, rtl: p.script === 'rtl' })
  else if (set) {
    let y = blockTop
    set.lines.forEach((l, i) => {
      const prev = set!.lines[i - 1]
      if (prev) y += Math.max(7, 0.12 * Math.min(l.size, prev.size))
      const st = l.conn ? CONNECTOR : LINE
      const fit: Fit = { text: l.conn ? l.t.toLocaleLowerCase() : l.t, size: l.size, width: 0, cap: metrics(st).cap * l.size, truncated: false }
      const justify = !l.conn && !set!.scaled && l.size < (sq ? 200 : 168) - 0.5 ? w : 0
      block += text(fit, st, { x: l.conn ? W / 2 : x0, top: y, anchor: l.conn ? 'middle' : 'start', fill: col.ink, justify })
      y += l.h
    })
  }

  let panel = `<rect y="${r2(panelTop)}" width="${W}" height="${r2(H - panelTop)}" fill="${col.ink}"/>`
  const full = tier === 'full'
  const subText = full ? (p.subtitle ?? p.kicker) : null
  const sub = subText
    ? fitBlock(subText, SUB, { w, h: sq ? 60 : 52 }, { min: u(6.8), max: sq ? 28 : 23, maxLines: 2, leading: 1.12, align: 'start' })
    : null
  const author = fitAuthors(p, c.strings.list, AUTHOR, w, { min: u(7), max: sq ? 30 : 25 }, 1)
  const seriesText = full ? seriesLine(c) : null
  const series = seriesText ? fitLine(seriesText, CAPS, w, { min: u(6), max: sq ? 16 : 14 }) : null
  let y = panelTop + 24
  const room = H - 62 - y
  const subH = sub ? sub.height + sub.desc + 14 : 0
  const need = subH + (author ? fitHeight(author) + 14 : 0) + (series ? series.cap : 0)
  const rtl = p.script === 'rtl'
  if (sub && need <= room) {
    panel += text(sub, SUB, { x: rtl ? W - x0 : x0, top: y, fill: col.field, rtl })
    y += subH
  }
  if (author && !(tier === 'compact' && author.truncated)) {
    panel += text(author, AUTHOR, { x: x0, top: y, fill: col.field })
    y += fitHeight(author) + 14
  }
  if (series && need - (sub && need > room ? subH : 0) <= room) panel += text(series, CAPS, { x: x0, top: y, fill: col.field, opacity: 0.8 })
  return svg(c, defs, `<rect width="${W}" height="${H}" fill="${col.field}"/>${block}${panel}${texture}`)
}
