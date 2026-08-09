import { fetchLibraryOverview } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useLibraryOverviewWidget() {
  return useWidgetData(fetchLibraryOverview)
}
