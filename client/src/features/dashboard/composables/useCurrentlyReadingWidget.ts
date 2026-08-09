import { fetchCurrentlyReading } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useCurrentlyReadingWidget() {
  return useWidgetData(fetchCurrentlyReading)
}
