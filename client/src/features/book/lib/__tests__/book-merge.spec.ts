import { describe, expect, it } from 'vitest'
import { BOOK_MERGE_MAX_BOOKS } from '@bookorbit/types'
import { mergeBook, mergeField, mergeFile, mergePreview } from '@/features/book/components/merge/__tests__/fixtures'
import {
  blockerAlternative,
  describePreviewChanges,
  destinationAvoidsBlocker,
  mergeLibraryNames,
  splitMergeFiles,
  isBlankMergeValue,
  mergeBookLabels,
  mergeDisabledReason,
  mergedSourceIds,
  recommendMergeKeeper,
  sourceOutcomes,
} from '../book-merge'

const withDetail = (title: string, detail: string) => `${title} [${detail}]`

describe('mergeDisabledReason', () => {
  it.each([
    [{ queryScoped: true, count: 2, allEditable: true }, 'queryScoped'],
    [{ queryScoped: false, count: 1, allEditable: true }, 'tooFew'],
    [{ queryScoped: false, count: 3, allEditable: false }, 'notEditable'],
    [{ queryScoped: false, count: BOOK_MERGE_MAX_BOOKS + 1, allEditable: true }, 'tooMany'],
    [{ queryScoped: false, count: BOOK_MERGE_MAX_BOOKS, allEditable: true }, null],
  ])('%o gives %s', (options, reason) => {
    expect(mergeDisabledReason(options)).toBe(reason)
  })
})

describe('blockerAlternative', () => {
  it('points blockers at the way out they suggest', () => {
    expect(blockerAlternative('TARGET_NOT_PRESENT')).toBe('chooseKeeper')
    expect(blockerAlternative('DIFFERENT_LIBRARIES')).toBe('link')
    expect(blockerAlternative('PATH_CONFLICT')).toBeNull()
  })

  it.each([
    'BOTH_HAVE_AUDIO',
    'FILE_PER_BOOK_LIBRARY',
    'FOLDER_NOT_WRITABLE',
    'FORMAT_NOT_ALLOWED',
    'PATH_EXCLUDED',
    'LEFTOVER_CONTENT',
    'READERS_LOSE_ACCESS',
  ] as const)('offers Link for %s', (code) => {
    expect(blockerAlternative(code)).toBe('link')
  })
})

describe('isBlankMergeValue', () => {
  it('treats empty strings and lists as blank but not false or zero', () => {
    expect([null, '', '  ', [], ['', ' ']].map(isBlankMergeValue)).toEqual([true, true, true, true, true])
    expect([false, 0, 'x', ['a']].map(isBlankMergeValue)).toEqual([false, false, false, false])
  })
})

describe('mergeBookLabels', () => {
  it('adds the folder or formats only where titles repeat', () => {
    const labels = mergeBookLabels(
      [
        mergeBook(1, { title: 'Dune', folderRelPath: 'Frank Herbert/Dune (1965)' }),
        mergeBook(2, { title: 'dune', folderRelPath: null, formats: ['epub', 'pdf'] }),
        mergeBook(3, { title: 'Arrakis' }),
        mergeBook(4, { title: '  ' }),
      ],
      'Untitled',
      withDetail,
    )
    expect(labels.get(1)).toBe('Dune [Dune (1965)]')
    expect(labels.get(2)).toMatch(/^dune \[EPUB.*PDF\]$/)
    expect(labels.get(3)).toBe('Arrakis')
    expect(labels.get(4)).toBe('Untitled')
  })
})

describe('recommendMergeKeeper', () => {
  it('keeps the most complete present record', () => {
    const preview = mergePreview({
      books: [mergeBook(1), mergeBook(2), mergeBook(3, { status: 'missing' })],
      fields: [mergeField('publisher', { 1: null, 2: 'Ace', 3: 'Ace' }, 2), mergeField('language', { 1: null, 2: null, 3: 'en' }, 3)],
    })
    expect(recommendMergeKeeper(preview)).toBe(2)
  })

  it('breaks a tie on files, then bytes, then the oldest record', () => {
    const tied = { fields: [mergeField('title', { 1: 'Dune', 2: 'Dune' }, 1)] }
    expect(recommendMergeKeeper(mergePreview({ ...tied, books: [mergeBook(1), mergeBook(2, { fileCount: 2 })] }))).toBe(2)
    expect(recommendMergeKeeper(mergePreview({ ...tied, files: [mergeFile(10, 1, { sizeBytes: 5 }), mergeFile(20, 2, { sizeBytes: 50 })] }))).toBe(2)
    expect(
      recommendMergeKeeper(
        mergePreview({
          ...tied,
          files: [],
          books: [mergeBook(1, { addedAt: '2026-05-01T00:00:00.000Z' }), mergeBook(2, { addedAt: '2024-05-01T00:00:00.000Z' })],
        }),
      ),
    ).toBe(2)
  })
})

