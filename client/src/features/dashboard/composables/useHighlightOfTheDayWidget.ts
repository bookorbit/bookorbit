import { fetchHighlightOfTheDay } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useHighlightOfTheDayWidget() {
  return useWidgetData(fetchHighlightOfTheDay)
}
