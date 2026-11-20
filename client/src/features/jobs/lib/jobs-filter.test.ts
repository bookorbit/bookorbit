import { describe, expect, it } from 'vitest'

import { jobsFilterFromQuery, jobsFilterQuery } from './jobs-filter'

describe('jobs filter in the address', () => {
  it('reads a view, a type and a scope', () => {
    expect(jobsFilterFromQuery({ view: 'history', type: 'bulk-run', scope: 'everyone' })).toEqual({
      view: 'history',
      type: 'bulk-run',
      scope: 'everyone',
    })
  })

  it('falls back to the default for missing or unknown values', () => {
    expect(jobsFilterFromQuery({})).toEqual({ view: 'queue', type: null, scope: 'mine' })
    expect(jobsFilterFromQuery({ view: 'archive', type: 'time-machine', scope: ['nobody'] })).toEqual({ view: 'queue', type: null, scope: 'mine' })
    expect(jobsFilterFromQuery({ view: ['failed', 'history'], type: null })).toEqual({ view: 'failed', type: null, scope: 'mine' })
  })

  it('leaves the defaults out of the address', () => {
    expect(jobsFilterQuery({ view: 'queue', type: null, scope: 'mine' })).toEqual({})
    expect(jobsFilterQuery({ view: 'failed', type: 'bulk-run' })).toEqual({ view: 'failed', type: 'bulk-run' })
    expect(jobsFilterQuery({ scope: 'everyone' })).toEqual({ scope: 'everyone' })
  })
})
