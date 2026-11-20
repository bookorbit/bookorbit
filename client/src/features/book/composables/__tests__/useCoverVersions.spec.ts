import { describe, expect, it } from 'vitest'
import { useCoverVersions } from '../useCoverVersions'

describe('useCoverVersions coverUrl', () => {
  const { coverUrl } = useCoverVersions()

  it('asks the cover route for the screen-sized copy when a page shows the cover large', () => {
    expect(coverUrl(7, 'display', 1700000000000, 'audio')).toBe('/api/v1/books/7/cover?t=1700000000000&medium=audio&size=display')
  })

  it('keeps the full cover and the thumbnail on their own routes, with no size', () => {
    expect(coverUrl(7, 'cover', 1700000000000)).toBe('/api/v1/books/7/cover?t=1700000000000')
    expect(coverUrl(7, 'thumbnail', 1700000000000)).toBe('/api/v1/books/7/thumbnail?t=1700000000000')
  })
})
