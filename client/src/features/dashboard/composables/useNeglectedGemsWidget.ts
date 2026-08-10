import { fetchNeglectedGems } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useNeglectedGemsWidget() {
  return useWidgetData(fetchNeglectedGems)
}
