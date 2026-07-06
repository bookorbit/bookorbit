import { api } from '@/lib/api'
import type { ReadwiseSettings, ReadwiseTokenValidationResult, UpsertReadwiseSettingsPayload } from '@bookorbit/types'

const BASE = '/api/v1/readwise'

export async function fetchReadwiseSettings(): Promise<ReadwiseSettings> {
  const res = await api(`${BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch Readwise settings')
  return res.json()
}

export async function upsertReadwiseSettings(payload: UpsertReadwiseSettingsPayload): Promise<ReadwiseSettings> {
  const res = await api(`${BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message ?? 'Failed to save settings')
  }
  return res.json()
}

export async function validateReadwiseToken(token?: string): Promise<ReadwiseTokenValidationResult> {
  const res = await api(`${BASE}/validate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token ? { token } : {}),
  })
  if (!res.ok) throw new Error('Failed to validate token')
  return res.json()
}
