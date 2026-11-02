import { describe, expect, it } from 'vitest'
import { entityCount } from '../entity-count'

describe('entityCount', () => {
  it('counts books', () => {
    expect(entityCount({ bookCount: 7 })).toBe(7)
  })

  it('reports no badge rather than a misleading zero when the count is unavailable', () => {
    expect(entityCount({ bookCount: null })).toBeNull()
    expect(entityCount({})).toBeNull()
  })

  it('keeps a genuine zero distinguishable from an absent count', () => {
    expect(entityCount({ bookCount: 0 })).toBe(0)
  })
})
