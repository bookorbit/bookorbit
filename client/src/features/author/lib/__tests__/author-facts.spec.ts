import { describe, expect, it } from 'vitest'
import type { AuthorDetail } from '@bookorbit/types'
import { authorFactsDraft, authorFactsPayload, isSafeWebsite, normalizeWebsiteInput, parseLifeDateInput, sameFactsDraft } from '../author-facts'

function author(overrides: Partial<AuthorDetail> = {}): AuthorDetail {
  return {
    id: 1,
    name: 'John Reid',
    sortName: null,
    description: null,
    imageUrl: null,
    bookCount: 1,
    lastAddedAt: null,
    birthDate: null,
    birthYear: null,
    deathDate: null,
    deathYear: null,
    website: null,
    genres: [],
    influences: [],
    metadataProvider: null,
    metadataProviderId: null,
    metadataProviderPinned: false,
    ...overrides,
  }
}

describe('parseLifeDateInput', () => {
  it.each([
    ['', { date: null, year: null }],
    ['1965', { date: null, year: 1965 }],
    ['-800', { date: null, year: -800 }],
    [' 1965-03-14 ', { date: '1965-03-14', year: 1965 }],
    ['2024-02-29', { date: '2024-02-29', year: 2024 }],
    ['0065-04-12', { date: '0065-04-12', year: 65 }],
  ])('reads %j', (input, expected) => {
    expect(parseLifeDateInput(input)).toEqual(expected)
  })

  it.each(['1965-02-30', '1965-13-01', '0000-01-01', '14/03/1965', 'March 1965', '12345'])('rejects %j', (input) => {
    expect(parseLifeDateInput(input)).toBeNull()
  })
})

describe('website input', () => {
  it('adds https to a bare host and keeps an explicit scheme', () => {
    expect(normalizeWebsiteInput('johnreid.example')).toBe('https://johnreid.example')
    expect(normalizeWebsiteInput(' http://johnreid.example/about ')).toBe('http://johnreid.example/about')
    expect(normalizeWebsiteInput('   ')).toBeNull()
  })

  it('refuses links that are not http(s) or have no dotted host', () => {
    expect(normalizeWebsiteInput('javascript:alert(1)')).toBeUndefined()
    expect(normalizeWebsiteInput('ftp://johnreid.example')).toBeUndefined()
    expect(normalizeWebsiteInput('localhost')).toBeUndefined()
  })

  it('treats only http(s) as safe to link', () => {
    expect(isSafeWebsite('https://a.example')).toBe(true)
    expect(isSafeWebsite('javascript:alert(1)')).toBe(false)
    expect(isSafeWebsite(null)).toBe(false)
  })
})

describe('authorFactsPayload', () => {
  it('sends nothing when nothing changed, even a value the server would now reject', () => {
    const seeded = authorFactsDraft(author({ website: 'not a url', birthDate: '1950-01-01', birthYear: 1950, genres: ['Journalism'] }))

    expect(authorFactsPayload({ ...seeded }, seeded)).toEqual({ payload: {}, invalid: [] })
  })

  it('sends changed facts, clearing emptied ones', () => {
    const seeded = authorFactsDraft(author({ website: 'https://old.example', birthYear: 1950, genres: ['Journalism'] }))
    const draft = { ...seeded, website: '', born: '1965-03-14', died: '2020', genres: [], influences: ['Alistair MacLean'] }

    expect(authorFactsPayload(draft, seeded)).toEqual({
      payload: {
        website: null,
        birthDate: '1965-03-14',
        birthYear: 1965,
        deathDate: null,
        deathYear: 2020,
        genres: null,
        influences: ['Alistair MacLean'],
      },
      invalid: [],
    })
  })

  it('names every field it could not read', () => {
    const seeded = authorFactsDraft(author())
    const draft = { ...seeded, website: 'javascript:alert(1)', born: 'yesterday', died: '1965-02-30' }

    expect(authorFactsPayload(draft, seeded).invalid).toEqual(['website', 'born', 'died'])
  })

  it('compares drafts field by field', () => {
    const seeded = authorFactsDraft(author({ genres: ['Thriller'] }))
    expect(sameFactsDraft(seeded, authorFactsDraft(author({ genres: ['Thriller'] })))).toBe(true)
    expect(sameFactsDraft(seeded, { ...seeded, genres: ['Thriller', 'Crime'] })).toBe(false)
  })
})
