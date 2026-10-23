import { fitAuthors, fitBlock, fitHeight, fitLine, metrics, monogram, type Random, type TextStyle } from '../typeset'
import { ok, schemeFor } from '../palette'
import { SANS, SERIF, glyph, grain, grainPattern, kickerLine, r2, svg, text, unitsFor, type StyleContext } from '../svg'

const TITLE: TextStyle = { family: SERIF, weight: 600, tracking: -0.01 }
const SUB: TextStyle = { family: SERIF, weight: 400, italic: true }
const CAPS: TextStyle = { family: SANS, weight: 650, tracking: 0.16, upper: true }
const AUTHOR: TextStyle = { family: SANS, weight: 600, tracking: 0.14, upper: true }

type Hour = 'night' | 'twilight' | 'sunset' | 'mist' | 'sepia' | 'day'

// Hour and hue together, so night, dusk, mist and day all turn up across a shelf.
const SCHEMES: readonly [Hour, number][] = [
  ['night', 250],
  ['sunset', 20],
  ['mist', 160],
  ['twilight', 230],
  ['day', 230],
  ['night', 290],
  ['sunset', 340],
  ['mist', 200],
  ['twilight', 300],
  ['day', 140],
  ['sepia', 60],
  ['night', 200],
]

interface Sky {
  top: string
  bottom: string
  orb: string
  orbR: number
  stars: boolean
  layers: string[]
  ink: string
  ink2: string
}

function layers(l: number[], c: number[], h: number[]): string[] {
  return l.map((lightness, i) => ok(lightness, c[i] ?? 0, h[i] ?? h[0] ?? 0))
}

function sky(hour: Hour, h: number): Sky {
  const h1 = h + 25
  switch (hour) {
    case 'night':
      return {
        top: ok(0.17, 0.045, h),
        bottom: ok(0.31, 0.07, h1),
        orb: ok(0.94, 0.03, 95),
        orbR: 0.075,
        stars: true,
        layers: layers([0.37, 0.31, 0.25, 0.19, 0.13], [0.05, 0.055, 0.06, 0.05, 0.04], [h, h - 3, h - 6, h - 9, h - 12]),
        ink: ok(0.96, 0.02, h),
        ink2: ok(0.82, 0.04, h),
      }
    case 'twilight':
      return {
        top: ok(0.3, 0.09, h),
        bottom: ok(0.7, 0.11, h1 + 30),
        orb: ok(0.93, 0.09, 85),
        orbR: 0.1,
        stars: false,
        layers: layers([0.53, 0.43, 0.34, 0.25, 0.16], [0.07, 0.08, 0.08, 0.07, 0.05], [h, h - 5, h - 10, h - 15, h - 20]),
        ink: ok(0.97, 0.02, h),
        ink2: ok(0.86, 0.05, h),
      }
    case 'sunset':
      return {
        top: ok(0.56, 0.13, h - 15),
        bottom: ok(0.87, 0.1, h1 + 40),
        orb: ok(0.96, 0.08, 90),
        orbR: 0.14,
        stars: false,
        layers: layers([0.66, 0.54, 0.42, 0.3, 0.18], [0.1, 0.11, 0.1, 0.08, 0.06], [h - 20, h - 28, h - 36, h - 44, h - 52]),
        ink: ok(0.99, 0.012, h),
        ink2: ok(0.93, 0.04, h),
      }
    case 'mist':
      return {
        top: ok(0.87, 0.035, h),
        bottom: ok(0.95, 0.02, h1),
        orb: ok(0.985, 0.02, 90),
        orbR: 0.12,
        stars: false,
        layers: layers([0.81, 0.71, 0.59, 0.45, 0.29], [0.035, 0.045, 0.06, 0.07, 0.06], [h, h + 4, h + 8, h + 12, h + 16]),
        ink: ok(0.22, 0.05, h),
        ink2: ok(0.38, 0.06, h),
      }
    case 'sepia':
      return {
        top: ok(0.86, 0.05, 70),
        bottom: ok(0.94, 0.035, 82),
        orb: ok(0.97, 0.05, 92),
        orbR: 0.12,
        stars: false,
        layers: layers([0.73, 0.61, 0.49, 0.37, 0.23], [0.05, 0.06, 0.065, 0.06, 0.05], [62, 56, 50, 44, 38]),
        ink: ok(0.25, 0.05, 50),
        ink2: ok(0.4, 0.06, 55),
      }
    default:
      return {
        top: ok(0.8, 0.075, h),
        bottom: ok(0.93, 0.04, h1),
        orb: ok(0.985, 0.03, 95),
        orbR: 0.09,
        stars: false,
        layers: layers([0.73, 0.61, 0.49, 0.37, 0.23], [0.07, 0.085, 0.1, 0.09, 0.07], [h, h + 6, h + 12, h + 18, h + 24]),
        ink: ok(0.2, 0.05, h),
        ink2: ok(0.36, 0.06, h),
      }
  }
}

