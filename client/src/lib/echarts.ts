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

const PROJECTX_THEME_NAME = 'projectx'
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

const ACCENT_HUE_BY_ID: Record<string, number> = {
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

function normalizeHue(value: number): number {
  const mod = value % 360
  return mod < 0 ? mod + 360 : mod
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(normalizeHue(h))}, ${s}%, ${l}%)`
}

function buildSeriesPalette(baseHue: number, dark: boolean): string[] {
  const offsets = [0, 72, 144, 216, 288, 36, 108, 180, 252, 324]
  const sat = dark ? [74, 70, 68, 72, 74, 68, 66, 64, 68, 70] : [68, 64, 62, 66, 68, 62, 60, 58, 62, 64]
  const light = dark ? [64, 62, 60, 66, 64, 48, 46, 44, 50, 47] : [56, 54, 52, 58, 56, 42, 40, 38, 44, 41]
  return offsets.map((offset, index) => hsl(baseHue + offset, sat[index] ?? sat[0] ?? 68, light[index] ?? light[0] ?? 56))
}

function buildAxisConfig(dark: boolean) {
  const axisLine = dark ? '#374151' : '#D1D5DB'
  const axisLabel = dark ? '#9CA3AF' : '#6B7280'
  const splitLine = dark ? '#2A3441' : '#E5E7EB'
  return {
    axisLine: { show: true, lineStyle: { color: axisLine } },
    axisTick: { show: false },
    axisLabel: { show: true, color: axisLabel },
    splitLine: { show: true, lineStyle: { color: [splitLine] } },
    splitArea: { show: false },
  }
}

function buildTheme(baseHue: number, dark: boolean) {
  const axisConfig = buildAxisConfig(dark)
  return {
    color: buildSeriesPalette(baseHue, dark),
    backgroundColor: 'transparent',
    legend: { textStyle: { color: dark ? '#F3F4F6' : '#111827' } },
    tooltip: {
      backgroundColor: dark ? '#1F2937' : '#FFFFFF',
      borderColor: dark ? '#374151' : '#D1D5DB',
      textStyle: { color: dark ? '#F9FAFB' : '#111827' },
    },
    categoryAxis: axisConfig,
    valueAxis: axisConfig,
    logAxis: axisConfig,
    timeAxis: axisConfig,
  }
}

export function getProjectxThemeName(mode: ProjectxThemeMode = 'dark', accent: string = DEFAULT_ACCENT): string {
  const resolvedAccent = accent in ACCENT_HUE_BY_ID ? accent : DEFAULT_ACCENT
  return `${PROJECTX_THEME_NAME}-${mode}-${resolvedAccent}`
}

export function initChartThemes(): void {
  if (themeRegistered) return
  const accents = Object.keys(ACCENT_HUE_BY_ID)
  for (const mode of THEME_MODES) {
    for (const accent of accents) {
      const hue = ACCENT_HUE_BY_ID[accent] ?? ACCENT_HUE_BY_ID[DEFAULT_ACCENT] ?? 263
      registerTheme(getProjectxThemeName(mode, accent), buildTheme(hue, mode === 'dark'))
    }
  }
  themeRegistered = true
}
