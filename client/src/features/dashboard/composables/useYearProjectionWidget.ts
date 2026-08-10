import { fetchYearProjection } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useYearProjectionWidget() {
  return useWidgetData(fetchYearProjection)
}
