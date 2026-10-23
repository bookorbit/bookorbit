// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { UploadErrorCode } from '@bookorbit/types'
import { i18n } from '@/i18n'
import en from '@/locales/en.json'
import { describeUploadFailure, isRetryableUploadFailure, type BookDockUploadFailure, type UploadFailureReason } from '../upload-failure'

const MB = 1024 * 1024

function server(overrides: Partial<Extract<BookDockUploadFailure, { kind: 'server' }>> = {}): BookDockUploadFailure {
  return { kind: 'server', status: 500, errorCode: null, message: null, fromBookOrbit: true, ...overrides }
}

function render(reason: UploadFailureReason): string {
  if ('text' in reason) return reason.text
  return i18n.global.t(reason.key, reason.params ?? {})
}

function hasSourceMessage(key: string): boolean {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

describe('describeUploadFailure', () => {
  it('names the rejected extension', () => {
    expect(render(describeUploadFailure({ kind: 'unsupported', extension: 'docx' }))).toBe('Unsupported file type: .docx')
  })

  it('explains a file without any extension instead of printing a bare dot', () => {
    expect(render(describeUploadFailure({ kind: 'unsupported', extension: '' }))).toBe('The file has no extension, so its format is unknown')
  })

  it('formats the client-side limit as a localized size', () => {
    expect(render(describeUploadFailure({ kind: 'tooLarge', limitBytes: 500 * MB }))).toBe('Larger than the 500 MB upload limit')
    expect(render(describeUploadFailure({ kind: 'tooLarge', limitBytes: 4096 * MB }))).toBe('Larger than the 4 GB upload limit')
  })

  it('reports a network failure', () => {
    expect(render(describeUploadFailure({ kind: 'network' }))).toBe('Could not reach the server')
  })

  it('translates the upload error codes the server sends', () => {
    expect(
      render(describeUploadFailure(server({ status: 413, errorCode: UploadErrorCode.TooLarge, message: 'File exceeds the 1 MB upload limit' }))),
    ).toBe('Larger than the server upload limit')
    expect(render(describeUploadFailure(server({ status: 507, errorCode: UploadErrorCode.StorageFull, message: 'no space' })))).toBe(
      'The server is out of storage space',
    )
  })

  it('treats an uncoded 413 from BookOrbit as its own limit', () => {
    expect(render(describeUploadFailure(server({ status: 413, message: 'request file too large' })))).toBe('Larger than the server upload limit')
  })

  it('blames a reverse proxy for a 413 that did not come from BookOrbit', () => {
    expect(render(describeUploadFailure(server({ status: 413, fromBookOrbit: false })))).toBe(
      'Rejected as too large before it reached BookOrbit, likely by a reverse proxy',
    )
  })

  it('shows the server message when no translated reason fits', () => {
    expect(describeUploadFailure(server({ status: 500, message: 'EACCES: permission denied' }))).toEqual({ text: 'EACCES: permission denied' })
  })

  it('falls back to the status when the response carried no message', () => {
    expect(render(describeUploadFailure(server({ status: 502, fromBookOrbit: false })))).toBe('Upload failed (HTTP 502)')
  })

  it('ignores an error code it has no translation for', () => {
    expect(describeUploadFailure(server({ status: 409, errorCode: 'SOMETHING_NEW', message: 'Already there' }))).toEqual({ text: 'Already there' })
  })

  it('only returns keys that exist in the English source catalog', () => {
    const failures: BookDockUploadFailure[] = [
      { kind: 'unsupported', extension: 'txt' },
      { kind: 'unsupported', extension: '' },
      { kind: 'tooLarge', limitBytes: MB },
      { kind: 'network' },
      server({ status: 413, errorCode: UploadErrorCode.TooLarge }),
      server({ status: 507, errorCode: UploadErrorCode.StorageFull }),
      server({ status: 413, fromBookOrbit: false }),
      server({ status: 418 }),
    ]
    const missing = failures.map(describeUploadFailure).filter((reason) => !('key' in reason) || !hasSourceMessage(reason.key))
    expect(missing).toEqual([])
  })
})

describe('isRetryableUploadFailure', () => {
  it.each<[string, BookDockUploadFailure, boolean]>([
    ['network failure', { kind: 'network' }, true],
    ['server error', server({ status: 500 }), true],
    ['proxy gateway error', server({ status: 502, fromBookOrbit: false }), true],
    ['request timeout', server({ status: 408 }), true],
    ['rate limit', server({ status: 429 }), true],
    ['expired session', server({ status: 401 }), true],
    ['full disk', server({ status: 507, errorCode: UploadErrorCode.StorageFull }), true],
    ['unsupported extension', { kind: 'unsupported', extension: 'docx' }, false],
    ['over the client limit', { kind: 'tooLarge', limitBytes: MB }, false],
    ['over the server limit', server({ status: 413, errorCode: UploadErrorCode.TooLarge }), false],
    ['over a proxy limit', server({ status: 413, fromBookOrbit: false }), false],
    ['bad request', server({ status: 400 }), false],
    ['forbidden', server({ status: 403 }), false],
    ['conflict', server({ status: 409 }), false],
  ])('%s', (_label, failure, expected) => {
    expect(isRetryableUploadFailure(failure)).toBe(expected)
  })
})
