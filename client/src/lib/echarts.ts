import { use, registerTheme } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { BarChart, BoxplotChart, FunnelChart, HeatmapChart, LineChart, PieChart, SunburstChart } from 'echarts/charts'
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
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
  LineChart,
  FunnelChart,
  HeatmapChart,
  BoxplotChart,
  SunburstChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkAreaComponent,
])

export function readCssColor(varName: string): string {
  const el = document.createElement('span')
  el.style.color = `var(${varName})`
  document.body.appendChild(el)
  const color = getComputedStyle(el).color
  el.remove()
  return color
}

function buildTheme() {
  const border = readCssColor('--border')
  const mutedFg = readCssColor('--muted-foreground')
  const axisConfig = {
    axisLine: { show: true, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: { show: true, color: mutedFg },
    splitLine: { show: true, lineStyle: { color: [border] } },
    splitArea: { show: false },
  }
  return {
    color: [
      readCssColor('--chart-1'),
      readCssColor('--chart-2'),
      readCssColor('--chart-3'),
      readCssColor('--chart-4'),
      readCssColor('--chart-5'),
      readCssColor('--chart-6'),
      readCssColor('--chart-7'),
      readCssColor('--chart-8'),
      readCssColor('--chart-9'),
      readCssColor('--chart-10'),
    ],
    backgroundColor: 'transparent',
    legend: { textStyle: { color: readCssColor('--foreground') } },
    tooltip: {
      backgroundColor: readCssColor('--card'),
      borderColor: border,
      textStyle: { color: readCssColor('--card-foreground') },
    },
    categoryAxis: axisConfig,
    valueAxis: axisConfig,
    logAxis: axisConfig,
    timeAxis: axisConfig,
  }
}

export function initChartThemes(version: number = 0): void {
  registerTheme(`projectx-v${version}`, buildTheme())
}
