import { api } from '@/lib/api'

export type MigrationRunState = 'draft' | 'preflight_failed' | 'dry_run_ready' | 'running' | 'failed' | 'completed'

export interface MigrationSourceCapabilities {
  sourceType: string
  sourceVersion: string | null
  missingTables: string[]
  warnings: string[]
  counts: Record<string, number>
}

export interface MigrationSource {
  id: number
  type: string
  name: string
  connectionConfig: Record<string, unknown>
  capabilities: MigrationSourceCapabilities | null
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MigrationProfile {
  id: number
  sourceId: number
  name: string
  userMappings: Array<{ sourceUserId: string; targetUserId: number }>
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>
  scope: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface MigrationPlanArtifact {
  id: number
  sourceId: number
  profileId: number
  plan: Record<string, unknown>
  summary: {
    generatedAt?: string
    status?: string
    matchedBooks?: number
    unresolvedBooks?: number
    duplicateBookMatches?: number
    unresolvedByReason?: Record<string, number>
    mappedUsers?: number
    perUserPreview?: Array<{ sourceUserId: string; targetUserId: number; username: string; counts: Record<string, number> }>
  }
  createdAt: string
  updatedAt: string
}

export interface MigrationRun {
  id: number
  sourceId: number
  profileId: number
  planArtifactId: number | null
  state: MigrationRunState
  currentStage: string | null
  startedAt: string | null
  endedAt: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface MigrationRunMetric {
  id: number
  runId: number
  stage: string
  entityType: string
  processed: number
  imported: number
  skipped: number
  unresolved: number
  failed: number
  createdAt: string
  updatedAt: string
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
  metrics: MigrationRunMetric[]
  plan: Record<string, unknown> | null
  summary: MigrationPlanArtifact['summary'] | null
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

export function exportRunReport(runId: number, format: 'json' | 'csv') {
  return api(`/api/v1/migration/runs/${runId}/report/export?format=${format}`).then((res) =>
    expectJson<{ format: 'json' | 'csv'; fileName: string; contentType: string; content: string }>(res, 'Failed to export migration report'),
  )
}
