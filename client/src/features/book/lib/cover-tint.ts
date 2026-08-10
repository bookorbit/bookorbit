export type CoverTintTone = {
  hue: number
  saturation: number
}

export type CoverTint = {
  primary: CoverTintTone
  // Covers are usually one colour plus an accent; when that accent is a genuinely
  // different hue the tint carries both, otherwise this stays null and the tint
  // renders as a single wash.
  secondary: CoverTintTone | null
}

const SAMPLE_SIZE = 32

// Near-black and near-white pixels carry no usable hue, and covers are full of
// both (text, borders, letterboxing), so they would otherwise win on count alone.
const MIN_LIGHTNESS = 0.18
const MAX_LIGHTNESS = 0.82

// The winning bucket sets the hue, but its own saturation is clamped: too low
// reads as dirty grey against the card, too high fights the accent colour.
const MIN_SATURATION = 0.35
const MAX_SATURATION = 0.7

// Colours are clustered by hue, not by RGB cube. A cover's dominant colour is
// spread across many shades (shadow, midtone, highlight) that share a hue but
// land in different RGB cells, so cube bucketing splits its vote and lets a
// small flat region of some other colour win.
const HUE_BINS = 36
const BIN_WIDTH = 360 / HUE_BINS

// Pixels are weighted by squared saturation, so a small vivid area outvotes a
// large muddy one. The floor only rejects covers with essentially no colour at
// all: pale covers (a white field with one accent) keep very few pixels once the
// lightness band is applied, and they still deserve their accent.
const MIN_TINT_WEIGHT = 3

// Weight alone cannot tell a small vivid accent from a whole cover of near-grey,
// which sums to the same number. The winning hue also has to be a colour.
const MIN_TINT_SATURATION = 0.1

// A second tone has to be a different colour, not a neighbouring shade of the
// first, and has to hold enough of the cover to be deliberate rather than noise.
const MIN_SECONDARY_HUE_DISTANCE = 40
const MIN_SECONDARY_WEIGHT_RATIO = 0.2

type HueBin = {
  weight: number
  sin: number
  cos: number
  saturation: number
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, lightness]

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === rn) hue = (gn - bn) / delta + (gn < bn ? 6 : 0)
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4

  return [hue * 60, saturation, lightness]
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360
  return raw > 180 ? 360 - raw : raw
}

function samplePixels(image: HTMLImageElement): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    // A cross-origin cover taints the canvas; no tint is better than a crash.
    return null
  }
}

function collectHueBins(pixels: Uint8ClampedArray): HueBin[] {
  const bins: HueBin[] = Array.from({ length: HUE_BINS }, () => ({ weight: 0, sin: 0, cos: 0, saturation: 0 }))

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue
    const [hue, saturation, lightness] = toHsl(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue

    const weight = saturation * saturation
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(hue / BIN_WIDTH))]!
    const radians = (hue * Math.PI) / 180
    bin.weight += weight
    bin.sin += weight * Math.sin(radians)
    bin.cos += weight * Math.cos(radians)
    bin.saturation += weight * saturation
  }

  return bins
}

// Neighbouring bins are folded in so a hue sitting on a bin boundary is not
// split in half, and so the peak reflects a band of colour rather than one slice.
function neighbourhood(bins: HueBin[], index: number): HueBin {
  const merged: HueBin = { weight: 0, sin: 0, cos: 0, saturation: 0 }
  for (const offset of [-1, 0, 1]) {
    const bin = bins[(index + offset + HUE_BINS) % HUE_BINS]!
    merged.weight += bin.weight
    merged.sin += bin.sin
    merged.cos += bin.cos
    merged.saturation += bin.saturation
  }
  return merged
}

function toTone(merged: HueBin): CoverTintTone {
  // Hues are angles, so the average has to be circular: a cover split between
  // 350 and 10 degrees is red, not cyan.
  const hue = ((((Math.atan2(merged.sin, merged.cos) * 180) / Math.PI + 360) % 360) + 0.5) | 0
  const saturation = merged.saturation / merged.weight
  return {
    hue,
    saturation: Math.round(Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, saturation)) * 100),
  }
}

export function extractCoverTint(image: HTMLImageElement): CoverTint | null {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null

  const pixels = samplePixels(image)
  if (!pixels) return null

  const bins = collectHueBins(pixels)
  const ranked = bins.map((_, index) => ({ index, merged: neighbourhood(bins, index) })).sort((a, b) => b.merged.weight - a.merged.weight)

  const best = ranked[0]
  if (!best || best.merged.weight < MIN_TINT_WEIGHT) return null
  if (best.merged.saturation / best.merged.weight < MIN_TINT_SATURATION) return null

  const primary = toTone(best.merged)
  const runnerUp = ranked.find(
    (candidate) =>
      candidate.merged.weight >= best.merged.weight * MIN_SECONDARY_WEIGHT_RATIO &&
      hueDistance(toTone(candidate.merged).hue, primary.hue) >= MIN_SECONDARY_HUE_DISTANCE,
  )

  return { primary, secondary: runnerUp ? toTone(runnerUp.merged) : null }
}

// Only hue and saturation cross into CSS; the gradient fixes lightness and picks
// its own alphas per theme, so one tint composites correctly in light and dark.
export function coverTintVars(tint: CoverTint | null): Record<string, string> | undefined {
  if (!tint) return undefined

  const vars: Record<string, string> = {
    '--cover-tint-hue': String(tint.primary.hue),
    '--cover-tint-saturation': `${tint.primary.saturation}%`,
  }
  if (tint.secondary) {
    vars['--cover-tint-hue-2'] = String(tint.secondary.hue)
    vars['--cover-tint-saturation-2'] = `${tint.secondary.saturation}%`
  }
  return vars
}
