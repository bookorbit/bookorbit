import { api } from '@/lib/api'
import type {
  HardcoverAdminSettings,
  HardcoverActiveSyncStatus,
  HardcoverSyncPendingSummary,
  HardcoverSettings,
  HardcoverTokenValidationResult,
  UpsertHardcoverSettingsPayload,
} from '@bookorbit/types'

const BASE = '/api/v1/hardcover'

export async function fetchHardcoverSettings(): Promise<HardcoverSettings> {
  const res = await api(`${BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch Hardcover settings')
  return res.json()
}

export async function upsertHardcoverSettings(payload: UpsertHardcoverSettingsPayload): Promise<HardcoverSettings> {
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

export async function disconnectHardcover(): Promise<void> {
  const res = await api(`${BASE}/settings`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to disconnect Hardcover')
}

export async function validateHardcoverToken(token?: string): Promise<HardcoverTokenValidationResult> {
  const res = await api(`${BASE}/validate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token ? { token } : {}),
  })
  if (!res.ok) throw new Error('Failed to validate token')
  return res.json()
}

export async function startHardcoverSync(): Promise<{ runId: number }> {
  const res = await api(`${BASE}/sync`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message ?? 'Failed to start sync')
  }
  return res.json()
}

export async function cancelHardcoverSync(): Promise<void> {
  await api(`${BASE}/sync`, { method: 'DELETE' })
}

export async function fetchHardcoverSyncStatus(): Promise<HardcoverActiveSyncStatus | null> {
  const res = await api(`${BASE}/sync/status`)
  if (!res.ok) return null
  return res.json()
}

export async function streamHardcoverSyncStatus(onStatus: (status: HardcoverActiveSyncStatus | null) => void, signal?: AbortSignal): Promise<void> {
  const res = await api(`${BASE}/sync/stream`, { signal })
  if (!res.ok || !res.body) throw new Error('Failed to stream Hardcover sync status')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event.split('\n').find((entry) => entry.startsWith('data:'))
      if (!line) continue
      try {
        const payload = JSON.parse(line.slice(5).trim()) as { activeSyncStatus: HardcoverActiveSyncStatus | null }
        onStatus(payload.activeSyncStatus)
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }
}

export async function fetchHardcoverSyncPendingSummary(): Promise<HardcoverSyncPendingSummary> {
  const res = await api(`${BASE}/sync/pending`)
  if (!res.ok) return { totalBooks: 0, pendingBooks: 0 }
  return res.json()
}

export async function fetchHardcoverAdminSettings(): Promise<HardcoverAdminSettings> {
  const res = await api('/api/v1/admin/hardcover/settings')
  if (!res.ok) throw new Error('Failed to fetch admin settings')
  return res.json()
}

export async function setHardcoverFeatureEnabled(enabled: boolean): Promise<void> {
  const res = await api('/api/v1/admin/hardcover/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) throw new Error('Failed to update Hardcover feature flag')
}
