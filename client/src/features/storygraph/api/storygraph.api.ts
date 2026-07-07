import { api } from '@/lib/api'
import type {
  StorygraphActiveSyncStatus,
  StorygraphBookSyncNowResult,
  StorygraphBookSyncState,
  StorygraphSyncFailure,
  StorygraphSyncPendingSummary,
  StorygraphSettings,
  StorygraphCookieValidationResult,
  StorygraphEdition,
  StorygraphLinkedBook,
  StorygraphLinkResult,
  UpdateStorygraphBookSyncPayload,
  UpsertStorygraphSettingsPayload,
} from '@bookorbit/types'

const BASE = '/api/v1/storygraph'

export async function fetchStorygraphSettings(): Promise<StorygraphSettings> {
  const res = await api(`${BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch StoryGraph settings')
  return res.json()
}

export async function upsertStorygraphSettings(payload: UpsertStorygraphSettingsPayload): Promise<StorygraphSettings> {
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

export async function disconnectStorygraph(): Promise<void> {
  const res = await api(`${BASE}/settings`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to disconnect StoryGraph')
}

export async function validateStorygraphCookies(sessionCookie?: string, rememberToken?: string): Promise<StorygraphCookieValidationResult> {
  const res = await api(`${BASE}/validate-cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionCookie && rememberToken ? { sessionCookie, rememberToken } : {}),
  })
  if (!res.ok) throw new Error('Failed to validate cookies')
  return res.json()
}

export async function startStorygraphSync(): Promise<{ runId: number }> {
  const res = await api(`${BASE}/sync`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message ?? 'Failed to start sync')
  }
  return res.json()
}

export async function cancelStorygraphSync(): Promise<void> {
  await api(`${BASE}/sync`, { method: 'DELETE' })
}

export async function fetchStorygraphSyncStatus(): Promise<StorygraphActiveSyncStatus | null> {
  const res = await api(`${BASE}/sync/status`)
  if (!res.ok) return null
  return res.json()
}

export async function streamStorygraphSyncStatus(onStatus: (status: StorygraphActiveSyncStatus | null) => void, signal?: AbortSignal): Promise<void> {
  const res = await api(`${BASE}/sync/stream`, { signal })
  if (!res.ok || !res.body) throw new Error('Failed to stream StoryGraph sync status')

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
        const payload = JSON.parse(line.slice(5).trim()) as { activeSyncStatus: StorygraphActiveSyncStatus | null }
        onStatus(payload.activeSyncStatus)
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }
}

export async function fetchStorygraphSyncFailures(): Promise<StorygraphSyncFailure[]> {
  const res = await api(`${BASE}/sync/failures`)
  if (!res.ok) throw new Error('Failed to fetch StoryGraph sync failures')
  return res.json()
}

export async function fetchStorygraphSyncPendingSummary(): Promise<StorygraphSyncPendingSummary> {
  const res = await api(`${BASE}/sync/pending`)
  if (!res.ok) return { totalBooks: 0, pendingBooks: 0 }
  return res.json()
}

export async function rematchStorygraphBook(bookId: number): Promise<{ result: 'synced' | 'skipped' | 'failed' }> {
  const res = await api(`${BASE}/books/${bookId}/rematch`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to re-match with StoryGraph')
  return res.json()
}

export async function fetchStorygraphBookSyncState(bookId: number): Promise<StorygraphBookSyncState> {
  const res = await api(`${BASE}/books/${bookId}/sync-state`)
  if (!res.ok) throw new Error('Failed to fetch StoryGraph sync state')
  return res.json()
}

export async function updateStorygraphBookSyncState(bookId: number, payload: UpdateStorygraphBookSyncPayload): Promise<StorygraphBookSyncState> {
  const res = await api(`${BASE}/books/${bookId}/sync-state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update StoryGraph sync state')
  return res.json()
}

export async function startStorygraphBookSync(bookId: number): Promise<StorygraphBookSyncNowResult> {
  const res = await api(`${BASE}/books/${bookId}/sync`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to sync StoryGraph book')
  return res.json()
}

export async function fetchStorygraphLinkedBooks(): Promise<StorygraphLinkedBook[]> {
  const res = await api(`${BASE}/books`)
  if (!res.ok) return []
  return res.json()
}

export async function linkStorygraphBook(bookId: number, input: string): Promise<StorygraphLinkResult> {
  const res = await api(`${BASE}/books/${bookId}/link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) throw new Error('Failed to link StoryGraph book')
  return res.json()
}

export async function fetchStorygraphEditions(bookId: number): Promise<StorygraphEdition[]> {
  const res = await api(`${BASE}/books/${bookId}/editions`)
  if (!res.ok) return []
  return res.json()
}

export async function setStorygraphEdition(bookId: number, editionId: string): Promise<{ success: boolean }> {
  const res = await api(`${BASE}/books/${bookId}/edition`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editionId }),
  })
  if (!res.ok) throw new Error('Failed to set StoryGraph edition')
  return res.json()
}
