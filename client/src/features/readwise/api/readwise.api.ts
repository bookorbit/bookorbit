import { api } from '@/lib/api'
import type { ReadwiseSettings, ReadwiseTokenValidationResult, UpsertReadwiseSettingsPayload } from '@bookorbit/types'

const BASE = '/api/v1/readwise'

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}))
  return (body as { message?: string }).message ?? fallback
}

export async function fetchReadwiseSettings(): Promise<ReadwiseSettings> {
  const res = await api(`${BASE}/settings`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to fetch Readwise settings'))
  return res.json()
}

export async function upsertReadwiseSettings(payload: UpsertReadwiseSettingsPayload): Promise<ReadwiseSettings> {
  const res = await api(`${BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Failed to save settings'))
  }
  return res.json()
}

export async function validateReadwiseToken(token?: string): Promise<ReadwiseTokenValidationResult> {
  const res = await api(`${BASE}/validate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token ? { token } : {}),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to validate token'))
  return res.json()
}
