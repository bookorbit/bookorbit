import type { KoreaderDevicePoint } from '@bookorbit/types'
import { fetchKoreaderDevices } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderDevicePoint[] = []

export function useKoreaderDevices() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderDevices)
}
