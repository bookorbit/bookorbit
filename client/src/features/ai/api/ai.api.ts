import type {
  AiConnection,
  AiConnectionTestResult,
  AiFeatureId,
  AiModelList,
  AiOverview,
  AiSettings,
  AiSlot,
  AiSlotsUpdateResult,
  AiTryResult,
  AiUsageReport,
  CreateAiConnectionRequest,
  StoryGuideDeleteAllRequest,
  StoryGuideDeleteAllResponse,
  StoryGuideHistory,
  StoryGuideList,
  StoryGuideListDirection,
  StoryGuideListSort,
  StoryGuideSpeedResetRequest,
  StoryGuideSpeedResetResponse,
  StoryGuideSpeeds,
  StoryGuidesSummary,
  TestAiConnectionRequest,
  UpdateAiBudgetRequest,
  UpdateAiConnectionRequest,
  UpdateAiFeatureRequest,
  UpdateAiSlotsRequest,
} from '@bookorbit/types'

import { api } from '@/lib/api'
import { apiError, apiJson, apiSend, jsonBody } from '@/lib/api-json'
import { fileNameFromContentDisposition, triggerBlobDownload } from '@/lib/download'

const BASE = '/api/v1/admin/ai'

export function getOverview(): Promise<AiOverview> {
  return apiJson<AiOverview>(BASE, undefined, 'settings.admin.ai.overview.loadFailed')
}

export function listConnections(): Promise<AiConnection[]> {
  return apiJson<AiConnection[]>(`${BASE}/connections`, undefined, 'settings.admin.ai.connections.loadFailed')
}

export function createConnection(request: CreateAiConnectionRequest): Promise<AiConnection> {
  return apiJson<AiConnection>(`${BASE}/connections`, jsonBody('POST', request), 'settings.admin.ai.sheet.saveFailed')
}

export function updateConnection(id: number, request: UpdateAiConnectionRequest): Promise<AiConnection> {
  return apiJson<AiConnection>(`${BASE}/connections/${id}`, jsonBody('PATCH', request), 'settings.admin.ai.sheet.saveFailed')
}

export function deleteConnection(id: number): Promise<void> {
  return apiSend(`${BASE}/connections/${id}`, { method: 'DELETE' }, 'settings.admin.ai.connections.deleteFailed')
}

export function testDraftConnection(request: TestAiConnectionRequest): Promise<AiConnectionTestResult> {
  return apiJson<AiConnectionTestResult>(`${BASE}/connections/test`, jsonBody('POST', request), 'settings.admin.ai.test.failed')
}

export function testSavedConnection(id: number, model?: string): Promise<AiConnectionTestResult> {
  return apiJson<AiConnectionTestResult>(`${BASE}/connections/${id}/test`, jsonBody('POST', model ? { model } : {}), 'settings.admin.ai.test.failed')
}

export function listModels(id: number): Promise<AiModelList> {
  return apiJson<AiModelList>(`${BASE}/connections/${id}/models`, undefined, 'settings.admin.ai.models.listFailed')
}

export function getSettings(): Promise<AiSettings> {
  return apiJson<AiSettings>(`${BASE}/settings`, undefined, 'settings.admin.ai.models.loadFailed')
}

export function updateSlots(request: UpdateAiSlotsRequest): Promise<AiSlotsUpdateResult> {
  return apiJson<AiSlotsUpdateResult>(`${BASE}/settings/slots`, jsonBody('PUT', request), 'settings.admin.ai.models.saveFailed')
}

export function updateFeature(feature: AiFeatureId, request: UpdateAiFeatureRequest): Promise<AiSettings> {
  return apiJson<AiSettings>(`${BASE}/settings/features/${feature}`, jsonBody('PUT', request), 'settings.admin.ai.features.saveFailed')
}

export function updateBudget(request: UpdateAiBudgetRequest): Promise<AiSettings> {
  return apiJson<AiSettings>(`${BASE}/settings/budget`, jsonBody('PUT', request), 'settings.admin.ai.spending.saveFailed')
}

export function tryModel(slot: AiSlot): Promise<AiTryResult> {
  return apiJson<AiTryResult>(`${BASE}/try`, jsonBody('POST', { slot }), 'settings.admin.ai.models.tryFailed')
}

export function getStoryGuidesSummary(): Promise<StoryGuidesSummary> {
  return apiJson<StoryGuidesSummary>(`${BASE}/features/story-guides`, undefined, 'settings.admin.ai.features.storyGuides.loadFailed')
}

export type DeleteAllStoryGuidesResult = ({ kind: 'deleted' } & StoryGuideDeleteAllResponse) | { kind: 'count-changed'; count: number }

/** A `409` means the number stored changed since the page showed it; nothing was deleted. */
export async function deleteAllStoryGuides(request: StoryGuideDeleteAllRequest): Promise<DeleteAllStoryGuidesResult> {
  const response = await api(`${BASE}/features/story-guides/delete-all`, jsonBody('POST', request))
  if (response.status === 409) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { count?: unknown } | null
    if (typeof body?.count === 'number') return { kind: 'count-changed', count: body.count }
  }
  if (!response.ok) throw await apiError(response, 'settings.admin.ai.features.storyGuides.deleteFailed')
  return { kind: 'deleted', ...((await response.json()) as StoryGuideDeleteAllResponse) }
}

function usageQuery(from?: string, to?: string): string {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function getUsage(from?: string, to?: string): Promise<AiUsageReport> {
  return apiJson<AiUsageReport>(`${BASE}/usage${usageQuery(from, to)}`, undefined, 'settings.admin.ai.usage.loadFailed')
}

/** Fetched with the session's credentials and saved from a blob, since a plain link carries none. */
export async function downloadUsageCsv(from?: string, to?: string): Promise<void> {
  const response = await api(`${BASE}/usage.csv${usageQuery(from, to)}`)
  if (!response.ok) throw await apiError(response, 'settings.admin.ai.usage.exportFailed')
  const filename = fileNameFromContentDisposition(response.headers.get('Content-Disposition'), 'ai-usage.csv')
  triggerBlobDownload(await response.blob(), filename)
}

export function getStoryGuideSpeeds(): Promise<StoryGuideSpeeds> {
  return apiJson<StoryGuideSpeeds>(`${BASE}/features/story-guides/speeds`, undefined, 'settings.admin.ai.features.storyGuides.speeds.loadFailed')
}

export function resetStoryGuideSpeed(request: StoryGuideSpeedResetRequest): Promise<StoryGuideSpeedResetResponse> {
  return apiJson<StoryGuideSpeedResetResponse>(
    `${BASE}/features/story-guides/speeds/reset`,
    jsonBody('POST', request),
    'settings.admin.ai.features.storyGuides.speeds.resetFailed',
  )
}

export interface StoryGuideListQuery {
  q: string
  sort: StoryGuideListSort
  direction: StoryGuideListDirection
  offset: number
  limit: number
}

export function listStoryGuides(query: StoryGuideListQuery): Promise<StoryGuideList> {
  const params = new URLSearchParams({ sort: query.sort, direction: query.direction, offset: String(query.offset), limit: String(query.limit) })
  if (query.q) params.set('q', query.q)
  return apiJson<StoryGuideList>(`${BASE}/features/story-guides/guides?${params.toString()}`, undefined, 'aiArea.storyGuides.list.loadFailed')
}

export function getStoryGuideHistory(): Promise<StoryGuideHistory> {
  return apiJson<StoryGuideHistory>(`${BASE}/features/story-guides/history`, undefined, 'aiArea.storyGuides.overview.loadFailed')
}
