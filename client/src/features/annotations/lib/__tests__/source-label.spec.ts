import { describe, expect, it } from 'vitest'
import { annotationSourceKey } from '../source-label'

describe('annotationSourceKey', () => {
  it('names highlights made in the browser or the phone apps BookOrbit, and devices by their own name', () => {
    expect(annotationSourceKey('web')).toBe('annotations.sources.bookorbit')
    expect(annotationSourceKey('kobo')).toBe('annotations.sources.kobo')
    expect(annotationSourceKey('koreader')).toBe('annotations.sources.koreader')
  })
})
