/** The resolved colour of a token, as `getComputedStyle` serialises it. */
export function readCssColor(varName: string): string {
  const el = document.createElement('span')
  el.style.color = `var(${varName})`
  document.body.appendChild(el)
  const color = getComputedStyle(el).color
  el.remove()
  return color
}

function oklchToSrgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const toSrgb = (v: number) => {
    const c = Math.max(0, Math.min(1, v))
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
  }
  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)]
}

export function oklchToHex(L: number, C: number, H: number): string {
  return (
    '#' +
    oklchToSrgb(L, C, H)
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

export interface OklchColor {
  l: number
  c: number
  h: number
  alpha: number
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1
  const value = raw.trim().endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
  return Number.isFinite(value) ? value : 1
}

/** Parses the `oklch(L C H [/ A])` form `getComputedStyle` serialises tokens in. */
export function parseOklch(input: string): OklchColor | null {
  const inside = /^oklch\(([^)]+)\)/i.exec(input.trim())?.[1]
  if (!inside) return null
  const [channels, alphaRaw] = inside.split('/')
  const [lRaw, cRaw, hRaw] = channels!.trim().split(/\s+/)
  const l = lRaw?.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw ?? '')
  const c = cRaw?.endsWith('%') ? (parseFloat(cRaw) / 100) * 0.4 : parseFloat(cRaw ?? '')
  const h = hRaw === 'none' ? 0 : parseFloat(hRaw ?? '')
  return Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h) ? { l, c, h, alpha: parseAlpha(alphaRaw) } : null
}

/**
 * Rewrites the `oklch()` and `color(srgb ...)` forms `getComputedStyle` returns as hex, or rgba when
 * translucent, for consumers that only parse legacy colours: zrender (which otherwise drops a
 * hovered mark, because it derives emphasis colours from what it is given) and `theme-color`.
 */
export function toLegacyColor(input: string): string {
  const value = input.trim()
  if (value.startsWith('#') || value.startsWith('rgb')) return value

  const oklch = parseOklch(value)
  if (oklch) {
    if (oklch.alpha >= 1) return oklchToHex(oklch.l, oklch.c, oklch.h)
    const [r, g, b] = oklchToSrgb(oklch.l, oklch.c, oklch.h)
    return `rgba(${r}, ${g}, ${b}, ${oklch.alpha})`
  }

  const srgb = /^color\(srgb\s+([^)]+)\)/i.exec(value)?.[1]
  if (srgb) {
    const [channels, alphaRaw] = srgb.split('/')
    const [r, g, b] = channels!
      .trim()
      .split(/\s+/)
      .map((v) => Math.round(Math.max(0, Math.min(1, parseFloat(v))) * 255))
    if ([r, g, b].every((v) => Number.isFinite(v))) return `rgba(${r}, ${g}, ${b}, ${parseAlpha(alphaRaw)})`
  }
  return value
}
