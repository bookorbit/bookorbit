import { describe, expect, it } from 'vitest'
import { entityCount } from '../entity-count'

describe('entityCount', () => {
  it('counts books for a book library', () => {
    expect(entityCount({ type: 'books', bookCount: 7 })).toBe(7)
  })

  it('counts shows for a podcast library, which holds no books', () => {
    expect(entityCount({ type: 'podcasts', bookCount: 0, podcastCount: 3 })).toBe(3)
  })

  it('counts shows for a podcast collection, which discriminates on mediaType not type', () => {
    expect(entityCount({ mediaType: 'podcasts', bookCount: 0, podcastCount: 12 })).toBe(12)
  })

  it('counts episodes for a podcast scope, which reports no book count at all', () => {
    expect(entityCount({ mediaType: 'podcasts', episodeCount: 41 })).toBe(41)
  })

  it('counts books for a book collection and a book scope', () => {
    expect(entityCount({ mediaType: 'books', bookCount: 5, podcastCount: 0 })).toBe(5)
    expect(entityCount({ mediaType: 'books', bookCount: 2 })).toBe(2)
  })

  it('reports no badge rather than a misleading zero when the count is unavailable', () => {
    expect(entityCount({ mediaType: 'podcasts', episodeCount: null })).toBeNull()
    expect(entityCount({ mediaType: 'podcasts' })).toBeNull()
    expect(entityCount({ mediaType: 'books', bookCount: null })).toBeNull()
  })

  it('keeps a genuine zero distinguishable from an absent count', () => {
    expect(entityCount({ mediaType: 'podcasts', podcastCount: 0 })).toBe(0)
    expect(entityCount({ type: 'books', bookCount: 0 })).toBe(0)
  })
})