function valueNoise(r: Random, size = 96) {
  const v = Array.from({ length: size }, () => r())
  const at = (t: number) => {
    const i = Math.floor(t)
    const f = t - i
    const a = v[((i % size) + size) % size] ?? 0
    const b = v[(((i + 1) % size) + size) % size] ?? 0
    return a + (b - a) * ((1 - Math.cos(f * Math.PI)) / 2)
  }
  return (t: number, octaves: number) => {
    let sum = 0
    let amp = 1
    let total = 0
    for (let o = 0; o < octaves; o++) {
      sum += at(t * 2 ** o + o * 17.3) * amp
      total += amp
      amp *= 0.5
    }
    return sum / total
  }
}

function ridge(
  W: number,
  H: number,
  base: number,
  amp: number,
  freq: number,
  noise: (t: number, o: number) => number,
  sharp: boolean,
  offset: number,
): string {
  const step = W / 44
  const pts: [number, number][] = []
  for (let x = -step; x <= W + step; x += step) {
    let v = noise(x * freq + offset, sharp ? 4 : 3)
    if (sharp) v = 1 - Math.abs(v * 2 - 1)
    pts.push([x, base - amp * v])
  }
  const [x0, y0] = pts[0] ?? [0, base]
  const [xn, yn] = pts.at(-1) ?? [W, base]
  let d = `M${r2(x0)} ${H + 2}L${r2(x0)} ${r2(y0)}`
  if (sharp) for (const [x, y] of pts.slice(1)) d += `L${r2(x)} ${r2(y)}`
  else {
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i] ?? [0, 0]
      const [nx, ny] = pts[i + 1] ?? [x, y]
      d += `Q${r2(x)} ${r2(y)} ${r2((x + nx) / 2)} ${r2((y + ny) / 2)}`
    }
    d += `L${r2(xn)} ${r2(yn)}`
  }
  return `${d}L${r2(xn)} ${H + 2}Z`
}

