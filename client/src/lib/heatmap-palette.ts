import { readCssColor } from '@/lib/echarts'

type Rgb = {
  r: number
  g: number
  b: number
}

let colorParserContext: CanvasRenderingContext2D | null = null

export interface HeatmapPalette {
  axisColor: string
  borderColor: string
  tooltipBackground: string
  tooltipBorder: string
  tooltipText: string
  seriesColor: string
  scale: string[]
}

interface BuildHeatmapPaletteOptions {
  theme: 'light' | 'dark'
  profile?: 'soft' | 'github'
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseRgb(color: string): Rgb | null {
  const match = color.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!match) return null
  const channels = match[1]
  if (!channels) return null
  const parts = channels.split(',').map((part) => Number.parseFloat(part.trim()))
  const r = parts[0] ?? Number.NaN
  const g = parts[1] ?? Number.NaN
  const b = parts[2] ?? Number.NaN
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return { r, g, b }
}

function parseHex(color: string): Rgb | null {
  const normalized = color.trim().replace(/^#/, '')
  if (!/^[\da-f]{3}$|^[\da-f]{6}$/i.test(normalized)) return null
  const hex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => `${c}${c}`)
          .join('')
      : normalized
  const value = Number.parseInt(hex, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function parseViaCanvas(color: string): Rgb | null {
  if (typeof document === 'undefined') return null
  if (!colorParserContext) {
    const canvas = document.createElement('canvas')
    colorParserContext = canvas.getContext('2d')
  }
  if (!colorParserContext) return null
  try {
    colorParserContext.fillStyle = '#000000'
    colorParserContext.fillStyle = color
  } catch {
    return null
  }
  const normalized = String(colorParserContext.fillStyle)
  return parseRgb(normalized) ?? parseHex(normalized)
}

function parseColor(color: string): Rgb | null {
  return parseRgb(color) ?? parseHex(color) ?? parseViaCanvas(color)
}

function rgbString(color: Rgb): string {
  return `rgb(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)})`
}

function rgbaString(color: Rgb, alpha: number): string {
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${alpha})`
}

function resolveCssColor(rawValue: string, fallback: string): Rgb {
  const value = rawValue.trim() || fallback
  const probe = document.createElement('span')
  probe.style.color = value
  probe.style.position = 'absolute'
  probe.style.pointerEvents = 'none'
  probe.style.opacity = '0'
  document.body.appendChild(probe)
  const resolved = window.getComputedStyle(probe).color
  probe.remove()
  return parseColor(resolved) ?? parseColor(fallback) ?? { r: 100, g: 116, b: 139 }
}

function withAlpha(color: string, alpha: number): string {
  if (alpha <= 0) return 'transparent'
  if (alpha >= 1) return color

  const parsed = parseColor(color)
  if (parsed) return rgbaString(parsed, alpha)

  const pct = Math.round(alpha * 1000) / 10
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

export function buildHeatmapPalette({ theme, profile = 'soft' }: BuildHeatmapPaletteOptions): HeatmapPalette {
  const rootStyle = window.getComputedStyle(document.documentElement)
  const isDark = theme === 'dark'

  const axis = resolveCssColor(rootStyle.getPropertyValue('--muted-foreground'), isDark ? 'rgb(163, 172, 189)' : 'rgb(100, 116, 139)')
  const border = resolveCssColor(rootStyle.getPropertyValue('--border'), isDark ? 'rgb(52, 64, 84)' : 'rgb(226, 232, 240)')
  const borderRaw = readCssColor('--border')
  const card = resolveCssColor(rootStyle.getPropertyValue('--card'), isDark ? 'rgb(30, 41, 59)' : 'rgb(255, 255, 255)')
  const seriesBase = readCssColor('--primary')
  const foreground = resolveCssColor(rootStyle.getPropertyValue('--foreground'), isDark ? 'rgb(241, 245, 249)' : 'rgb(15, 23, 42)')

  let scale: string[]

  if (profile === 'github') {
    // 0% should reveal the chart surface. 100% should match --primary exactly.
    scale = [
      withAlpha(seriesBase, 0),
      withAlpha(seriesBase, isDark ? 0.35 : 0.28),
      withAlpha(seriesBase, isDark ? 0.56 : 0.45),
      withAlpha(seriesBase, isDark ? 0.78 : 0.66),
      withAlpha(seriesBase, 1),
    ]
  } else {
    scale = [
      withAlpha(seriesBase, 0),
      withAlpha(seriesBase, isDark ? 0.2 : 0.16),
      withAlpha(seriesBase, isDark ? 0.38 : 0.3),
      withAlpha(seriesBase, isDark ? 0.6 : 0.5),
      withAlpha(seriesBase, 1),
    ]
  }

  return {
    axisColor: rgbString(axis),
    borderColor: borderRaw,
    tooltipBackground: rgbaString(card, isDark ? 0.96 : 0.98),
    tooltipBorder: rgbaString(border, isDark ? 0.75 : 0.9),
    tooltipText: rgbString(foreground),
    seriesColor: seriesBase,
    scale,
  }
}
