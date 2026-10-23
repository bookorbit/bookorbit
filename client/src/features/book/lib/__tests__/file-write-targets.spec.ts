// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookFileWriteStatus } from '@bookorbit/types'

import { findFileWriteTarget, writableFieldsByFormat } from '../file-write-targets'

const MIXED: BookFileWriteStatus = {
  enabled: true,
  reason: null,
  writableFormats: ['epub', 'm4b'],
  writableFields: ['title', 'isbn13', 'narrators'],
  targets: [
    { fileId: 1, format: 'epub', writable: true, reason: null, writableFields: ['title', 'isbn13'] },
    { fileId: 2, format: 'm4b', writable: true, reason: null, writableFields: ['title', 'narrators'] },
    { fileId: 3, format: 'epub', writable: false, reason: 'file_exceeds_size_limit', writableFields: [] },
    { fileId: 4, format: 'pdf', writable: false, reason: 'not_content_file', writableFields: [] },
  ],
}

describe('findFileWriteTarget', () => {
  it('returns the server verdict for a file', () => {
    expect(findFileWriteTarget(MIXED, 2)).toMatchObject({ writable: true })
    expect(findFileWriteTarget(MIXED, 3)).toMatchObject({ writable: false, reason: 'file_exceeds_size_limit' })
  })

  it('treats a file the server did not consider as no target', () => {
    expect(findFileWriteTarget(MIXED, 99)).toBeNull()
    expect(findFileWriteTarget({ ...MIXED, targets: undefined }, 1)).toBeNull()
    expect(findFileWriteTarget(undefined, 1)).toBeNull()
  })
})

describe('writableFieldsByFormat', () => {
  it('groups the fields of writable files by format, leaving skipped files out', () => {
    expect(writableFieldsByFormat(MIXED)).toEqual([
      { format: 'epub', fields: ['title', 'isbn13'] },
      { format: 'm4b', fields: ['title', 'narrators'] },
    ])
  })

  it('returns nothing when write-back is off', () => {
    expect(writableFieldsByFormat({ enabled: false, reason: 'library_disabled', writableFormats: [], writableFields: [] })).toEqual([])
  })
})
