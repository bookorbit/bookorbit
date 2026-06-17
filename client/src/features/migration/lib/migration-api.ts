import { api } from '@/lib/api'
import type {
  MigrationRunState as SharedMigrationRunState,
  MigrationSourceApi,
  MigrationSourceCapabilities as SharedMigrationSourceCapabilities,
  MigrationProfileApi,
  MigrationPlanArtifactApi,
  MigrationPlanSummary,
  MigrationRunApi,
  MigrationRunMetricApi,
} from '@bookorbit/types'

export type MigrationRunState = SharedMigrationRunState
export type MigrationSourceCapabilities = SharedMigrationSourceCapabilities
export type MigrationSource = MigrationSourceApi
export type MigrationProfile = MigrationProfileApi
export type MigrationPlanArtifact = MigrationPlanArtifactApi & { summary: MigrationPlanSummary }
export type MigrationRun = MigrationRunApi

export interface MigrationRunMetric extends MigrationRunMetricApi {
  id: number
  runId: number
  createdAt: string
}

export interface MigrationRunProgress {
  run: MigrationRun
  totals: {
    processed: number
    imported: number
    skipped: number
    unresolved: number
    failed: number
  }
  metrics: MigrationRunMetric[]
}

export interface MigrationRunReport {
  run: MigrationRun
  totals: {
    processed: number
    imported: number
    skipped: number
    unresolved: number
    failed: number
  }
  metrics: MigrationRunMetric[]
  plan: Record<string, unknown> | null
  summary: MigrationPlanSummary | null
  details: {
    matchedBooks: Array<{
      sourceBookId: string
      sourceTitle: string | null
      sourceAuthor: string | null
      targetBookId: number
      targetTitle: string | null
      strategy: string
    }>
    unresolvedBooks: Array<{
      sourceBookId: string
      title: string | null
      author: string | null
      reason: string
    }>
    duplicateBookMatches: Array<{
      targetBookId: number
      targetTitle: string | null
      sourceBookIds: string[]
      sourceTitles: Array<string | null>
      strategies: string[]
      reason: string
    }>
    userPreview: Array<{
      sourceUserId: string
      targetUserId: number
      username: string
      counts: {
        statuses: number
        fileProgress: number
        bookmarks: number
        annotations: number
        shelves: number
      }
    }>
  }
}

export interface MigrationWorkflowState {
  active: {
    source: MigrationSource
    profile: MigrationProfile | null
    plan: MigrationPlanArtifact | null
    run: MigrationRun | null
  } | null
  hasActiveRun: boolean
}

export interface PathMappingValidation {
  sourceId: number
  validatedAt: string
  pathMappingsHash: string
  persistedProfileId: number | null
  summary: {
    totalSourceBooks: number
    booksWithFilePath: number
    mappedByPrefix: number
    matchedTargetPaths: number
    unmatchedTargetPaths: number
    unchangedPaths: number
  }
  mappings: Array<{
    sourcePrefix: string
    targetPrefix: string
    affectedBooks: number
    matchedTargetPaths: number
    unmatchedTargetPaths: number
    unmatchedSamples: string[]
  }>
}

export interface MappingSuggestion {
  sourceUserId: string
  username: string
  name: string | null
  email: string | null
  suggestedTargetUserId: number | null
  confidence: 'high' | 'medium' | 'low' | null
  candidates: Array<{
    targetUserId: number
    username: string
    name: string
    email: string | null
    score: number
    confidence: 'high' | 'medium' | 'low'
  }>
}

async function expectJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const payload = await response.json().catch(() => ({}))
  const message =
    payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' ? payload.message : fallbackMessage
  throw new Error(message)
}

export function listSupportedSourceTypes() {
  return api('/api/v1/migration/supported-types').then((res) => expectJson<string[]>(res, 'Failed to load supported migration source types'))
}

export function getWorkflowState() {
  return api('/api/v1/migration/state').then((res) => expectJson<MigrationWorkflowState>(res, 'Failed to load migration state'))
}

export function listTargetUsers() {
  return api('/api/v1/migration/target-users').then((res) =>
    expectJson<Array<{ id: number; username: string; name: string; email: string | null }>>(res, 'Failed to load target users'),
  )
}

export function listSourcePathPrefixes(sourceId: number) {
  return api(`/api/v1/migration/sources/${sourceId}/path-prefixes`).then((res) =>
    expectJson<{ prefixes: string[] }>(res, 'Failed to load source path prefixes'),
  )
}

