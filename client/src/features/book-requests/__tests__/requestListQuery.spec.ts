// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_LIST_STATE, listStateToQuery, parseListQuery, withoutListQuery } from '../requestListQuery'

describe('request list query', () => {
  it('reads every part of the list back out of the URL', () => {
    const state = parseListQuery(
      {
        view: 'hidden',
        q: ' ghost ',
        status: 'failed',
        format: 'audiobook',
        requester: '7',
        approval: 'skipped',
        sort: 'title',
        dir: 'desc',
        page: '3',
      },
      true,
    )
    expect(state).toEqual({
      view: 'hidden',
      q: 'ghost',
      status: 'failed',
      format: 'audiobook',
      requester: 7,
      approval: 'skipped',
      sort: 'title',
      dir: 'desc',
      page: 3,
    })
  })

  it('falls back to the defaults for anything unknown', () => {
    expect(parseListQuery({ view: 'nope', status: 'lost', sort: 'colour', page: '-2', requester: 'x' }, true)).toEqual(DEFAULT_LIST_STATE)
  })

  it('ignores a requester on the personal list, which the server refuses', () => {
    expect(parseListQuery({ requester: '7' }, false).requester).toBe('')
  })

  it('writes only what differs from the defaults', () => {
    expect(listStateToQuery(DEFAULT_LIST_STATE)).toEqual({})
    expect(listStateToQuery({ ...DEFAULT_LIST_STATE, sort: 'title', dir: 'asc', view: 'needs_action', page: 2 })).toEqual({
      sort: 'title',
      view: 'needs_action',
      page: '2',
    })
  })

  it('round-trips through the URL', () => {
    const state = { ...DEFAULT_LIST_STATE, q: 'dune', approval: 'needed' as const, dir: 'asc' as const }
    expect(parseListQuery(listStateToQuery(state), true)).toEqual(state)
  })

  it('leaves the rest of the query alone', () => {
    expect(withoutListQuery({ tab: 'all', view: 'hidden', search: 'dune', page: '2' })).toEqual({ tab: 'all', search: 'dune' })
  })
})