export function vista(c: StyleContext): string {
  const { W, H, sq, p, pal, tier, uid } = c
  const u = unitsFor(c)
  const r = pal.r
  const [hour, h] = schemeFor(pal, SCHEMES)
  const col = sky(hour, h)
  const noise = valueNoise(r)
  const full = tier === 'full'
  const rtl = p.script === 'rtl'
  const cx = W / 2
  const top = Math.max(sq ? 70 : 66, u(31))

  let words = ''
  let titleBottom = top
  let titleHalfWidth = 0
  if (tier !== 'micro') {
    let y = top
    const kickerText = full ? kickerLine(c, true) : null
    const kicker = kickerText ? fitLine(kickerText, CAPS, W - 120, { min: u(6), max: sq ? 17 : 15 }) : null
    if (kicker) {
      words += text(kicker, CAPS, { x: cx, top: y, anchor: 'middle', fill: col.ink2 })
      y += kicker.cap + 16
    }
    const title = fitBlock(
      p.main,
      TITLE,
      { w: W - (sq ? 110 : 72), h: (sq ? 0.4 : 0.36) * H - (y - top) },
      { min: u(tier === 'compact' ? 8.5 : 9), max: sq ? 96 : 78, maxLines: 5, leading: 1.04, align: 'center', linePenalty: 0.035 },
    )
    words += text(title, TITLE, { x: cx, top: y, anchor: 'middle', fill: col.ink, rtl })
    titleHalfWidth = title.width / 2 + 14
    y += title.height + title.desc * 0.4
    if (full && p.subtitle) {
      const sub = fitBlock(p.subtitle, SUB, { w: W - 120, h: 50 }, { min: u(6.8), max: sq ? 24 : 21, maxLines: 2, leading: 1.14, align: 'center' })
      y += 12
      words += text(sub, SUB, { x: cx, top: y, anchor: 'middle', fill: col.ink2, rtl })
      y += sub.height + sub.desc * 0.4
    }
    titleBottom = y
  }

  const amps = sq ? [80, 60, 48, 38, 28] : [74, 56, 44, 34, 26]
  const farAmp = amps[0] ?? 74
  const nearBase = H * (sq ? 0.8 : 0.79)
  // long titles push the hills down rather than shrinking into the sky
  const farBase = Math.max(H * (sq ? 0.5 : 0.47), tier === 'micro' ? 0 : titleBottom + 30 + farAmp)
  const bases = amps.map((_, i) => farBase + ((nearBase - farBase) * i) / 4)
  const peaks = r() < 0.6

  const defs =
    grainPattern(c) +
    `<linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col.top}"/><stop offset="${r2(Math.min(0.98, farBase / H))}" stop-color="${col.bottom}"/></linearGradient>` +
    `<radialGradient id="${uid}o"><stop offset=".55" stop-color="${col.orb}" stop-opacity=".35"/><stop offset="1" stop-color="${col.orb}" stop-opacity="0"/></radialGradient>`

  let art = `<rect width="${W}" height="${H}" fill="url(#${uid}s)"/>`
  if (col.stars) {
    const count = sq ? 46 : 36
    for (let i = 0; i < count; i++) {
      const sx = r() * W
      const sy = r() * (farBase - farAmp)
      const radius = u(0.45 + r() * 0.7)
      const opacity = 0.35 + r() * 0.55
      if (sy < titleBottom + 12 && Math.abs(sx - cx) < Math.max(titleHalfWidth, W * 0.32)) continue
      art += `<circle cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(radius)}" fill="#fff" opacity="${r2(opacity)}"/>`
    }
  }
  const orbR = W * col.orbR
  const ox = W * (0.22 + r() * 0.56)
  const oy = hour === 'night' ? Math.max(titleBottom + orbR + 22, farBase - farAmp * 1.4) : (bases[0] ?? farBase) - farAmp * 0.35
  art += `<circle cx="${r2(ox)}" cy="${r2(oy)}" r="${r2(orbR * 1.9)}" fill="url(#${uid}o)"/><circle cx="${r2(ox)}" cy="${r2(oy)}" r="${r2(orbR)}" fill="${col.orb}"/>`
  amps.forEach((amp, i) => {
    art += `<path d="${ridge(W, H, bases[i] ?? nearBase, amp, (0.02 - i * 0.0025) * (400 / W), noise, peaks && i < 2, i * 31.7)}" fill="${col.layers[i] ?? col.bottom}"/>`
  })
  art += grain(c, 0.22)

  if (tier === 'micro') {
    const fs = W * 0.46
    const mark = p.bare
      ? ''
      : glyph(monogram(p), { x: cx, y: H * 0.12 + metrics(TITLE).cap * fs, size: fs, family: SERIF, weight: 600, fill: col.ink, anchor: 'middle' })
    return svg(c, defs, art + mark)
  }

  const author = fitAuthors(p, c.strings.list, AUTHOR, W - (sq ? 140 : 88), { min: u(6.2), max: sq ? 22 : 19 }, full ? 2 : 1)
  if (author && !(tier === 'compact' && author.truncated)) {
    const near = bases[4] ?? nearBase
    const ah = fitHeight(author)
    const authorTop = Math.min(near + (H - 62 - near) / 2 - ah / 2, H - u(26) - ah)
    words += text(author, AUTHOR, { x: cx, top: authorTop, anchor: 'middle', fill: ok(0.95, 0.02, h) })
  }
  return svg(c, defs, art + words)
}