export function listTargetLibraryFolders() {
  return api('/api/v1/libraries').then(async (res) => {
    if (!res.ok) throw new Error('Failed to load libraries')
    const libs = (await res.json()) as Array<{ id: number; name: string; folders: Array<{ id: number; path: string }> }>
    return libs.flatMap((lib) => lib.folders.map((f) => ({ libraryName: lib.name, path: f.path })))
  })
}

export function createSource(payload: { type: string; name: string; connectionConfig: Record<string, unknown> }) {
  return api('/api/v1/migration/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<MigrationSource>(res, 'Failed to save migration source'))
}

export function testSource(payload: { type: string; connectionConfig: Record<string, unknown> }) {
  return api('/api/v1/migration/sources/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<Record<string, unknown>>(res, 'Failed to test migration source'))
}

export function validateSourceById(sourceId: number) {
  return api(`/api/v1/migration/sources/${sourceId}/validate`, { method: 'POST' }).then((res) =>
    expectJson<Record<string, unknown>>(res, 'Failed to validate migration source'),
  )
}

export async function resetSource(sourceId: number) {
  const res = await api(`/api/v1/migration/sources/${sourceId}`, { method: 'DELETE' })
  if (res.ok) return
  const payload = await res.json().catch(() => ({}))
  const message =
    payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'Failed to reset migration setup'
  throw new Error(message)
}

export function suggestUserMappings(sourceId: number) {
  return api(`/api/v1/migration/sources/${sourceId}/user-mapping-suggestions`).then((res) =>
    expectJson<{ sourceId: number; generatedAt: string; suggestions: MappingSuggestion[] }>(res, 'Failed to load user mapping suggestions'),
  )
}

export function validatePathMappings(
  sourceId: number,
  payload: { pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>; sampleLimit?: number },
) {
  return api(`/api/v1/migration/sources/${sourceId}/path-mappings/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<PathMappingValidation>(res, 'Failed to validate path mappings'))
}

export function createProfile(payload: {
  sourceId: number
  name: string
  userMappings: Array<{ sourceUserId: string; targetUserId: number }>
  pathMappings?: Array<{ sourcePrefix: string; targetPrefix: string }>
  scope?: Record<string, unknown>
}) {
  return api('/api/v1/migration/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<MigrationProfile>(res, 'Failed to save migration profile'))
}

export function createDryRunPlan(payload: { profileId: number; scopeOverride?: Record<string, unknown> }) {
  return api('/api/v1/migration/plans/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<MigrationPlanArtifact>(res, 'Failed to run dry-run plan'))
}

export function resolveDuplicateMatches(artifactId: number, resolutions: Array<{ targetBookId: number; selectedSourceBookId: string }>) {
  return api(`/api/v1/migration/plans/${artifactId}/resolve-duplicates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutions }),
  }).then((res) => expectJson<MigrationPlanArtifact>(res, 'Failed to resolve duplicate matches'))
}

export function startLiveRun(payload: { planArtifactId: number; targetKey?: string }) {
  return api('/api/v1/migration/runs/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((res) => expectJson<MigrationRun>(res, 'Failed to start migration run'))
}

export function getRunProgress(runId: number) {
  return api(`/api/v1/migration/runs/${runId}/progress`).then((res) => expectJson<MigrationRunProgress>(res, 'Failed to load migration run progress'))
}

export function getRunReport(runId: number) {
  return api(`/api/v1/migration/runs/${runId}/report`).then((res) => expectJson<MigrationRunReport>(res, 'Failed to load migration run report'))
}

export async function exportRunReport(runId: number, format: 'json' | 'csv') {
  const res = await api(`/api/v1/migration/runs/${runId}/report/export?format=${format}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || 'Failed to export migration report')
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const fileNameMatch = disposition.match(/filename="?([^"]+)"?/)
  const fileName = fileNameMatch?.[1] ?? `migration-run-${runId}-report.${format}`
  const contentType = res.headers.get('Content-Type') ?? (format === 'csv' ? 'text/csv' : 'application/json')
  const content = await res.text()
  return { format, fileName, contentType, content }
}

export function cancelRun(runId: number) {
  return api(`/api/v1/migration/runs/${runId}/cancel`, { method: 'POST' }).then((res) =>
    expectJson<MigrationRun>(res, 'Failed to cancel migration run'),
  )
}

export function retryRun(runId: number) {
  return api(`/api/v1/migration/runs/${runId}/retry`, { method: 'POST' }).then((res) =>
    expectJson<MigrationRun>(res, 'Failed to retry migration run'),
  )
}
