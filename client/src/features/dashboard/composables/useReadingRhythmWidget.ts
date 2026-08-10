import { fetchReadingRhythm } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

export function useReadingRhythmWidget() {
  return useWidgetData(fetchReadingRhythm)
}
