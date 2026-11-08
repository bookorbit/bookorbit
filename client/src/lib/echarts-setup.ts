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
