import type { JobActionRequest, JobActionResponse, JobList, JobScope, JobType, JobView } from '@bookorbit/types'

import { apiJson, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/jobs'

export interface JobListQuery {
  view: JobView
  type: JobType | null
  scope: JobScope
  cursor: string | null
  limit: number
  counts: boolean
}

export function listJobs(query: JobListQuery): Promise<JobList> {
  const params = new URLSearchParams({ view: query.view, scope: query.scope, limit: String(query.limit) })
  if (query.type) params.set('type', query.type)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.counts) params.set('counts', '1')
  return apiJson<JobList>(`${BASE}?${params.toString()}`, undefined, 'jobsArea.loadFailed')
}

export function actOnJobs(request: JobActionRequest): Promise<JobActionResponse> {
  return apiJson<JobActionResponse>(`${BASE}/actions`, jsonBody('POST', request), 'jobsArea.actionFailed')
}
