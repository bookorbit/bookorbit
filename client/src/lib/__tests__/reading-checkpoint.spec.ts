import { describe, expect, it } from 'vitest'
import type { BookReadingSession } from '@bookorbit/types'
import { buildReadingCheckpointRoute, parseReadingCheckpointPercentage, resolveReaderResumeTarget } from '../reading-checkpoint'

function makeSession(overrides: Partial<BookReadingSession> = {}): BookReadingSession {
  return {
    id: 1,
    bookFileId: 17,
    startedAt: '2026-04-15T10:00:00.000Z',
    endedAt: '2026-04-15T10:30:00.000Z',
    durationSeconds: 1800,
    progressDelta: 5,
    endProgress: 42.25,
    format: 'epub',
    source: 'web',
    ...overrides,
  }
}

describe('parseReadingCheckpointPercentage', () => {
  it.each([
    ['0', 0],
    ['42.25', 42.25],
    [' 75 ', 75],
    ['100', 100],
  ])('parses %s', (value, expected) => {
    expect(parseReadingCheckpointPercentage(value)).toBe(expected)
  })

  it.each([undefined, null, '', ' ', [], ['42'], 'NaN', 'Infinity', '-0.1', '100.1'])('rejects invalid checkpoint %j', (value) => {
    expect(parseReadingCheckpointPercentage(value)).toBeNull()
  })
})

describe('resolveReaderResumeTarget', () => {
  it('uses a valid checkpoint instead of the saved CFI and percentage', () => {
    expect(resolveReaderResumeTarget('42.25', 'epubcfi(saved)', 81)).toEqual({
      checkpointPercentage: 42.25,
      cfi: null,
      fraction: 0.4225,
    })
  })

  it('treats a zero checkpoint as an explicit jump to the start', () => {
    expect(resolveReaderResumeTarget('0', 'epubcfi(saved)', 81)).toEqual({
      checkpointPercentage: 0,
      cfi: null,
      fraction: 0,
    })
  })

  it('falls back to saved progress when the checkpoint is invalid', () => {
    expect(resolveReaderResumeTarget('not-a-number', 'epubcfi(saved)', 81)).toEqual({
      checkpointPercentage: null,
      cfi: 'epubcfi(saved)',
      fraction: 0.81,
    })
  })

  it('omits a fallback fraction for unread books', () => {
    expect(resolveReaderResumeTarget(undefined, null, 0)).toEqual({
      checkpointPercentage: null,
      cfi: null,
      fraction: undefined,
    })
  })
})

describe('buildReadingCheckpointRoute', () => {
  it('normalizes the format and preserves raw checkpoint precision', () => {
    expect(buildReadingCheckpointRoute(10, makeSession({ format: ' EPUB ' }))).toEqual({
      name: 'reader',
      params: { bookId: 10, fileId: 17 },
      query: { format: 'epub', checkpoint: '42.25' },
    })
  })

  it.each(['epub', 'mobi', 'azw3', 'azw', 'fb2'])('supports the %s Foliate format', (format) => {
    expect(buildReadingCheckpointRoute(10, makeSession({ format }))).not.toBeNull()
  })

  it.each(['pdf', 'cbz', 'm4b', 'kepub', 'unknown'])('rejects the %s format', (format) => {
    expect(buildReadingCheckpointRoute(10, makeSession({ format }))).toBeNull()
  })
})
