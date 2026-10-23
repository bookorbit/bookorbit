// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookFileRef } from '@bookorbit/types'

import { formatsFor, kindleAccepts, planFile, sendableFiles, sizeLimitExceeded } from '../email-files'

const MB = 1024 * 1024
const EPUB: BookFileRef = { id: 1, format: 'epub', role: 'primary', sizeBytes: 2 * MB }
const PDF: BookFileRef = { id: 2, format: 'pdf', role: 'content', sizeBytes: 9 * MB }
const NARRATED = { id: 3, format: 'epub', role: 'content', sizeBytes: 180 * MB, mediaOverlay: { available: true } } as BookFileRef
const M4B: BookFileRef = { id: 4, format: 'm4b', role: 'content', sizeBytes: 400 * MB }

const plain = { deviceType: null, preferredFormat: null, readAloudDelivery: null }

describe('email file rules', () => {
  it('offers a Kindle only the formats Amazon takes by email', () => {
    expect(formatsFor('kindle')).toEqual(['epub', 'pdf'])
    expect(formatsFor(null)).toContain('azw3')
    expect(formatsFor(null)).toContain('djvu')
    expect(kindleAccepts('djvu')).toBe(false)
    expect(kindleAccepts('EPUB')).toBe(true)
    expect(kindleAccepts('mobi')).toBe(false)
  })

  it('never offers audiobook tracks as an attachment', () => {
    expect(sendableFiles([M4B, EPUB, PDF]).map((f) => f.id)).not.toContain(4)
  })
})

describe('planFile', () => {
  it('sends the primary when the recipient has no preference', () => {
    expect(planFile([EPUB, PDF], plain, null)).toEqual({ file: EPUB, missingFormat: null, readAlong: false })
  })

  it('sends the preferred format, and names it when the book lacks it', () => {
    expect(planFile([EPUB, PDF], { ...plain, preferredFormat: 'pdf' }, null)?.file).toBe(PDF)
    expect(planFile([EPUB], { ...plain, preferredFormat: 'pdf' }, null)).toEqual({ file: EPUB, missingFormat: 'pdf', readAlong: false })
  })

  it('lets an explicit choice win over the recipient', () => {
    expect(planFile([EPUB, PDF], { ...plain, preferredFormat: 'epub' }, 'pdf')?.file).toBe(PDF)
  })

  it('skips the narrated copy unless the recipient asked for originals', () => {
    expect(planFile([NARRATED, EPUB], plain, null)?.file).toBe(EPUB)
    expect(planFile([NARRATED, EPUB], { ...plain, readAloudDelivery: 'original' }, null)).toEqual({
      file: NARRATED,
      missingFormat: null,
      readAlong: true,
    })
  })

  it('never gives a Kindle the narrated copy', () => {
    expect(planFile([NARRATED, EPUB], { deviceType: 'kindle', preferredFormat: null, readAloudDelivery: 'original' }, null)?.file).toBe(EPUB)
  })

  it('has nothing to plan for a book with no files', () => {
    expect(planFile([], plain, null)).toBeNull()
  })
})

describe('sizeLimitExceeded', () => {
  it('puts the Kindle limit ahead of the mail server', () => {
    expect(sizeLimitExceeded(60 * MB, 'kindle', 'smtp.gmail.com')).toBe('kindle')
  })

  it('knows Gmail refuses attachments over 25 MB', () => {
    expect(sizeLimitExceeded(30 * MB, null, 'smtp.gmail.com')).toBe('gmail')
    expect(sizeLimitExceeded(30 * MB, null, 'smtp.fastmail.com')).toBeNull()
    expect(sizeLimitExceeded(20 * MB, null, 'smtp.gmail.com')).toBeNull()
  })

  it('stays quiet when the size is unknown', () => {
    expect(sizeLimitExceeded(null, 'kindle', 'smtp.gmail.com')).toBeNull()
  })
})
