import { use } from 'echarts/core'
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
import { oklchToHex, parseOklch, readCssColor, toLegacyColor } from '@/lib/css-color'

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

// Staggered hue offsets so adjacent chart series have more contrast.
const HUE_OFFSETS = [0, 72, 144, 216, 288, 36, 108, 180, 252, 324]

/**
 * Theme colours for charts, read from the live tokens. `key` changes whenever any token-affecting
 * appearance setting does, so a computed that holds one of these rebuilds its chart exactly then.
 */
export interface ChartTokens {
  readonly key: string
  readonly dark: boolean
  color(varName: string): string
  palette(chromaScale?: number, lightnessScale?: number): string[]
}

export function createChartTokens(key: string, dark: boolean, read: (varName: string) => string = readCssColor): ChartTokens {
  const colors = new Map<string, string>()

  function color(varName: string): string {
    let value = colors.get(varName)
    if (value === undefined) {
      value = toLegacyColor(read(varName))
      colors.set(varName, value)
    }
    return value
  }

  function palette(chromaScale = 1, lightnessScale = 1): string[] {
    const primary = parseOklch(read('--primary')) ?? { l: dark ? 0.75 : 0.55, c: 0, h: 0, alpha: 1 }
    return HUE_OFFSETS.map((offset) => oklchToHex(primary.l * lightnessScale, primary.c * chromaScale, primary.h + offset))
  }

  return { key, dark, color, palette }
}

export function buildChartTheme(tokens: ChartTokens) {
  const border = tokens.color('--border')
  const axisConfig = {
    axisLine: { show: true, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: { show: true, color: tokens.color('--muted-foreground') },
    splitLine: { show: true, lineStyle: { color: [border] } },
    splitArea: { show: false },
  }

  return {
    color: tokens.palette(),
    backgroundColor: 'transparent',
    legend: { textStyle: { color: tokens.color('--foreground') } },
    tooltip: {
      backgroundColor: tokens.color('--popover'),
      borderColor: border,
      textStyle: { color: tokens.color('--popover-foreground') },
    },
    categoryAxis: axisConfig,
    valueAxis: axisConfig,
    logAxis: axisConfig,
    timeAxis: axisConfig,
  }
}
