import { fetchReadingStreak } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useReadingStreakWidget() {
  return useWidgetData(fetchReadingStreak)
}
