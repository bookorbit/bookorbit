import { JOB_SCOPES, JOB_TYPES, JOB_VIEWS, type JobScope, type JobType, type JobView } from '@bookorbit/types'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

/** What the Jobs page shows, kept in its address so a link can open a view, a type or a scope. */
export interface JobsFilter {
  view: JobView
  type: JobType | null
  scope: JobScope
}

export const DEFAULT_JOBS_FILTER: Readonly<JobsFilter> = { view: 'queue', type: null, scope: 'mine' }

function first(value: LocationQuery[string] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function member<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((entry) => entry === value) ?? null
}

/** Reads the filter from the address; anything unknown falls back to the default. */
export function jobsFilterFromQuery(query: LocationQuery): JobsFilter {
  return {
    view: member(JOB_VIEWS, first(query.view)) ?? DEFAULT_JOBS_FILTER.view,
    type: member(JOB_TYPES, first(query.type)),
    scope: member(JOB_SCOPES, first(query.scope)) ?? DEFAULT_JOBS_FILTER.scope,
  }
}

/** The address for a filter, leaving out what matches the default. */
export function jobsFilterQuery(filter: Partial<JobsFilter>): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (filter.view && filter.view !== DEFAULT_JOBS_FILTER.view) query.view = filter.view
  if (filter.type) query.type = filter.type
  if (filter.scope && filter.scope !== DEFAULT_JOBS_FILTER.scope) query.scope = filter.scope
  return query
}
