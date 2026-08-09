import { fetchReadingDna } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useReadingDnaWidget() {
  return useWidgetData(fetchReadingDna)
}
