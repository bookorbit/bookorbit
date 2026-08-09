import { fetchDiversityScore } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useDiversityScoreWidget() {
  return useWidgetData(fetchDiversityScore)
}
