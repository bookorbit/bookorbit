import type { AiJobActionRequest, AiJobActionResponse, AiJobList, AiJobListScope, AiJobListView } from '@bookorbit/types'

import { apiJson, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/ai/jobs'

export interface AiJobListQuery {
  view: AiJobListView
  scope: AiJobListScope
  offset: number
  limit: number
}

export function listAiJobs(query: AiJobListQuery): Promise<AiJobList> {
  const params = new URLSearchParams({ view: query.view, scope: query.scope, offset: String(query.offset), limit: String(query.limit) })
  return apiJson<AiJobList>(`${BASE}?${params.toString()}`, undefined, 'aiArea.activity.loadFailed')
}

export function actOnAiJobs(request: AiJobActionRequest): Promise<AiJobActionResponse> {
  return apiJson<AiJobActionResponse>(`${BASE}/actions`, jsonBody('POST', request), 'aiArea.activity.actionFailed')
}
