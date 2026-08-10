import { fetchMonthlyChallenge } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useMonthlyChallengeWidget() {
  return useWidgetData(fetchMonthlyChallenge)
}
