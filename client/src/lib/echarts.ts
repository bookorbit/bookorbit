import { use, registerTheme } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import {
  BarChart,
  BoxplotChart,
  ChordChart,
  CustomChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  SunburstChart,
  TreemapChart,
} from 'echarts/charts'
import {
  CalendarComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { ACCENT_IDS, type Accent } from '@bookorbit/types'
import { ACCENT_HUE, ACCENT_PRIMARY, DEFAULT_ACCENT, resolveAccent } from '@/lib/theme-accent-meta'

// SVG renderer: events fire on real DOM elements, not via canvas hit-test.
// This eliminates the cursor-flicker / hover-disappear bug that canvas
// hit-test coordinate mismatches cause with this layout.
use([
  SVGRenderer,
  PieChart,
  BarChart,
  ChordChart,
  CustomChart,
  LineChart,
  FunnelChart,
  GaugeChart,
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
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
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

const THEME_MODES: ProjectxThemeMode[] = ['light', 'dark']
// Staggered hue offsets so adjacent chart series have more contrast.
const HUE_OFFSETS = [0, 72, 144, 216, 288, 36, 108, 180, 252, 324]

export function oklchToHex(L: number, C: number, H: number): string {
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

export function getThemePalette(mode: ProjectxThemeMode, accent: string, chromaScale = 1, lightnessScale = 1): string[] {
  const resolvedAccent = resolveAccent(accent)
  const def = ACCENT_PRIMARY[resolvedAccent]
  const dark = mode === 'dark'
  const L = (dark ? def[2] : def[0]) * lightnessScale
  const C = (dark ? def[3] : def[1]) * chromaScale
  const H = ACCENT_HUE[resolvedAccent]
  return HUE_OFFSETS.map((off) => oklchToHex(L, C, H + off))
}

function buildTheme(accent: Accent, dark: boolean) {
  const def = ACCENT_PRIMARY[accent]
  const L = dark ? def[2] : def[0]
  const C = dark ? def[3] : def[1]
  const H = ACCENT_HUE[accent]

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

export function getBookorbitThemeName(mode: ProjectxThemeMode = 'dark', accent: string = DEFAULT_ACCENT): string {
  const resolvedAccent = resolveAccent(accent)
  return `bookorbit-${mode}-${resolvedAccent}`
}

export function initChartThemes(): void {
  if (themeRegistered) return
  for (const mode of THEME_MODES) {
    for (const accent of ACCENT_IDS) {
      registerTheme(getBookorbitThemeName(mode, accent), buildTheme(accent, mode === 'dark'))
    }
  }
  themeRegistered = true
}
