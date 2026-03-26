import { use, registerTheme } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import {
  BarChart,
  BoxplotChart,
  ChordChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  SunburstChart,
  TreemapChart,
} from 'echarts/charts'
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  PolarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'

// SVG renderer: events fire on real DOM elements, not via canvas hit-test.
// This eliminates the cursor-flicker / hover-disappear bug that canvas
// hit-test coordinate mismatches cause with this layout.
use([
  SVGRenderer,
  PieChart,
  BarChart,
  ChordChart,
  LineChart,
  FunnelChart,
  HeatmapChart,
  BoxplotChart,
  SunburstChart,
  ScatterChart,
  TreemapChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  PolarComponent,
])

let themeRegistered = false

export function readCssColor(varName: string): string {
  const el = document.createElement('span')
  el.style.color = `var(${varName})`
  document.body.appendChild(el)
  const color = getComputedStyle(el).color
  el.remove()
  return color
}

type ProjectxThemeMode = 'light' | 'dark'

// --primary oklch(L C H) per accent, sourced from accents.css.
// [lightL, lightC, darkL, darkC] — hue is always the tint-h value.
type PrimaryDef = [lightL: number, lightC: number, darkL: number, darkC: number]
const ACCENT_PRIMARY: Record<string, PrimaryDef> = {
  white: [0.2, 0, 0.985, 0],
  grey: [0.55, 0, 0.75, 0],
  rose: [0.57, 0.24, 0.73, 0.2],
  orange: [0.64, 0.22, 0.78, 0.18],
  amber: [0.72, 0.17, 0.82, 0.17],
  yellow: [0.75, 0.18, 0.84, 0.16],
  lime: [0.64, 0.2, 0.77, 0.18],
  green: [0.527, 0.18, 0.72, 0.18],
  emerald: [0.52, 0.17, 0.72, 0.15],
  teal: [0.52, 0.18, 0.74, 0.16],
  cyan: [0.52, 0.2, 0.75, 0.17],
  sky: [0.54, 0.21, 0.75, 0.18],
  blue: [0.487, 0.25, 0.72, 0.2],
  indigo: [0.51, 0.26, 0.72, 0.22],
  violet: [0.491, 0.27, 0.72, 0.23],
  fuchsia: [0.56, 0.27, 0.75, 0.22],
  pink: [0.56, 0.26, 0.75, 0.22],
  coral: [0.6, 0.12, 0.76, 0.1],
  peach: [0.63, 0.11, 0.78, 0.09],
  butter: [0.66, 0.13, 0.8, 0.11],
  lemon: [0.7, 0.12, 0.82, 0.1],
  celadon: [0.61, 0.1, 0.76, 0.08],
  sage: [0.52, 0.1, 0.72, 0.09],
  mint: [0.6, 0.1, 0.75, 0.09],
  seafoam: [0.61, 0.09, 0.76, 0.08],
  powder: [0.59, 0.1, 0.75, 0.09],
  mist: [0.56, 0.1, 0.74, 0.09],
  periwinkle: [0.54, 0.11, 0.73, 0.1],
  wisteria: [0.55, 0.1, 0.73, 0.09],
  lavender: [0.55, 0.11, 0.73, 0.1],
  orchid: [0.56, 0.11, 0.74, 0.1],
  blush: [0.54, 0.11, 0.73, 0.1],
}

const ACCENT_HUE: Record<string, number> = {
  white: 0,
  grey: 0,
  rose: 15,
  orange: 42,
  amber: 70,
  yellow: 95,
  lime: 118,
  green: 142,
  emerald: 162,
  teal: 180,
  cyan: 197,
  sky: 213,
  blue: 263,
  indigo: 276,
  violet: 292,
  fuchsia: 312,
  pink: 328,
  coral: 25,
  peach: 38,
  butter: 80,
  lemon: 100,
  celadon: 122,
  sage: 142,
  mint: 158,
  seafoam: 178,
  powder: 205,
  mist: 218,
  periwinkle: 265,
  wisteria: 285,
  lavender: 300,
  orchid: 315,
  blush: 345,
}

const THEME_MODES: ProjectxThemeMode[] = ['light', 'dark']
const DEFAULT_ACCENT = 'blue'

// Staggered hue offsets so adjacent chart series have more contrast.
const HUE_OFFSETS = [0, 72, 144, 216, 288, 36, 108, 180, 252, 324]

function oklchToHex(L: number, C: number, H: number): string {
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
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  }
  return (
    '#' +
    [lr, lg, lb]
      .map((v) =>
        Math.round(toSrgb(v) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

export function getThemePalette(mode: ProjectxThemeMode, accent: string): string[] {
  const resolvedAccent = accent in ACCENT_PRIMARY ? accent : DEFAULT_ACCENT
  const def = ACCENT_PRIMARY[resolvedAccent]!
  const dark = mode === 'dark'
  const L = dark ? def[2] : def[0]
  const C = dark ? def[3] : def[1]
  const H = ACCENT_HUE[resolvedAccent]!
  return HUE_OFFSETS.map((off) => oklchToHex(L, C, H + off))
}

function buildTheme(accent: string, dark: boolean) {
  const def = ACCENT_PRIMARY[accent] ?? ACCENT_PRIMARY[DEFAULT_ACCENT]!
  const L = dark ? def[2] : def[0]
  const C = dark ? def[3] : def[1]
  const H = ACCENT_HUE[accent] ?? ACCENT_HUE[DEFAULT_ACCENT]!

  const colors = HUE_OFFSETS.map((off) => oklchToHex(L, C, H + off))

  const border = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)'
  const axisLabel = dark ? '#9CA3AF' : '#6B7280'
  const axisConfig = {
    axisLine: { show: true, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: { show: true, color: axisLabel },
    splitLine: { show: true, lineStyle: { color: [border] } },
    splitArea: { show: false },
  }

  return {
    color: colors,
    backgroundColor: 'transparent',
    legend: { textStyle: { color: dark ? '#F3F4F6' : '#111827' } },
    tooltip: {
      backgroundColor: dark ? '#1F2937' : '#FFFFFF',
      borderColor: border,
      textStyle: { color: dark ? '#F9FAFB' : '#111827' },
    },
    categoryAxis: axisConfig,
    valueAxis: axisConfig,
    logAxis: axisConfig,
    timeAxis: axisConfig,
  }
}

export function getProjectxThemeName(mode: ProjectxThemeMode = 'dark', accent: string = DEFAULT_ACCENT): string {
  const resolvedAccent = accent in ACCENT_PRIMARY ? accent : DEFAULT_ACCENT
  return `projectx-${mode}-${resolvedAccent}`
}

export function initChartThemes(): void {
  if (themeRegistered) return
  for (const mode of THEME_MODES) {
    for (const accent of Object.keys(ACCENT_PRIMARY)) {
      registerTheme(getProjectxThemeName(mode, accent), buildTheme(accent, mode === 'dark'))
    }
  }
  themeRegistered = true
}
