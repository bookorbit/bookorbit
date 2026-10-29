import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { ReadAloudJobRow } from '../../db/schema';

export const JOB_ID = '00000000-0000-4000-8000-000000000001';

export const OWNER = { id: 7, isSuperuser: false, active: true, permissions: [Permission.LibraryGenerateReadAloud] } as unknown as RequestUser;
/** The requester, also allowed to delete books, which replacing a read-along needs. */
export const DELETER = {
  id: 7,
  isSuperuser: false,
  active: true,
  permissions: [Permission.LibraryGenerateReadAloud, Permission.LibraryDeleteBooks],
} as unknown as RequestUser;
export const OTHER = { id: 8, isSuperuser: false, active: true, permissions: [Permission.LibraryGenerateReadAloud] } as unknown as RequestUser;
export const ADMIN = { id: 1, isSuperuser: true, active: true, permissions: [] } as unknown as RequestUser;

export function jobRow(overrides: Partial<ReadAloudJobRow> = {}): ReadAloudJobRow {
  const at = new Date('2026-01-01T00:00:00Z');
  return {
    id: JOB_ID,
    bookId: 12,
    requestedByUserId: OWNER.id,
    outputFileId: null,
    replaceFileId: null,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    stageCurrent: null,
    stageTotal: null,
    stageUnit: null,
    input: {
      epubFileId: 101,
      audioFileIds: [102],
      language: 'en-US',
      granularity: 'sentence',
      sourceBytes: 7_000,
      replaceFileId: null,
      sourceHashes: { '101': 'epub-hash', '102': 'audio-hash' },
    },
    decisions: { chapters: {}, audio: [] },
    resumeFrom: null,
    report: null,
    warnings: [],
    coverage: null,
    errorCode: null,
    lastError: null,
    device: null,
    attemptCount: 0,
    nextAttemptAt: at,
    leaseUntil: null,
    cancelRequested: false,
    publishApproved: false,
    workerEventSeq: 0,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    dismissedAt: null,
    expiresAt: null,
    remindedAt: null,
    workExpiresAt: null,
    ...overrides,
  };
}

export const REPORT_TOTALS = {
  sentences: 100,
  matchedSentences: 98,
  interpolatedSentences: 1,
  unmatchedSentences: 1,
  droppedSentences: 0,
  seconds: 600,
  matchedSeconds: 590,
  interpolatedSeconds: 5,
  looseSeconds: 5,
  tracks: 1,
  unalignedTracks: 0,
};

export const COVERAGE = { storySentences: 100, storyUnmatchedSentences: 1, outsideSentences: 0, outsideChapterCount: 0, outsideTitles: [] };

export function sourceFiles() {
  return [
    {
      id: 101,
      absolutePath: '/library/novel/novel.epub',
      filename: 'novel.epub',
      format: 'epub',
      role: 'primary',
      sizeBytes: 2_000,
      durationSeconds: null,
      fileHash: 'epub-hash',
      mediaOverlayAvailable: false,
      sortOrder: 0,
    },
    {
      id: 102,
      absolutePath: '/library/novel/01.mp3',
      filename: '01.mp3',
      format: 'mp3',
      role: 'content',
      sizeBytes: 5_000,
      durationSeconds: 300,
      fileHash: 'audio-hash',
      mediaOverlayAvailable: false,
      sortOrder: 1,
    },
  ];
}

export function bookDetail(overrides: { language?: string; status?: string; files?: unknown[] } = {}) {
  return {
    id: 12,
    libraryId: 3,
    status: overrides.status ?? 'present',
    language: overrides.language ?? 'en-US',
    files: overrides.files ?? [
      {
        id: 101,
        role: 'primary',
        format: 'epub',
        filename: 'novel.epub',
        absolutePath: '/library/novel/novel.epub',
        sizeBytes: 2_000,
        durationSeconds: null,
        mediaOverlay: { available: false },
      },
      {
        id: 102,
        role: 'content',
        format: 'mp3',
        filename: '01.mp3',
        absolutePath: '/library/novel/01.mp3',
        sizeBytes: 5_000,
        durationSeconds: 300,
      },
    ],
  };
}

export function okHealth(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ok' as const,
    health: {
      status: 'ok' as const,
      version: '1',
      protocol: 1,
      activeJobId: null,
      activeJobs: 0,
      capacity: 1,
      device: 'cpu' as const,
      configuredDevice: 'auto' as const,
      deviceCheck: 'not_checked' as const,
      libraryRoots: ['/library'],
      workRoot: '/data/read-aloud/jobs',
      freeBytes: 1e12,
      platform: 'linux',
      architecture: 'x64',
      ...overrides,
    },
  };
}
