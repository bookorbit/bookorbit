import type { BookMergeBookSummary, BookMergeFieldPreview, BookMergeFilePlanEntry, BookMergeJob, BookMergePreviewResponse } from '@bookorbit/types'

export function mergeBook(id: number, overrides: Partial<BookMergeBookSummary> = {}): BookMergeBookSummary {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Ann Author'],
    libraryId: 1,
    status: 'present',
    formats: ['epub'],
    fileCount: 1,
    hasAudio: false,
    folderRelPath: `Ann Author/Book ${id}`,
    canBeDestination: true,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function mergeField(
  field: BookMergeFieldPreview['field'],
  values: Record<number, BookMergeFieldPreview['candidates'][number]['value']>,
  defaultBookId: number,
): BookMergeFieldPreview {
  const candidates = Object.entries(values).map(([bookId, value]) => ({ bookId: Number(bookId), value, locked: false }))
  const distinct = new Set(candidates.map((candidate) => JSON.stringify(candidate.value)))
  return { field, candidates, defaultBookId, differs: distinct.size > 1, lockedOnTarget: false }
}

export function mergeFile(fileId: number, bookId: number, overrides: Partial<BookMergeFilePlanEntry> = {}): BookMergeFilePlanEntry {
  return {
    fileId,
    bookId,
    role: 'content',
    format: 'epub',
    fromRelPath: `Ann Author/Book ${bookId}/book-${fileId}.epub`,
    toRelPath: `Ann Author/Book 1/book-${fileId}.epub`,
    action: 'move',
    reason: 'content',
    renamed: false,
    identical: false,
    crossDevice: false,
    sizeBytes: 1000,
    ...overrides,
  }
}

/** A mergeable preview for books 1 and 2, kept book 1 unless `targetBookId` says otherwise. */
export function mergePreview(overrides: Partial<BookMergePreviewResponse> = {}): BookMergePreviewResponse {
  const targetBookId = overrides.targetBookId ?? 1
  return {
    eligible: true,
    blockers: [],
    warnings: [],
    books: [mergeBook(1), mergeBook(2)],
    targetBookId,
    destinationBookId: targetBookId,
    destinationCandidates: [1, 2],
    fields: [mergeField('title', { 1: 'Dune', 2: 'Dune' }, 1), mergeField('publisher', { 1: 'Chilton', 2: 'Ace' }, targetBookId)],
    files: [
      mergeFile(10, 1, {
        action: 'stay',
        reason: 'already_in_destination',
        toRelPath: 'Ann Author/Book 1/book-10.epub',
        fromRelPath: 'Ann Author/Book 1/book-10.epub',
      }),
      mergeFile(20, 2),
    ],
    userData: { own: [], others: null, otherReadersAffected: false },
    visibility: { tags: [], genres: [], canOverride: false },
    canRemoveIdenticalCopies: false,
    previewToken: `token-${targetBookId}`,
    ...overrides,
  }
}

export function mergeJob(overrides: Partial<BookMergeJob> = {}): BookMergeJob {
  return {
    id: 41,
    libraryId: 1,
    targetBookId: 1,
    sourceBookIds: [2],
    status: 'done',
    processed: 1,
    total: 1,
    currentSourceBookId: null,
    outcomes: [{ sourceBookId: 2, status: 'merged', errorCode: null }],
    result: { movedFileCount: 1, crossDevice: false, leftoverFileCount: 0, retiredFileCount: 0 },
    errorCode: null,
    createdAt: '2026-11-06T00:00:00.000Z',
    finishedAt: '2026-11-06T00:00:01.000Z',
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
