// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FontUploadError } from '@/features/reader/epub/composables/useCustomFonts'
import { outcomeOfError, refusalMessageKey } from '../upload-outcome'

describe('outcomeOfError', () => {
  it('reads a duplicate as already on the server, naming the face it duplicates', () => {
    const err = new FontUploadError('This font file has already been uploaded', 409, 'FONT_DUPLICATE', {
      familyName: 'Literata',
      weight: 400,
      style: 'italic',
    })

    expect(outcomeOfError(err)).toEqual({
      state: 'duplicate',
      face: { familyName: 'Literata', weight: 400, style: 'italic' },
      code: 'FONT_DUPLICATE',
      meta: { familyName: 'Literata', weight: 400, style: 'italic' },
    })
  })

  it('reads a coded refusal as refused, keeping its parameters for the message', () => {
    const err = new FontUploadError('Maximum of 200 server fonts reached', 400, 'FONT_LIMIT_REACHED', { limit: 200 })

    expect(outcomeOfError(err)).toMatchObject({ state: 'refused', code: 'FONT_LIMIT_REACHED', meta: { limit: 200 } })
  })

  it('reads a bare 413 from the HTTP layer as too large', () => {
    expect(outcomeOfError(new FontUploadError('Request file too large', 413))).toMatchObject({ state: 'refused', code: 'FONT_TOO_LARGE' })
  })

  it('treats an uncoded refusal from an older server as a plain failure', () => {
    expect(outcomeOfError(new FontUploadError('This font file has already been uploaded', 409))).toMatchObject({ state: 'failed', code: null })
  })

  it('ignores a code it does not know rather than trusting it', () => {
    expect(outcomeOfError(new FontUploadError('Nope', 400, 'SOMETHING_NEW'))).toMatchObject({ state: 'failed', code: null })
  })

  it('treats a network error as a failure', () => {
    expect(outcomeOfError(new TypeError('Failed to fetch'))).toMatchObject({ state: 'failed', face: null })
  })
})

describe('refusalMessageKey', () => {
  it('gives every code its own reason and falls back for the rest', () => {
    expect(refusalMessageKey('FONT_INVALID_FILE')).toBe('settings.admin.serverFonts.upload.reasons.invalidFile')
    expect(refusalMessageKey(null)).toBe('settings.admin.serverFonts.upload.reasons.failed')
  })
})
