import { describe, expect, it } from 'vitest'
import { authorProviderLabel, authorProviderSourceUrl, candidateLifeYears, parseAuthorProviderReference } from '../author-metadata-match'

describe('parseAuthorProviderReference', () => {
  it.each([
    ['https://www.goodreads.com/author/show/1234567.John_Reid', '1234567'],
    ['goodreads.com/author/show/1234567-john-reid?from_search=true', '1234567'],
    ['https://www.goodreads.com/en/author/show/42', '42'],
    ['https://www.goodreads.com/author/list/42.John_Reid', '42'],
    ['  1234567  ', '1234567'],
  ])('reads %s as a Goodreads id', (input, providerId) => {
    expect(parseAuthorProviderReference(input)).toEqual({ provider: 'goodreads', providerId })
  })

  it.each([
    ['https://www.audible.com/author/John-Reid/B001H6UH2C', 'B001H6UH2C'],
    ['https://www.audible.co.uk/author/B001H6UH2C?ref=a_search', 'B001H6UH2C'],
    ['https://api.audnex.us/authors/B001H6UH2C', 'B001H6UH2C'],
    ['b001h6uh2c', 'B001H6UH2C'],
  ])('reads %s as an Audible ASIN', (input, providerId) => {
    expect(parseAuthorProviderReference(input)).toEqual({ provider: 'audnexus', providerId })
  })

  it.each(['', '   ', 'John Reid', 'https://www.goodreads.com/book/show/123', 'https://example.com/author/show/123', 'B12'])(
    'does not recognise %j',
    (input) => {
      expect(parseAuthorProviderReference(input)).toBeNull()
    },
  )
})

describe('author provider helpers', () => {
  it('labels known providers and passes unknown keys through', () => {
    expect(authorProviderLabel('goodreads')).toBe('Goodreads')
    expect(authorProviderLabel('audnexus')).toBe('Audnexus')
    expect(authorProviderLabel('openlibrary')).toBe('openlibrary')
  })

  it('builds the provider page for an id', () => {
    expect(authorProviderSourceUrl('goodreads', '42')).toBe('https://www.goodreads.com/author/show/42')
    expect(authorProviderSourceUrl('audnexus', 'B001H6UH2C')).toBe('https://www.audible.com/author/B001H6UH2C')
    expect(authorProviderSourceUrl('openlibrary', 'OL1A')).toBeNull()
  })

  it('takes life years from the year or, failing that, the date', () => {
    expect(candidateLifeYears({ provider: 'goodreads', providerId: '1', name: 'A', birthDate: '1929-10-21', deathYear: 2018 })).toEqual({
      born: 1929,
      died: 2018,
    })
    expect(candidateLifeYears({ provider: 'audnexus', providerId: 'B1', name: 'A' })).toEqual({ born: null, died: null })
  })
})
