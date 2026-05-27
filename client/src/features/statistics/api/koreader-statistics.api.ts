import { api } from '@/lib/api'
import type {
  KoreaderStatsSummary,
  KoreaderHeatmapPoint,
  KoreaderMonthlyPoint,
  KoreaderHourPoint,
  KoreaderSessionLengthBin,
  KoreaderTopBookItem,
  KoreaderTopAnnotatedItem,
  KoreaderWeekdayPoint,
  KoreaderDevicePoint,
} from '@bookorbit/types'

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`KOReader stats request failed: ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchKoreaderStatsSummary(): Promise<KoreaderStatsSummary> {
  const res = await api('/api/v1/koreader/statistics/summary')
  return parseJson<KoreaderStatsSummary>(res)
}

export async function fetchKoreaderActivityHeatmap(): Promise<KoreaderHeatmapPoint[]> {
  const res = await api('/api/v1/koreader/statistics/heatmap')
  return parseJson<KoreaderHeatmapPoint[]>(res)
}

export async function fetchKoreaderMonthlyReading(): Promise<KoreaderMonthlyPoint[]> {
  const res = await api('/api/v1/koreader/statistics/monthly')
  return parseJson<KoreaderMonthlyPoint[]>(res)
}

export async function fetchKoreaderTimeOfDay(): Promise<KoreaderHourPoint[]> {
  const res = await api('/api/v1/koreader/statistics/time-of-day')
  return parseJson<KoreaderHourPoint[]>(res)
}

export async function fetchKoreaderSessionLengths(): Promise<KoreaderSessionLengthBin[]> {
  const res = await api('/api/v1/koreader/statistics/session-lengths')
  return parseJson<KoreaderSessionLengthBin[]>(res)
}

export async function fetchKoreaderTopBooks(): Promise<KoreaderTopBookItem[]> {
  const res = await api('/api/v1/koreader/statistics/top-books')
  return parseJson<KoreaderTopBookItem[]>(res)
}

export async function fetchKoreaderTopAnnotated(): Promise<KoreaderTopAnnotatedItem[]> {
  const res = await api('/api/v1/koreader/statistics/top-annotated')
  return parseJson<KoreaderTopAnnotatedItem[]>(res)
}

export async function fetchKoreaderWeeklyRhythm(): Promise<KoreaderWeekdayPoint[]> {
  const res = await api('/api/v1/koreader/statistics/weekly-rhythm')
  return parseJson<KoreaderWeekdayPoint[]>(res)
}

export async function fetchKoreaderDevices(): Promise<KoreaderDevicePoint[]> {
  const res = await api('/api/v1/koreader/statistics/devices')
  return parseJson<KoreaderDevicePoint[]>(res)
}
