import { describe, expect, it } from 'vitest'
import { resolveCandidateDisplayTitle } from './metadata-fetch'

describe('resolveCandidateDisplayTitle', () => {
  it('prefers displayTitle when the candidate provides one', () => {
    expect(resolveCandidateDisplayTitle({ title: 'The Origin', displayTitle: 'Series Name #12.5 - The Origin' })).toBe(
      'Series Name #12.5 - The Origin',
    )
  })

  it('falls back to title when displayTitle is absent', () => {
    expect(resolveCandidateDisplayTitle({ title: 'The Way of Kings', displayTitle: undefined })).toBe('The Way of Kings')
  })

  it('uses displayTitle when the candidate has no title, as an unnamed comic issue does', () => {
    expect(resolveCandidateDisplayTitle({ title: undefined, displayTitle: 'Series Name #7' })).toBe('Series Name #7')
  })

  it('returns undefined when the candidate has neither', () => {
    expect(resolveCandidateDisplayTitle({ title: undefined, displayTitle: undefined })).toBeUndefined()
  })
})
