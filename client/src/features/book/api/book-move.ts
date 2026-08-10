import { api } from '@/lib/api'
import type { BookMoveCollisionOverride, BookMoveJobCollisionPolicy, BookMovePreviewResult, BookSelectionPayload } from '@bookorbit/types'

export async function fetchMovePreview(
  selection: BookSelectionPayload,
  targetLibraryId: number,
  targetFolderId: number,
  signal?: AbortSignal,
): Promise<BookMovePreviewResult> {
  const res = await api('/api/v1/books/move/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, targetLibraryId, targetFolderId }),
    signal,
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export function executeMove(
  body: {
    selection: BookSelectionPayload
    targetLibraryId: number
    targetFolderId: number
    collisionPolicy: BookMoveJobCollisionPolicy
    overrides?: BookMoveCollisionOverride[]
  },
  signal?: AbortSignal,
): Promise<Response> {
  return api('/api/v1/books/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(', ')
    if (body.message) return body.message
  } catch {
    // Fall through to the status code below.
  }
  return `HTTP ${res.status}`
}