describe('describePreviewChanges', () => {
  it('names each section a reloaded preview changed', () => {
    const before = mergePreview()
    const after = mergePreview({
      fields: [mergeField('title', { 1: 'Dune', 2: 'Dune' }, 1), mergeField('publisher', { 1: 'Chilton', 2: 'Gollancz' }, 1)],
      warnings: [{ code: 'KOBO_REDELIVERY', count: 1 }],
      userData: { own: [], others: null, otherReadersAffected: true },
    })
    expect(describePreviewChanges(before, after)).toEqual([{ kind: 'field', field: 'publisher' }, { kind: 'readingData' }, { kind: 'warnings' }])
    expect(describePreviewChanges(before, mergePreview())).toEqual([])
  })
})

describe('sourceOutcomes', () => {
  it('reads a missing outcome as merged only once the job is done', () => {
    const outcomes = [{ sourceBookId: 3, status: 'failed' as const, errorCode: 'BOOK_BUSY' }]
    expect(sourceOutcomes({ status: 'moving', sourceBookIds: [2, 3], outcomes }).map((outcome) => outcome.status)).toEqual(['pending', 'failed'])
    expect(sourceOutcomes({ status: 'done', sourceBookIds: [2, 3], outcomes }).map((outcome) => outcome.status)).toEqual(['merged', 'failed'])
    expect(mergedSourceIds({ status: 'done', sourceBookIds: [2, 3], outcomes })).toEqual([2])
  })
})

describe('cross-library helpers', () => {
  const books = [
    mergeBook(1, { libraryId: 1, libraryName: 'Books', libraryFolderId: 11 }),
    mergeBook(2, { libraryId: 2, libraryName: 'Audiobooks', libraryFolderId: 12 }),
  ]

  it('names libraries from the preview before the sidebar list', () => {
    const names = mergeLibraryNames(books, [
      { id: 1, name: 'Old name' },
      { id: 3, name: 'Comics' },
    ])
    expect([...names.entries()]).toEqual([
      [1, 'Books'],
      [3, 'Comics'],
      [2, 'Audiobooks'],
    ])
  })

  it('splits the file plan by direction and keeps untracked leftovers apart', () => {
    const { groups, leftBehind } = splitMergeFiles(
      mergePreview({
        books,
        destinationLibraryId: 1,
        files: [
          mergeFile(10, 1, { action: 'stay', reason: 'already_in_destination', fromLibraryId: 1, toLibraryId: 1, sizeBytes: 100 }),
          mergeFile(20, 2, { fromLibraryId: 2, toLibraryId: 1, sizeBytes: 300, crossDevice: true }),
          mergeFile(21, 2, { fromLibraryId: 2, toLibraryId: 1, sizeBytes: 200 }),
          mergeFile(22, 2, { action: 'stay', reason: 'cover_kept_in_place', fromLibraryId: 2, toLibraryId: 2 }),
        ],
      }),
    )
    expect(groups?.map((group) => [group.fromLibraryId, group.toLibraryId, group.files.length, group.bytes, group.crossDeviceBytes])).toEqual([
      [2, 1, 2, 500, 300],
      [1, 1, 1, 100, 0],
    ])
    expect(leftBehind).toEqual([{ libraryId: 2, files: [expect.objectContaining({ fileId: 22 })] }])
  })

  it('keeps the flat list for one library or a server without library ids', () => {
    expect(splitMergeFiles(mergePreview()).groups).toBeNull()
    expect(splitMergeFiles(mergePreview({ books })).groups).toBeNull()
  })

  it('offers another destination only where one would avoid the blocker', () => {
    const preview = mergePreview({
      books,
      destinationBookId: 2,
      destinationLibraryId: 2,
      destinationCandidates: [1, 2],
      destinationAccessLoss: [
        { bookId: 1, libraryId: 1, losesAccess: false, count: null },
        { bookId: 2, libraryId: 2, losesAccess: true, count: null },
      ],
    })
    expect(destinationAvoidsBlocker({ code: 'READERS_LOSE_ACCESS' }, preview)).toBe(true)
    expect(destinationAvoidsBlocker({ code: 'FORMAT_NOT_ALLOWED', libraryId: 2, format: 'pdf' }, preview)).toBe(true)
    expect(destinationAvoidsBlocker({ code: 'INSUFFICIENT_SPACE', bytes: 10 }, preview)).toBe(true)
    expect(destinationAvoidsBlocker({ code: 'LEFTOVER_CONTENT', libraryId: 1 }, preview)).toBe(false)
    expect(
      destinationAvoidsBlocker(
        { code: 'READERS_LOSE_ACCESS' },
        { ...preview, destinationAccessLoss: [{ bookId: 1, libraryId: 1, losesAccess: true, count: 1 }] },
      ),
    ).toBe(false)
    expect(destinationAvoidsBlocker({ code: 'READERS_LOSE_ACCESS' }, { ...preview, destinationCandidates: [2] })).toBe(false)
    expect(destinationAvoidsBlocker({ code: 'FORMAT_NOT_ALLOWED' }, mergePreview())).toBe(false)
  })
})
