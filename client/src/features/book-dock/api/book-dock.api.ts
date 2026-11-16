import type {
  BookDockFile,
  BookDockUploadTarget,
  BookDockUploadTargets,
  LibraryDockAdminEntry,
  LibraryDockFilingCheck,
  LibraryDockFilingChecks,
  LibraryDocksAdmin,
  MoveLibraryDockFolderResult,
  UpdateLibraryDockRequest,
} from '@bookorbit/types'
import { api } from '@/lib/api'

export async function refetchBookDockMetadata(fileId: number): Promise<boolean> {
  const response = await api(`/api/v1/book-dock/files/${fileId}/refetch-metadata`, {
    method: 'POST',
  })
  return response.ok
}

export type DockActionResult<T> = { ok: true; data: T } | { ok: false; errorCode: string | null }

/** Sends a dock request and reads the stable error code a refusal carries, if any. */
async function dockRequest<T>(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<DockActionResult<T>> {
  try {
    const response = await api(`/api/v1/book-dock${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (response.ok) {
      const data = response.status === 204 ? undefined : await response.json().catch(() => undefined)
      return { ok: true, data: data as T }
    }
    const error = (await response.json().catch(() => null)) as { errorCode?: unknown } | null
    return { ok: false, errorCode: typeof error?.errorCode === 'string' ? error.errorCode : null }
  } catch {
    return { ok: false, errorCode: null }
  }
}

/** Docks the caller can see and upload into. Any failure reads as "Unsorted only". */
export async function fetchDockUploadTargets(): Promise<BookDockUploadTarget[]> {
  try {
    const response = await api('/api/v1/book-dock/docks')
    if (!response.ok) return []
    return ((await response.json()) as Partial<BookDockUploadTargets>).docks ?? []
  } catch {
    return []
  }
}

export async function fetchLibraryDocksAdmin(): Promise<LibraryDocksAdmin | null> {
  try {
    const response = await api('/api/v1/book-dock/docks/admin')
    return response.ok ? ((await response.json()) as LibraryDocksAdmin) : null
  } catch {
    return null
  }
}

export async function checkLibraryDockFiling(): Promise<LibraryDockFilingCheck[]> {
  const result = await dockRequest<LibraryDockFilingChecks>('/docks/filing-check', 'POST')
  return result.ok ? (result.data?.checks ?? []) : []
}

export function updateLibraryDock(libraryId: number, changes: UpdateLibraryDockRequest) {
  return dockRequest<LibraryDockAdminEntry>(`/docks/${libraryId}`, 'PUT', changes)
}

export function renameLibraryDockFolder(libraryId: number, folderName?: string) {
  return dockRequest<LibraryDockAdminEntry>(`/docks/${libraryId}/rename-folder`, 'POST', folderName === undefined ? {} : { folderName })
}

export function adoptLibraryDockFolder(folderName: string, libraryId: number) {
  return dockRequest<LibraryDockAdminEntry>('/docks/folders/adopt', 'POST', { folderName, libraryId })
}

export function moveLibraryDockFolderToUnsorted(folderName: string) {
  return dockRequest<MoveLibraryDockFolderResult>('/docks/folders/move-to-unsorted', 'POST', { folderName })
}

export function removeLibraryDockFolder(folderName: string) {
  return dockRequest<void>('/docks/folders/remove', 'POST', { folderName })
}

/** A manager's "Keep both" on a duplicate: the file no longer waits on the book it matched. */
export function keepBookDockDuplicate(fileId: number) {
  return dockRequest<BookDockFile>(`/files/${fileId}/keep-both`, 'POST')
}
