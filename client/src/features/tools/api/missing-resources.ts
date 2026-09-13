import type {
  BrokenCoverEntry,
  CoverSweep,
  MissingBookEntry,
  MissingResourceCleanupRequest,
  MissingResourceCleanupResult,
  MissingResourcePage,
  MissingResourcesSummary,
  OrphanedCoverDirEntry,
} from '@bookorbit/types'

import { api } from '@/lib/api'

const BASE = '/api/v1/maintenance/missing-resources'

async function expectJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) throw new Error(fallbackMessage)
  return response.json() as Promise<T>
}

function pageQuery(params: { page: number; pageSize: number }): string {
  return new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) }).toString()
}

export async function getMissingResourcesSummary(): Promise<MissingResourcesSummary> {
  return expectJson(await api(BASE), 'missing_resources_summary_failed')
}

export async function getCoverSweep(): Promise<CoverSweep | null> {
  return expectJson(await api(`${BASE}/sweep`), 'missing_resources_sweep_failed')
}

export async function startCoverSweep(): Promise<CoverSweep> {
  return expectJson(await api(`${BASE}/sweep`, { method: 'POST' }), 'missing_resources_sweep_start_failed')
}

export async function getMissingBooks(params: { page: number; pageSize: number }): Promise<MissingResourcePage<MissingBookEntry>> {
  return expectJson(await api(`${BASE}/books?${pageQuery(params)}`), 'missing_resources_list_failed')
}

export async function getBrokenCovers(params: { page: number; pageSize: number }): Promise<MissingResourcePage<BrokenCoverEntry>> {
  return expectJson(await api(`${BASE}/broken-covers?${pageQuery(params)}`), 'missing_resources_list_failed')
}

export async function getOrphanedCoverDirs(params: { page: number; pageSize: number }): Promise<MissingResourcePage<OrphanedCoverDirEntry>> {
  return expectJson(await api(`${BASE}/orphaned-covers?${pageQuery(params)}`), 'missing_resources_list_failed')
}

async function clean(path: string, payload: MissingResourceCleanupRequest): Promise<MissingResourceCleanupResult> {
  const response = await api(`${BASE}/${path}/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return expectJson(response, 'missing_resources_clean_failed')
}

export async function cleanMissingBooks(payload: MissingResourceCleanupRequest): Promise<MissingResourceCleanupResult> {
  return clean('books', payload)
}

export async function cleanBrokenCovers(payload: MissingResourceCleanupRequest): Promise<MissingResourceCleanupResult> {
  return clean('broken-covers', payload)
}

export async function cleanOrphanedCoverDirs(payload: MissingResourceCleanupRequest): Promise<MissingResourceCleanupResult> {
  return clean('orphaned-covers', payload)
}
