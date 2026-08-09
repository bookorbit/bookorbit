import { fetchReadingGoal } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useReadingGoalWidget() {
  return useWidgetData(fetchReadingGoal)
}
