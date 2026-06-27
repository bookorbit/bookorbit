import { describe, it, expect } from 'vitest'
import type { LocationQuery } from 'vue-router'
import { annotationsQueryFromState, annotationsStateFromQuery } from '../useAnnotationsUrlSync'
import type { AnnotationsHubState } from '../useAnnotationsHub'

const DEFAULT_STATE: AnnotationsHubState = {
  status: 'active',
  search: '',
  bookFilter: 'all',
  colors: [],
  styleFilter: 'all',
  originFilter: 'all',
  notesOnly: false,
  dateFrom: '',
  dateTo: '',
  sortKey: 'newest',
  page: 1,
}

describe('annotationsStateFromQuery', () => {
  it('parses a full query into hub state', () => {
    const state = annotationsStateFromQuery({
      status: 'trashed',
      search: 'dune',
      bookId: '42',
      colors: '#FACC15,#4ADE80',
      style: 'underline',
      origin: 'koreader',
      notes: '1',
      from: '2026-01-10',
      to: '2026-01-12',
      sort: 'oldest',
      page: '3',
    })

    expect(state).toEqual({
      status: 'trashed',
      search: 'dune',
      bookFilter: 42,
      colors: ['#FACC15', '#4ADE80'],
      styleFilter: 'underline',
      originFilter: 'koreader',
      notesOnly: true,
      dateFrom: '2026-01-10',
      dateTo: '2026-01-12',
      sortKey: 'oldest',
      page: 3,
    })
  })

  it('drops defaults, malformed numbers, and unknown sort keys', () => {
    expect(annotationsStateFromQuery({ status: 'active', bookId: 'abc', sort: 'bogus', page: '1', notes: '0' })).toEqual({})
    expect(annotationsStateFromQuery({ page: '0', bookId: '-2' })).toEqual({})
    expect(annotationsStateFromQuery({})).toEqual({})
  })

  it('takes the first value when a param repeats', () => {
    expect(annotationsStateFromQuery({ search: ['needle', 'other'] }).search).toBe('needle')
  })
})

describe('annotationsQueryFromState', () => {
  it('omits every default value', () => {
    expect(annotationsQueryFromState(DEFAULT_STATE)).toEqual({})
  })

  it('serializes only non-default fields and trims search', () => {
    expect(
      annotationsQueryFromState({
        ...DEFAULT_STATE,
        status: 'trashed',
        search: '  dune  ',
        bookFilter: 42,
        colors: ['#FACC15'],
        notesOnly: true,
        sortKey: 'book-asc',
        page: 2,
      }),
    ).toEqual({
      status: 'trashed',
      search: 'dune',
      bookId: '42',
      colors: '#FACC15',
      notes: '1',
      sort: 'book-asc',
      page: '2',
    })
  })

  it('round-trips through the query string', () => {
    const state: AnnotationsHubState = {
      ...DEFAULT_STATE,
      originFilter: 'web',
      styleFilter: 'invert',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      sortKey: 'book-desc',
      page: 5,
    }
    expect(annotationsStateFromQuery(annotationsQueryFromState(state) as LocationQuery)).toEqual({
      originFilter: 'web',
      styleFilter: 'invert',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      sortKey: 'book-desc',
      page: 5,
    })
  })
})
