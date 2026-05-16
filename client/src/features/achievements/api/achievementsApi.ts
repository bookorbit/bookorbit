import type { AchievementCatalogueResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

export async function fetchAchievements(): Promise<AchievementCatalogueResponse> {
  const res = await api('/api/v1/achievements')
  if (!res.ok) throw new Error('Failed to fetch achievements')
  return res.json()
}
