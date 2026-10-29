import type { ReadAloudCapability, ReadAloudChapterReport, ReadAloudJob, ReadAloudJobReport } from '@bookorbit/types'

export const JOB_ID = '00000000-0000-4000-8000-000000000001'
export const BOOK_ID = 12

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ message: 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
}

export function makeJob(overrides: Partial<ReadAloudJob> = {}): ReadAloudJob {
  const status = overrides.status ?? 'processing'
  const finished = status === 'completed' || status === 'completed_with_warnings' || status === 'failed' || status === 'cancelled'
  return {
    id: JOB_ID,
    bookId: BOOK_ID,
    status,
    stage: status === 'queued' ? 'queued' : status === 'awaiting_review' ? 'awaiting_review' : finished ? 'completed' : 'generating_emissions',
    progress: status === 'queued' ? 0 : finished ? 100 : 42,
    stageDetail: null,
    queuePosition: status === 'queued' ? 0 : null,
    input: { epubFileId: 101, audioFileIds: [102, 103, 104], language: 'en', granularity: 'sentence', sourceBytes: 600, replaceFileId: null },
    decisions: { chapters: {}, audio: [] },
    outputFileId: status === 'completed' || status === 'completed_with_warnings' ? 105 : null,
    report: null,
    warnings: [],
    coverage: null,
    errorCode: null,
    cancelRequested: false,
    cancellable: !finished,
    device: 'cpu',
    canManage: true,
    requestedBy: { id: 1, name: 'Alex' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: status === 'queued' ? null : '2026-01-01T00:00:00.000Z',
    completedAt: finished ? '2026-01-01T01:00:00.000Z' : null,
    dismissedAt: null,
    expiresAt: null,
    retryableUntil: null,
    ...overrides,
  }
}

export function makeCapability(overrides: Partial<ReadAloudCapability> = {}): ReadAloudCapability {
  return {
    model: 'quartznet15x5',
    supportedLanguages: ['en', 'de', 'fr'],
    workerConfigured: true,
    workerAvailable: true,
    workerDevice: 'cpu',
    workerFreeBytes: 1e12,
    eligible: true,
    reason: null,
    epubFiles: [{ id: 101, filename: 'book.epub', format: 'epub', sizeBytes: 100, durationSeconds: null }],
    audioFiles: [
      { id: 102, filename: '01.mp3', format: 'mp3', sizeBytes: 200, durationSeconds: 1800 },
      { id: 103, filename: '02.mp3', format: 'mp3', sizeBytes: 200, durationSeconds: 1800 },
      { id: 104, filename: '03.mp3', format: 'mp3', sizeBytes: 200, durationSeconds: 1800 },
    ],
    existingReadAlongs: [],
    estimatedOutputBytes: 650,
    latestJob: null,
    ...overrides,
  }
}

export function makeChapter(overrides: Partial<ReadAloudChapterReport> = {}): ReadAloudChapterReport {
  return {
    index: 0,
    href: 'chapter-1.xhtml',
    title: 'Chapter 1',
    zone: 'body',
    status: 'aligned',
    decision: null,
    sentenceCount: 100,
    matchedSentenceCount: 95,
    interpolatedSentenceCount: 3,
    droppedSentenceCount: 0,
    matchedSeconds: 600,
    score: 0.95,
    preview: 'It was a bright cold day in April.',
    firstMatch: 'It was a bright cold day',
    lastMatch: 'and the clocks were striking thirteen.',
    outsideNarration: false,
    ...overrides,
  }
}

export function makeReport(chapters: ReadAloudChapterReport[]): ReadAloudJobReport {
  return {
    jobId: JOB_ID,
    totals: {
      sentences: 300,
      matchedSentences: 250,
      interpolatedSentences: 10,
      unmatchedSentences: 40,
      droppedSentences: 0,
      seconds: 3600,
      matchedSeconds: 3000,
      interpolatedSeconds: 60,
      looseSeconds: 0,
      tracks: 3,
      unalignedTracks: 0,
    },
    coverage: null,
    chapters,
  }
}
