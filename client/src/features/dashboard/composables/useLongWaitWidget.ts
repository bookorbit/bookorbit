import { fetchLongWait } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useLongWaitWidget() {
  return useWidgetData(fetchLongWait)
}
