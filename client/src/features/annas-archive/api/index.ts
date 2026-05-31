import { api } from '@/lib/api'

export interface AnnasArchiveSearchResult {
  md5: string
  title: string
  author?: string
  format?: string
  filesize?: string
  language?: string
  url: string
}

export type AnnasArchiveDownloadStatus = 'pending' | 'fetching_links' | 'downloading' | 'completed' | 'failed'

export interface AnnasArchiveDownloadJob {
  id: string
  md5: string
  filename: string
  destPath: string
  status: AnnasArchiveDownloadStatus
  startedAt: string
  completedAt?: string
  totalBytes?: number
  downloadedBytes?: number
  error?: string
}

export async function searchAnnasArchive(q: string, ext?: string, lang?: string): Promise<AnnasArchiveSearchResult[]> {
  const params = new URLSearchParams({ q })
  if (ext) params.set('ext', ext)
  if (lang) params.set('lang', lang)
  const res = await api(`/api/v1/annas-archive/search?${params}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

export async function startDownload(payload: {
  md5: string
  libraryId: number
  folderId?: number
  filename: string
}): Promise<AnnasArchiveDownloadJob> {
  const res = await api('/api/v1/annas-archive/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  return res.json()
}

export async function getDownloadJob(id: string): Promise<AnnasArchiveDownloadJob> {
  const res = await api(`/api/v1/annas-archive/downloads/${id}`)
  if (!res.ok) throw new Error(`Failed to get job: ${res.status}`)
  return res.json()
}

export async function listDownloadJobs(): Promise<AnnasArchiveDownloadJob[]> {
  const res = await api('/api/v1/annas-archive/downloads')
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`)
  return res.json()
}

export async function getActiveDomains(): Promise<string[]> {
  const res = await api('/api/v1/annas-archive/domains')
  if (!res.ok) throw new Error(`Failed to get domains: ${res.status}`)
  return res.json()
}

export async function refreshDomains(): Promise<void> {
  await api('/api/v1/annas-archive/domains/refresh', { method: 'POST' })
}
