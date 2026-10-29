import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import {
  Permission,
  BOOK_CHAPTERS_ERROR_CODES,
  CHAPTER_PAUSE_LIMITS,
  type AudiobookChapter,
  type AudiobookChapterSource,
  type BookChapterWriteBack,
  type ChapterLookupResult,
  type ChapterPause,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { ChapterWriteUnavailableError } from '../file-write/file-write.service';
import { ChapterEditorService } from './chapter-editor.service';
import { AudioToolMissingError, type PauseSegment } from './chapter-pause.service';

const BOOK_ID = 9;
const UPDATED_AT = new Date('2026-09-30T12:00:00.000Z');

const USER = {
  id: 7,
  username: 'editor',
  name: 'Editor',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [],
  contentFilters: null,
} as unknown as RequestUser;

interface ChapterRowInput {
  chapters?: AudiobookChapter[] | null;
  source?: AudiobookChapterSource | null;
  updatedAt?: Date | null;
  updatedById?: number | null;
  updatedByName?: string | null;
  audibleId?: string | null;
  durationSeconds?: number | null;
}

function chapterRow(input: ChapterRowInput = {}) {
  return {
    chapters: null,
    source: null,
    updatedAt: null,
    updatedById: null,
    updatedByName: null,
    audibleId: null,
    durationSeconds: null,
    ...input,
  };
}

function track(id: number, name: string, durationSeconds: number | null, sortOrder: number, format = 'mp3') {
  return { id, absolutePath: `/library/book/${name}`, format, durationSeconds, sortOrder };
}

const TWO_TRACKS = [track(2, 'Part 2.mp3', 40, 2), track(1, 'Part 1.mp3', 60, 1), track(3, 'cover.jpg', null, 0, 'jpg')];

const STORED = chapterRow({
  chapters: [
    { title: 'Opening', startMs: 0 },
    { title: 'Middle', startMs: 30_000 },
  ],
  source: 'embedded',
  updatedAt: UPDATED_AT,
  updatedById: 4,
  updatedByName: 'Ann',
  audibleId: 'B000TEST',
  durationSeconds: 100,
});

const LOOKUP_RESULT: ChapterLookupResult = {
  provider: 'audible',
  asin: 'B0TESTASIN',
  region: 'uk',
  chapters: [{ title: 'Opening', startMs: 0, lengthMs: 1_000, children: [] }],
  runtimeMs: 1_000,
  brandIntroMs: 0,
  brandOutroMs: 0,
  isAccurate: true,
};

const WRITE_BACK: BookChapterWriteBack = { available: true, reason: null, fileCount: 2 };

function ebookFile(id: number, mediaOverlayAvailable: boolean, role = 'content') {
  return { id, format: 'epub', role, mediaOverlayAvailable };
}

function makeService(
  options: {
    row?: ReturnType<typeof chapterRow> | null;
    tracks?: ReturnType<typeof track>[];
    lockedFields?: string[];
    ebookFiles?: ReturnType<typeof ebookFile>[];
    audibleDomain?: string;
  } = {},
) {
  const repo = {
    findChapterRow: vi.fn().mockResolvedValue(options.row === undefined ? STORED : options.row),
    findTrackRows: vi.fn().mockResolvedValue(options.tracks ?? TWO_TRACKS),
    countVersions: vi.fn().mockResolvedValue(3),
    listVersions: vi.fn().mockResolvedValue([]),
    findVersion: vi.fn().mockResolvedValue(null),
    findEbookFiles: vi.fn().mockResolvedValue(options.ebookFiles ?? []),
  };
  const bookService = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const audiobookChapters = {
    saveEditedChapters: vi.fn().mockResolvedValue(undefined),
    saveLookedUpChapters: vi.fn().mockResolvedValue(undefined),
    restoreFileChapters: vi.fn().mockResolvedValue(undefined),
  };
  const metadataService = { readEmbeddedChapters: vi.fn().mockResolvedValue([]) };
  const lockedFields = options.lockedFields ?? [];
  const lockService = {
    isFieldLocked: vi.fn().mockImplementation((_bookId: number, field: string) => Promise.resolve(lockedFields.includes(field))),
    getLockedFields: vi.fn().mockResolvedValue(lockedFields),
    replaceLockedFields: vi.fn().mockImplementation((_bookId: number, fields: string[]) => Promise.resolve(fields)),
  };
  const lookupService = { lookup: vi.fn().mockResolvedValue(LOOKUP_RESULT) };
  const epubService = {
    getBookInfo: vi.fn().mockResolvedValue({ toc: null }),
    getMediaOverlayPlaylist: vi.fn().mockResolvedValue({ sections: [], durationSeconds: null }),
  };
  const providerConfig = { getConfig: vi.fn().mockResolvedValue({ audible: { enabled: true, domain: options.audibleDomain ?? 'com' } }) };
  const pauseService = {
    findPauses: vi.fn<(segments: readonly PauseSegment[]) => Promise<ChapterPause[]>>().mockResolvedValue([]),
    readPeaks: vi.fn<(segments: readonly PauseSegment[], buckets: number) => Promise<number[]>>().mockResolvedValue([]),
  };
  const fileWriteService = {
    resolveChapterWriteStatus: vi.fn().mockResolvedValue(WRITE_BACK),
    writeChapters: vi.fn().mockResolvedValue({ status: 'success', filesWritten: 2, filesTotal: 2 }),
  };
  const service = new ChapterEditorService(
    repo as never,
    bookService as never,
    audiobookChapters as never,
    metadataService as never,
    lockService as never,
    lookupService as never,
    epubService as never,
    providerConfig as never,
    pauseService as never,
    fileWriteService as never,
    { findByIdWithPermissions: vi.fn().mockResolvedValue({ ...USER, permissions: [Permission.LibraryEditMetadata] }) } as never,
  );
  return {
    service,
    repo,
    bookService,
    audiobookChapters,
    metadataService,
    lockService,
    lookupService,
    epubService,
    providerConfig,
    pauseService,
    fileWriteService,
  };
}

async function currentRevision(service: ChapterEditorService): Promise<string> {
  return (await service.getState(BOOK_ID, USER)).revision;
}

async function refusal(run: Promise<unknown>): Promise<{ status: number; body: { errorCode?: string; errorMeta?: Record<string, unknown> } }> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  const exception = error as HttpException;
  return { status: exception.getStatus(), body: exception.getResponse() as { errorCode?: string; errorMeta?: Record<string, unknown> } };
}

describe('ChapterEditorService.getState', () => {
  it('serves a stored list with who saved it and the track timeline', async () => {
    const { service, bookService, fileWriteService } = makeService({ lockedFields: ['chapters'] });

    const state = await service.getState(BOOK_ID, USER);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(BOOK_ID, USER);
    expect(fileWriteService.resolveChapterWriteStatus).toHaveBeenCalledWith(BOOK_ID, [1, 2]);
    expect(state).toEqual({
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Middle', startMs: 30_000 },
      ],
      source: 'embedded',
      derived: false,
      locked: true,
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
      updatedAt: UPDATED_AT.toISOString(),
      updatedBy: { id: 4, name: 'Ann' },
      totalDurationMs: 100_000,
      tracks: [
        { fileId: 1, name: 'Part 1.mp3', startMs: 0, durationMs: 60_000 },
        { fileId: 2, name: 'Part 2.mp3', startMs: 60_000, durationMs: 40_000 },
      ],
      audibleId: 'B000TEST',
      versionCount: 3,
      audibleRegion: 'us',
      sources: { ebookFileId: null, readAlongFileId: null },
      writeBack: WRITE_BACK,
    });
  });

  it('says why the chapters cannot be written into the files', async () => {
    const { service, fileWriteService } = makeService();
    fileWriteService.resolveChapterWriteStatus.mockResolvedValue({ available: false, reason: 'format_not_supported', fileCount: 2 });

    await expect(service.getState(BOOK_ID, USER)).resolves.toMatchObject({
      writeBack: { available: false, reason: 'format_not_supported', fileCount: 2 },
    });
  });

  it('names the lookup storefront from the Audible provider setting and the EPUBs that can supply chapters', async () => {
    const { service, repo } = makeService({
      audibleDomain: 'audible.co.uk',
      ebookFiles: [ebookFile(20, true), ebookFile(21, false, 'supplement'), ebookFile(22, false, 'primary')],
    });

    const state = await service.getState(BOOK_ID, USER);

    expect(repo.findEbookFiles).toHaveBeenCalledWith(BOOK_ID);
    expect(state.audibleRegion).toBe('uk');
    expect(state.sources).toEqual({ ebookFileId: 22, readAlongFileId: 20 });
  });

  it('lets a lone read-along EPUB supply both the table of contents and the timings', async () => {
    const { service } = makeService({ ebookFiles: [ebookFile(20, true)] });

    await expect(service.getState(BOOK_ID, USER)).resolves.toMatchObject({ sources: { ebookFileId: 20, readAlongFileId: 20 } });
  });

  it('derives one chapter per track when nothing is stored, without crediting an editor', async () => {
    const { service } = makeService({
      row: chapterRow({ chapters: [], source: 'manual', updatedAt: UPDATED_AT, updatedById: 4, updatedByName: 'Ann' }),
    });

    const state = await service.getState(BOOK_ID, USER);

    expect(state).toMatchObject({
      chapters: [
        { title: 'Part 1', startMs: 0 },
        { title: 'Part 2', startMs: 60_000 },
      ],
      source: 'tracks',
      derived: true,
      locked: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('stops placing tracks after one of unknown length and falls back to the declared duration', async () => {
    const { service } = makeService({
      row: chapterRow({ durationSeconds: 7_200 }),
      tracks: [track(1, 'Part 1.mp3', 60, 1), track(2, 'Part 2.mp3', null, 2), track(3, 'Part 3.mp3', 30, 3)],
    });

    const state = await service.getState(BOOK_ID, USER);

    expect(state.tracks).toEqual([
      { fileId: 1, name: 'Part 1.mp3', startMs: 0, durationMs: 60_000 },
      { fileId: 2, name: 'Part 2.mp3', startMs: 60_000, durationMs: null },
      { fileId: 3, name: 'Part 3.mp3', startMs: null, durationMs: 30_000 },
    ]);
    expect(state.totalDurationMs).toBe(7_200_000);
    expect(state).toMatchObject({ chapters: [], source: null, derived: false });
  });

  it('has no total when a track length and the declared duration are both unknown', async () => {
    const { service } = makeService({ row: null, tracks: [track(1, 'Part 1.mp3', null, 1)] });

    const state = await service.getState(BOOK_ID, USER);

    expect(state.totalDurationMs).toBeNull();
    expect(state.audibleId).toBeNull();
  });

  it('refuses a book without audio tracks', async () => {
    const { service } = makeService({ tracks: [track(3, 'book.epub', null, 0, 'epub')] });

    await expect(service.getState(BOOK_ID, USER)).rejects.toThrow(NotFoundException);
  });

  it('changes the revision whenever the stored list, its source or its save time changes', async () => {
    const base = await currentRevision(makeService().service);

    expect(await currentRevision(makeService().service)).toBe(base);
    expect(await currentRevision(makeService({ row: { ...STORED, chapters: [{ title: 'Opening', startMs: 0 }] } }).service)).not.toBe(base);
    expect(await currentRevision(makeService({ row: { ...STORED, source: 'manual' } }).service)).not.toBe(base);
    expect(await currentRevision(makeService({ row: { ...STORED, updatedAt: new Date('2026-10-01T00:00:00.000Z') } }).service)).not.toBe(base);
  });
});

describe('ChapterEditorService.save', () => {
  const EDITED: AudiobookChapter[] = [
    { title: ' Intro ', startMs: 0 },
    { title: 'Body', startMs: 50_000 },
  ];

  it('refuses a stale revision without writing', async () => {
    const { service, audiobookChapters, lockService } = makeService();

    const { status, body } = await refusal(service.save(BOOK_ID, { chapters: EDITED, baseRevision: 'f'.repeat(64) }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.stale);
    expect(audiobookChapters.saveEditedChapters).not.toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'an empty title',
      chapters: [
        { title: 'One', startMs: 0 },
        { title: '   ', startMs: 10_000 },
      ],
      code: BOOK_CHAPTERS_ERROR_CODES.emptyTitle,
      index: 1,
    },
    { name: 'a first chapter after zero', chapters: [{ title: 'One', startMs: 500 }], code: BOOK_CHAPTERS_ERROR_CODES.firstNotZero, index: 0 },
    {
      name: 'a start that does not move forward',
      chapters: [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 20_000 },
        { title: 'Three', startMs: 20_000 },
      ],
      code: BOOK_CHAPTERS_ERROR_CODES.notAscending,
      index: 2,
    },
    {
      name: 'a start at the end of the audio',
      chapters: [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 100_000 },
      ],
      code: BOOK_CHAPTERS_ERROR_CODES.pastEnd,
      index: 1,
    },
  ])('refuses $name with its code and index', async ({ chapters, code, index }) => {
    const { service, audiobookChapters } = makeService();
    const baseRevision = await currentRevision(service);

    const { status, body } = await refusal(service.save(BOOK_ID, { chapters, baseRevision }, USER));

    expect(status).toBe(400);
    expect(body).toMatchObject({ errorCode: code, errorMeta: { index } });
    expect(audiobookChapters.saveEditedChapters).not.toHaveBeenCalled();
  });

  it('accepts any start when the length of the audio is unknown', async () => {
    const { service, audiobookChapters } = makeService({ row: chapterRow(), tracks: [track(1, 'Part 1.mp3', null, 1)] });
    const baseRevision = await currentRevision(service);
    const chapters = [
      { title: 'One', startMs: 0 },
      { title: 'Two', startMs: 99_000_000 },
    ];

    await service.save(BOOK_ID, { chapters, baseRevision }, USER);

    expect(audiobookChapters.saveEditedChapters).toHaveBeenCalledWith(
      BOOK_ID,
      chapters,
      USER.id,
      expect.objectContaining({ expectedRevision: expect.any(String), locked: true }),
    );
  });

  it('saves trimmed titles as the user and locks chapters by default', async () => {
    const { service, audiobookChapters, lockService, bookService } = makeService({ lockedFields: ['title'] });
    const baseRevision = await currentRevision(service);

    const state = await service.save(BOOK_ID, { chapters: EDITED, baseRevision }, USER);

    expect(bookService.verifyBookAccess).toHaveBeenLastCalledWith(BOOK_ID, USER, 'editor');
    expect(audiobookChapters.saveEditedChapters).toHaveBeenCalledWith(
      BOOK_ID,
      [
        { title: 'Intro', startMs: 0 },
        { title: 'Body', startMs: 50_000 },
      ],
      USER.id,
      expect.objectContaining({ expectedRevision: expect.any(String), locked: true }),
    );
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
    expect(state.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unlocks chapters when the save asks not to lock', async () => {
    const { service, lockService } = makeService({ lockedFields: ['title', 'chapters'] });
    const baseRevision = await currentRevision(service);

    await service.save(BOOK_ID, { chapters: EDITED, baseRevision, lock: false }, USER);

    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it.each([
    { lock: true, lockedFields: ['chapters'] },
    { lock: false, lockedFields: ['title'] },
  ])('writes no locks when lock=$lock already matches', async ({ lock, lockedFields }) => {
    const { service, audiobookChapters, lockService } = makeService({ lockedFields });
    const baseRevision = await currentRevision(service);

    await service.save(BOOK_ID, { chapters: EDITED, baseRevision, lock }, USER);

    expect(audiobookChapters.saveEditedChapters).toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it('writes nothing for a book the user cannot reach', async () => {
    const { service, bookService, audiobookChapters } = makeService();
    const baseRevision = await currentRevision(service);
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.save(BOOK_ID, { chapters: EDITED, baseRevision }, USER)).rejects.toThrow(NotFoundException);
    expect(audiobookChapters.saveEditedChapters).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.revert', () => {
  it('refuses when an audio file cannot be read, leaving chapters and locks alone', async () => {
    const { service, metadataService, audiobookChapters, lockService } = makeService({ lockedFields: ['chapters'] });
    metadataService.readEmbeddedChapters.mockResolvedValue(null);
    const baseRevision = await currentRevision(service);

    const { status, body } = await refusal(service.revert(BOOK_ID, { baseRevision }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.filesUnreadable);
    expect(audiobookChapters.restoreFileChapters).not.toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it('refuses a stale revision before reading any file', async () => {
    const { service, metadataService } = makeService();

    const { status, body } = await refusal(service.revert(BOOK_ID, { baseRevision: '0'.repeat(64) }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.stale);
    expect(metadataService.readEmbeddedChapters).not.toHaveBeenCalled();
  });

  it('stores what the files carry in playback order, then unlocks chapters', async () => {
    const { service, metadataService, audiobookChapters, lockService } = makeService({ lockedFields: ['title', 'chapters'] });
    const embedded = [
      { title: 'File One', startMs: 0 },
      { title: 'File Two', startMs: 60_000 },
    ];
    metadataService.readEmbeddedChapters.mockResolvedValue(embedded);
    const baseRevision = await currentRevision(service);

    await service.revert(BOOK_ID, { baseRevision }, USER);

    expect(metadataService.readEmbeddedChapters).toHaveBeenCalledWith(['/library/book/Part 1.mp3', '/library/book/Part 2.mp3'], BOOK_ID);
    expect(audiobookChapters.restoreFileChapters).toHaveBeenCalledWith(
      BOOK_ID,
      embedded,
      USER.id,
      expect.objectContaining({ expectedRevision: expect.any(String), locked: false }),
    );
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.writeToFiles', () => {
  it('writes the saved chapters on the track timeline, in playback order', async () => {
    const { service, fileWriteService } = makeService();
    const baseRevision = await currentRevision(service);

    await expect(service.writeToFiles(BOOK_ID, { baseRevision }, USER)).resolves.toEqual({ status: 'success', filesWritten: 2, filesTotal: 2 });

    expect(fileWriteService.writeChapters).toHaveBeenCalledWith(
      BOOK_ID,
      [
        { id: 1, timelineStartMs: 0 },
        { id: 2, timelineStartMs: 60_000 },
      ],
      [
        { title: 'Opening', startMs: 0 },
        { title: 'Middle', startMs: 30_000 },
      ],
      USER.id,
      expect.any(Function),
      undefined,
    );
  });

  it('writes the list the editor shows when nothing is stored', async () => {
    const { service, fileWriteService } = makeService({ row: chapterRow() });
    const baseRevision = await currentRevision(service);

    await service.writeToFiles(BOOK_ID, { baseRevision }, USER);

    expect(fileWriteService.writeChapters).toHaveBeenCalledWith(
      BOOK_ID,
      expect.any(Array),
      [
        { title: 'Part 1', startMs: 0 },
        { title: 'Part 2', startMs: 60_000 },
      ],
      USER.id,
      expect.any(Function),
      undefined,
    );
  });

  it('refuses a stale revision without writing', async () => {
    const { service, fileWriteService } = makeService();

    const { status, body } = await refusal(service.writeToFiles(BOOK_ID, { baseRevision: 'e'.repeat(64) }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.stale);
    expect(fileWriteService.writeChapters).not.toHaveBeenCalled();
  });

  it('refuses when there are no chapters to write', async () => {
    const { service, fileWriteService } = makeService({ row: chapterRow(), tracks: [track(1, 'Part 1.mp3', 60, 1)] });
    const baseRevision = await currentRevision(service);

    const { status, body } = await refusal(service.writeToFiles(BOOK_ID, { baseRevision }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.nothingToWrite);
    expect(fileWriteService.writeChapters).not.toHaveBeenCalled();
  });

  it('refuses when a track cannot be placed because an earlier length is unknown', async () => {
    const { service, fileWriteService } = makeService({
      tracks: [track(1, 'Part 1.mp3', 60, 1), track(2, 'Part 2.mp3', null, 2), track(3, 'Part 3.mp3', 30, 3)],
    });
    const baseRevision = await currentRevision(service);

    const { status, body } = await refusal(service.writeToFiles(BOOK_ID, { baseRevision }, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.filesUnreadable);
    expect(fileWriteService.writeChapters).not.toHaveBeenCalled();
  });

  it('answers 409 with the reason when the files cannot take chapters', async () => {
    const { service, fileWriteService } = makeService();
    fileWriteService.writeChapters.mockRejectedValue(new ChapterWriteUnavailableError('format_not_supported'));
    const baseRevision = await currentRevision(service);

    const { status, body } = await refusal(service.writeToFiles(BOOK_ID, { baseRevision }, USER));

    expect(status).toBe(409);
    expect(body).toMatchObject({ errorCode: BOOK_CHAPTERS_ERROR_CODES.writeUnavailable, errorMeta: { reason: 'format_not_supported' } });
  });

  it('passes any other failure through unchanged', async () => {
    const { service, fileWriteService } = makeService();
    const failure = new Error('database down');
    fileWriteService.writeChapters.mockRejectedValue(failure);
    const baseRevision = await currentRevision(service);

    await expect(service.writeToFiles(BOOK_ID, { baseRevision }, USER)).rejects.toBe(failure);
  });

  it('checks access before reading anything', async () => {
    const { service, bookService, repo, fileWriteService } = makeService();
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.writeToFiles(BOOK_ID, { baseRevision: 'a'.repeat(64) }, USER)).rejects.toThrow(NotFoundException);
    expect(repo.findChapterRow).not.toHaveBeenCalled();
    expect(repo.findTrackRows).not.toHaveBeenCalled();
    expect(fileWriteService.writeChapters).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService versions and embedded reads', () => {
  it('answers 404 for a version the book does not have', async () => {
    const { service, repo } = makeService();

    await expect(service.getVersion(BOOK_ID, 55, USER)).rejects.toThrow(NotFoundException);
    expect(repo.findVersion).toHaveBeenCalledWith(BOOK_ID, 55);
  });

  it('maps a version, crediting only an editor whose account still exists', async () => {
    const { service, repo } = makeService();
    const createdAt = new Date('2026-09-01T08:00:00.000Z');
    repo.findVersion.mockResolvedValue({
      id: 55,
      source: 'manual',
      chapterCount: 1,
      createdAt,
      createdById: 4,
      createdByName: 'Ann',
      chapters: [{ title: 'Only', startMs: 0 }],
    });
    repo.listVersions.mockResolvedValue([{ id: 54, source: 'embedded', chapterCount: 2, createdAt, createdById: null, createdByName: null }]);

    await expect(service.getVersion(BOOK_ID, 55, USER)).resolves.toEqual({
      id: 55,
      source: 'manual',
      chapterCount: 1,
      createdAt: createdAt.toISOString(),
      createdBy: { id: 4, name: 'Ann' },
      chapters: [{ title: 'Only', startMs: 0 }],
    });
    await expect(service.listVersions(BOOK_ID, USER)).resolves.toEqual([
      { id: 54, source: 'embedded', chapterCount: 2, createdAt: createdAt.toISOString(), createdBy: null },
    ]);
  });

  it('cleans the embedded preview and refuses it when a file cannot be read', async () => {
    const { service, metadataService } = makeService();
    metadataService.readEmbeddedChapters.mockResolvedValueOnce([
      { title: 'Late', startMs: 9_000 },
      { title: '', startMs: 0 },
    ]);

    await expect(service.readEmbedded(BOOK_ID, USER)).resolves.toEqual({
      chapters: [
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Late', startMs: 9_000 },
      ],
    });

    metadataService.readEmbeddedChapters.mockResolvedValueOnce(null);
    await expect(service.readEmbedded(BOOK_ID, USER)).rejects.toThrow(ConflictException);
  });
});

describe('ChapterEditorService.lookup', () => {
  it('asks the region the request names', async () => {
    const { service, bookService, lookupService, providerConfig } = makeService({ audibleDomain: 'audible.de' });

    await expect(service.lookup(BOOK_ID, { asin: 'B0TESTASIN', region: 'uk' }, USER)).resolves.toBe(LOOKUP_RESULT);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(BOOK_ID, USER, 'editor');
    expect(lookupService.lookup).toHaveBeenCalledWith('B0TESTASIN', 'uk');
    expect(providerConfig.getConfig).not.toHaveBeenCalled();
  });

  it('defaults to the storefront the Audible provider is set to', async () => {
    const { service, lookupService } = makeService({ audibleDomain: 'audible.co.jp' });

    await service.lookup(BOOK_ID, { asin: 'B0TESTASIN' }, USER);

    expect(lookupService.lookup).toHaveBeenCalledWith('B0TESTASIN', 'jp');
  });

  it('asks nothing for a book the user cannot reach', async () => {
    const { service, bookService, lookupService } = makeService();
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.lookup(BOOK_ID, { asin: 'B0TESTASIN', region: 'us' }, USER)).rejects.toThrow(NotFoundException);
    expect(lookupService.lookup).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.readEbook', () => {
  const EPUBS = [ebookFile(30, false), ebookFile(31, true)];

  it('lists the table of contents in reading order, flattening nesting and skipping front matter', async () => {
    const { service, epubService, bookService } = makeService({ ebookFiles: EPUBS });
    epubService.getBookInfo.mockResolvedValue({
      toc: {
        label: 'Table of Contents',
        children: [
          { label: 'Cover', href: 'cover.xhtml' },
          { label: 'Title Page', href: 'title.xhtml' },
          { label: 'Copyright', href: 'copyright.xhtml' },
          { label: 'Contents', href: 'toc.xhtml' },
          { label: 'Also by Jane Doe', href: 'also.xhtml' },
          { label: 'Praise for The Book', href: 'praise.xhtml' },
          {
            label: ' Part One ',
            href: 'p1.xhtml',
            children: [
              { label: 'Chapter 1', href: 'c1.xhtml' },
              { label: '   ', href: 'blank.xhtml', children: [{ label: 'Chapter 1.5', href: 'c1-5.xhtml' }] },
            ],
          },
          { label: 'Chapter 2', href: 'c2.xhtml' },
          { label: 'Copyright Notice Is Not Front Matter Here', href: 'x.xhtml' },
        ],
      },
    });

    const result = await service.readEbook(BOOK_ID, 'toc', USER);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(BOOK_ID, USER, 'editor');
    expect(epubService.getBookInfo).toHaveBeenCalledWith(BOOK_ID, 30, USER);
    expect(result).toEqual({
      source: 'toc',
      fileId: 30,
      titlesOnly: true,
      runtimeMs: null,
      chapters: [
        { title: 'Part One', startMs: 0 },
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Chapter 1.5', startMs: 0 },
        { title: 'Chapter 2', startMs: 0 },
        { title: 'Copyright Notice Is Not Front Matter Here', startMs: 0 },
      ],
    });
  });

  it('places read-along sections by their narration start and reports the narration length', async () => {
    const { service, epubService } = makeService({ ebookFiles: EPUBS });
    epubService.getMediaOverlayPlaylist.mockResolvedValue({
      durationSeconds: 3_600.4,
      sections: [
        { index: 0, label: null, startSeconds: 0 },
        { index: 1, label: ' Chapter One ', startSeconds: 12.3456 },
        { index: 2, label: '  ', startSeconds: 40 },
        { index: 3, label: 'Chapter Two', startSeconds: 1_800 },
      ],
    });

    const result = await service.readEbook(BOOK_ID, 'read_along', USER);

    expect(epubService.getMediaOverlayPlaylist).toHaveBeenCalledWith(BOOK_ID, 31, USER);
    expect(result).toEqual({
      source: 'read_along',
      fileId: 31,
      titlesOnly: false,
      runtimeMs: 3_600_400,
      chapters: [
        { title: 'Chapter One', startMs: 12_346 },
        { title: 'Chapter Two', startMs: 1_800_000 },
      ],
    });
  });

  it('reports no runtime when the narration length is unknown', async () => {
    const { service, epubService } = makeService({ ebookFiles: EPUBS });
    epubService.getMediaOverlayPlaylist.mockResolvedValue({ durationSeconds: null, sections: [{ index: 0, label: 'Only', startSeconds: 0 }] });

    await expect(service.readEbook(BOOK_ID, 'read_along', USER)).resolves.toMatchObject({
      runtimeMs: null,
      chapters: [{ title: 'Only', startMs: 0 }],
    });
  });

  it.each([
    { name: 'no EPUB at all', source: 'toc' as const, files: [] },
    { name: 'no read-along EPUB', source: 'read_along' as const, files: [ebookFile(30, false)] },
    { name: 'only a supplementary EPUB', source: 'toc' as const, files: [ebookFile(30, false, 'supplement')] },
  ])('refuses $name without opening a file', async ({ source, files }) => {
    const { service, epubService } = makeService({ ebookFiles: files });

    const { status, body } = await refusal(service.readEbook(BOOK_ID, source, USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable);
    expect(epubService.getBookInfo).not.toHaveBeenCalled();
    expect(epubService.getMediaOverlayPlaylist).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'no table of contents', toc: null },
    {
      name: 'a table of contents of front matter only',
      toc: { label: 'Table of Contents', children: [{ label: 'Cover' }, { label: 'Table of Contents' }] },
    },
    { name: 'an empty table of contents', toc: { label: 'Table of Contents', children: [] } },
  ])('refuses an EPUB with $name', async ({ toc }) => {
    const { service, epubService } = makeService({ ebookFiles: EPUBS });
    epubService.getBookInfo.mockResolvedValue({ toc });

    const { status, body } = await refusal(service.readEbook(BOOK_ID, 'toc', USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable);
  });

  it('refuses a read-along EPUB that names none of its sections', async () => {
    const { service, epubService } = makeService({ ebookFiles: EPUBS });
    epubService.getMediaOverlayPlaylist.mockResolvedValue({ durationSeconds: 60, sections: [{ index: 0, label: null, startSeconds: 0 }] });

    const { status, body } = await refusal(service.readEbook(BOOK_ID, 'read_along', USER));

    expect(status).toBe(409);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable);
  });

  it('reads nothing for a book the user cannot reach', async () => {
    const { service, bookService, repo, epubService } = makeService({ ebookFiles: EPUBS });
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.readEbook(BOOK_ID, 'toc', USER)).rejects.toThrow(NotFoundException);
    expect(repo.findEbookFiles).not.toHaveBeenCalled();
    expect(epubService.getBookInfo).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.analyze', () => {
  const ONE_TRACK = [track(1, 'Part 1.mp3', 60, 1)];
  const PART_1 = '/library/book/Part 1.mp3';
  const PART_2 = '/library/book/Part 2.mp3';

  it('centres a window on each point, clipped to the book, and moves its pauses onto the book timeline', async () => {
    const { service, bookService, pauseService } = makeService({ row: chapterRow(), tracks: ONE_TRACK });
    pauseService.findPauses.mockResolvedValue([{ startMs: 1_000, endMs: 1_500 }]);

    const result = await service.analyze(BOOK_ID, { points: [1_000, 30_000, 59_000, 75_000], windowMs: 6_000 }, USER);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(BOOK_ID, USER, 'editor');
    expect(result.windows).toEqual([
      { pointMs: 1_000, fromMs: 0, toMs: 4_000, pauses: [{ startMs: 1_000, endMs: 1_500 }], failed: false },
      { pointMs: 30_000, fromMs: 27_000, toMs: 33_000, pauses: [{ startMs: 28_000, endMs: 28_500 }], failed: false },
      { pointMs: 59_000, fromMs: 56_000, toMs: 60_000, pauses: [{ startMs: 57_000, endMs: 57_500 }], failed: false },
      { pointMs: 60_000, fromMs: 57_000, toMs: 60_000, pauses: [{ startMs: 58_000, endMs: 58_500 }], failed: false },
    ]);
    expect(pauseService.findPauses).toHaveBeenCalledTimes(4);
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 0, durationMs: 4_000 }], undefined);
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 27_000, durationMs: 6_000 }], undefined);
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 56_000, durationMs: 4_000 }], undefined);
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 57_000, durationMs: 3_000 }], undefined);
  });

  it('splits a window that crosses a file boundary into both files, in playback order', async () => {
    const { service, pauseService } = makeService();
    pauseService.findPauses.mockImplementation((segments) => Promise.resolve(segments.length === 2 ? [{ startMs: 2_500, endMs: 4_000 }] : []));

    const result = await service.analyze(BOOK_ID, { points: [62_000, 55_000, 80_000], windowMs: 10_000 }, USER);

    expect(pauseService.findPauses).toHaveBeenCalledWith(
      [
        { absolutePath: PART_1, offsetMs: 57_000, durationMs: 3_000 },
        { absolutePath: PART_2, offsetMs: 0, durationMs: 7_000 },
      ],
      undefined,
    );
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 50_000, durationMs: 10_000 }], undefined);
    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_2, offsetMs: 15_000, durationMs: 10_000 }], undefined);
    expect(result.windows).toEqual([
      { pointMs: 62_000, fromMs: 57_000, toMs: 67_000, pauses: [{ startMs: 59_500, endMs: 61_000 }], failed: false },
      { pointMs: 55_000, fromMs: 50_000, toMs: 60_000, pauses: [], failed: false },
      { pointMs: 80_000, fromMs: 75_000, toMs: 85_000, pauses: [], failed: false },
    ]);
  });

  it('cannot place a window that reaches into a file of unknown length with more after it', async () => {
    const tracks = [track(1, 'Part 1.mp3', 60, 1), track(2, 'Part 2.mp3', null, 2), track(3, 'Part 3.mp3', 60, 3)];
    const { service, pauseService } = makeService({ row: chapterRow(), tracks });

    const result = await service.analyze(BOOK_ID, { points: [30_000, 61_000], windowMs: 10_000 }, USER);

    expect(result.windows.map((window) => window.failed)).toEqual([false, true]);
    expect(pauseService.findPauses).toHaveBeenCalledTimes(1);
  });

  it('listens to 10 seconds around a point by default', async () => {
    const { service, pauseService } = makeService();

    const result = await service.analyze(BOOK_ID, { points: [30_000] }, USER);

    expect(pauseService.findPauses).toHaveBeenCalledWith([{ absolutePath: PART_1, offsetMs: 25_000, durationMs: 10_000 }], undefined);
    expect(result.windows).toEqual([{ pointMs: 30_000, fromMs: 25_000, toMs: 35_000, pauses: [], failed: false }]);
  });

  it('marks only the window whose audio will not decode as failed', async () => {
    const { service, pauseService } = makeService();
    pauseService.findPauses.mockImplementation((segments) =>
      segments[0]!.absolutePath === PART_2
        ? Promise.reject(new Error('Command failed: ffmpeg\nInvalid data found when processing input'))
        : Promise.resolve([{ startMs: 0, endMs: 400 }]),
    );

    const result = await service.analyze(BOOK_ID, { points: [10_000, 70_000] }, USER);

    expect(result.windows).toEqual([
      { pointMs: 10_000, fromMs: 5_000, toMs: 15_000, pauses: [{ startMs: 5_000, endMs: 5_400 }], failed: false },
      { pointMs: 70_000, fromMs: 65_000, toMs: 75_000, pauses: [], failed: true },
    ]);
  });

  it('refuses more audio than one analysis may decode, before decoding any of it', async () => {
    const { service, pauseService } = makeService({ row: chapterRow(), tracks: [track(1, 'Part 1.mp3', 36_000, 1)] });
    const windowMs = CHAPTER_PAUSE_LIMITS.maxWindowMs;
    const points = (count: number) => Array.from({ length: count }, (_, index) => windowMs * (index + 1));
    const fits = CHAPTER_PAUSE_LIMITS.maxAudioMs / windowMs;

    const { status, body } = await refusal(service.analyze(BOOK_ID, { points: points(fits + 1), windowMs }, USER));

    expect(status).toBe(400);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.analysisTooLarge);
    expect(pauseService.findPauses).not.toHaveBeenCalled();

    const atLimit = await service.analyze(BOOK_ID, { points: points(fits), windowMs }, USER);

    expect(atLimit.windows).toHaveLength(fits);
    expect(pauseService.findPauses).toHaveBeenCalledTimes(fits);
  });

  it('answers 503 when the server has no ffmpeg', async () => {
    const { service, pauseService } = makeService();
    pauseService.findPauses.mockRejectedValue(new AudioToolMissingError());

    const { status, body } = await refusal(service.analyze(BOOK_ID, { points: [10_000, 70_000] }, USER));

    expect(status).toBe(503);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.analysisUnavailable);
  });

  it('reads nothing for a book the user cannot reach', async () => {
    const { service, bookService, repo, pauseService } = makeService();
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.analyze(BOOK_ID, { points: [10_000] }, USER)).rejects.toThrow(NotFoundException);
    expect(repo.findTrackRows).not.toHaveBeenCalled();
    expect(pauseService.findPauses).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.waveform', () => {
  const PART_1 = '/library/book/Part 1.mp3';
  const PART_2 = '/library/book/Part 2.mp3';

  it('reads 16 s around the point in 320 slices by default, across a file boundary in playback order', async () => {
    const { service, bookService, pauseService } = makeService();
    pauseService.readPeaks.mockResolvedValue([0.25, 0.5]);

    const result = await service.waveform(BOOK_ID, { atMs: 62_000 }, USER);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(BOOK_ID, USER, 'editor');
    expect(pauseService.readPeaks).toHaveBeenCalledWith(
      [
        { absolutePath: PART_1, offsetMs: 54_000, durationMs: 6_000 },
        { absolutePath: PART_2, offsetMs: 0, durationMs: 10_000 },
      ],
      320,
      undefined,
    );
    expect(result).toEqual({ fromMs: 54_000, toMs: 70_000, peaks: [0.25, 0.5], failed: false });
  });

  it('honours the window and slice count asked for, clipping the window to the book', async () => {
    const { service, pauseService } = makeService();

    await expect(service.waveform(BOOK_ID, { atMs: 99_000, windowMs: 4_000, buckets: 20 }, USER)).resolves.toEqual({
      fromMs: 97_000,
      toMs: 100_000,
      peaks: [],
      failed: false,
    });
    expect(pauseService.readPeaks).toHaveBeenLastCalledWith([{ absolutePath: PART_2, offsetMs: 37_000, durationMs: 3_000 }], 20, undefined);

    await expect(service.waveform(BOOK_ID, { atMs: 150_000, windowMs: 4_000, buckets: 20 }, USER)).resolves.toMatchObject({
      fromMs: 98_000,
      toMs: 100_000,
    });
    await expect(service.waveform(BOOK_ID, { atMs: 1_000, windowMs: 4_000, buckets: 20 }, USER)).resolves.toMatchObject({
      fromMs: 0,
      toMs: 3_000,
    });
    expect(pauseService.readPeaks).toHaveBeenLastCalledWith([{ absolutePath: PART_1, offsetMs: 0, durationMs: 3_000 }], 20, undefined);
  });

  it('marks a window it cannot place on the timeline as failed without decoding', async () => {
    const tracks = [track(1, 'Part 1.mp3', 60, 1), track(2, 'Part 2.mp3', null, 2), track(3, 'Part 3.mp3', 60, 3)];
    const { service, pauseService } = makeService({ row: chapterRow(), tracks });

    await expect(service.waveform(BOOK_ID, { atMs: 61_000, windowMs: 10_000 }, USER)).resolves.toEqual({
      fromMs: 56_000,
      toMs: 66_000,
      peaks: [],
      failed: true,
    });
    expect(pauseService.readPeaks).not.toHaveBeenCalled();
  });

  it('marks a window whose audio will not decode as failed', async () => {
    const { service, pauseService } = makeService();
    pauseService.readPeaks.mockRejectedValue(new Error('Command failed: ffmpeg\nInvalid data found when processing input'));

    await expect(service.waveform(BOOK_ID, { atMs: 30_000 }, USER)).resolves.toEqual({
      fromMs: 22_000,
      toMs: 38_000,
      peaks: [],
      failed: true,
    });
  });

  it('answers 503 when the server has no ffmpeg', async () => {
    const { service, pauseService } = makeService();
    pauseService.readPeaks.mockRejectedValue(new AudioToolMissingError());

    const { status, body } = await refusal(service.waveform(BOOK_ID, { atMs: 30_000 }, USER));

    expect(status).toBe(503);
    expect(body.errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.analysisUnavailable);
  });

  it('reads nothing for a book the user cannot reach', async () => {
    const { service, bookService, repo, pauseService } = makeService();
    bookService.verifyBookAccess.mockRejectedValueOnce(new NotFoundException('Book 9 not found'));

    await expect(service.waveform(BOOK_ID, { atMs: 30_000 }, USER)).rejects.toThrow(NotFoundException);
    expect(repo.findTrackRows).not.toHaveBeenCalled();
    expect(pauseService.readPeaks).not.toHaveBeenCalled();
  });
});

describe('ChapterEditorService.bulkLookup', () => {
  // TWO_TRACKS play for 100 s; Audible's runtime adds a 2 s lead-in and a 3 s sign-off.
  const CONFIDENT: ChapterLookupResult = {
    provider: 'audible',
    asin: 'B000TEST',
    region: 'us',
    chapters: [
      { title: 'Opening Credits', startMs: 0, lengthMs: 30_000, children: [] },
      {
        title: 'Part One',
        startMs: 30_000,
        lengthMs: 70_000,
        children: [{ title: 'Chapter 1', startMs: 65_000, lengthMs: 40_000, children: [] }],
      },
    ],
    runtimeMs: 105_000,
    brandIntroMs: 2_000,
    brandOutroMs: 3_000,
    isAccurate: true,
  };

  it('applies a confident lookup as provider chapters on behalf of the queuer, then locks them', async () => {
    const { service, bookService, lookupService, audiobookChapters, lockService } = makeService({ lockedFields: ['title'] });
    lookupService.lookup.mockResolvedValue(CONFIDENT);

    const outcome = await service.bulkLookup(BOOK_ID, USER.id);

    const applied = [
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Part One', startMs: 28_000 },
      { title: 'Chapter 1', startMs: 63_000 },
    ];
    expect(audiobookChapters.saveLookedUpChapters).toHaveBeenCalledWith(
      BOOK_ID,
      applied,
      USER.id,
      expect.objectContaining({ expectedRevision: expect.any(String), requireUnlocked: true, locked: true }),
    );
    expect(audiobookChapters.saveEditedChapters).not.toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();

    expect(outcome).toEqual({
      status: 'applied',
      reason: null,
      result: { provider: 'audible', chapterCount: 3, runtimeMs: 105_000, totalDurationMs: 100_000, isAccurate: true },
    });
    expect(bookService.verifyBookAccess).toHaveBeenCalledTimes(2);
  });

  it('skips mutation when the queuer is gone', async () => {
    const { service, lookupService, audiobookChapters } = makeService();
    lookupService.lookup.mockResolvedValue(CONFIDENT);

    await expect(service.bulkLookup(BOOK_ID, null)).resolves.toMatchObject({ status: 'skipped' });
    expect(audiobookChapters.saveLookedUpChapters).not.toHaveBeenCalled();
  });

  it('looks the stored ASIN up, trimmed and upper-cased, on the storefront the Audible provider is set to', async () => {
    const { service, lookupService } = makeService({ row: chapterRow({ audibleId: ' b0testasin ' }), audibleDomain: 'co.uk' });
    lookupService.lookup.mockResolvedValue(CONFIDENT);

    await service.bulkLookup(BOOK_ID, USER.id);

    expect(lookupService.lookup).toHaveBeenCalledWith('B0TESTASIN', 'uk');
  });

  it('leaves a list protected by the chapters lock for review without replacing it', async () => {
    const { service, lookupService, audiobookChapters, lockService } = makeService({ lockedFields: ['chapters'] });
    lookupService.lookup.mockResolvedValue(CONFIDENT);

    const outcome = await service.bulkLookup(BOOK_ID, USER.id);

    expect(outcome).toEqual({
      status: 'review',
      reason: 'locked',
      // Counted with the parts opened up, the way the review sheet lists them.
      result: { provider: 'audible', chapterCount: 3, runtimeMs: 105_000, totalDurationMs: 100_000, isAccurate: true },
    });
    expect(audiobookChapters.saveLookedUpChapters).not.toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'inexact timings', lookup: { isAccurate: false }, reason: 'not_exact' },
    { name: 'a runtime 5 s away from the book', lookup: { runtimeMs: 110_000 }, reason: 'runtime_mismatch' },
    {
      name: 'a single chapter',
      lookup: { chapters: [{ title: 'Whole Book', startMs: 0, lengthMs: 105_000, children: [] }] },
      reason: 'implausible',
    },
  ])('leaves $name for review with what was found, saving nothing', async ({ lookup, reason }) => {
    const { service, lookupService, audiobookChapters, lockService } = makeService();
    const found = { ...CONFIDENT, chapters: CONFIDENT.chapters.slice(0, 1), ...lookup };
    lookupService.lookup.mockResolvedValue(found);

    const outcome = await service.bulkLookup(BOOK_ID, USER.id);

    expect(outcome).toEqual({
      status: 'review',
      reason,
      result: {
        provider: 'audible',
        chapterCount: found.chapters.length,
        runtimeMs: found.runtimeMs,
        totalDurationMs: 100_000,
        isAccurate: found.isAccurate,
      },
    });
    expect(audiobookChapters.saveLookedUpChapters).not.toHaveBeenCalled();
    expect(lockService.replaceLockedFields).not.toHaveBeenCalled();
  });

  it('leaves a book whose length is unknown for review', async () => {
    const { service, lookupService } = makeService({ row: chapterRow({ audibleId: 'B000TEST' }), tracks: [track(1, 'Part 1.mp3', null, 1)] });
    lookupService.lookup.mockResolvedValue(CONFIDENT);

    await expect(service.bulkLookup(BOOK_ID, USER.id)).resolves.toMatchObject({
      status: 'review',
      reason: 'unknown_length',
      result: { totalDurationMs: null },
    });
  });

  it('reports a 404 lookup as not found', async () => {
    const { service, lookupService, audiobookChapters } = makeService();
    lookupService.lookup.mockRejectedValue(
      new HttpException({ message: 'No chapters were found for that ASIN', errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupNotFound }, 404),
    );

    await expect(service.bulkLookup(BOOK_ID, USER.id)).resolves.toEqual({ status: 'not_found', reason: null, result: null });
    expect(audiobookChapters.saveLookedUpChapters).not.toHaveBeenCalled();
  });

  it('throws when the chapter sources cannot be reached, so the book is tried again', async () => {
    const { service, lookupService } = makeService();
    const unreachable = new HttpException({ message: 'The chapter sources could not be reached' }, 502);
    lookupService.lookup.mockRejectedValue(unreachable);

    await expect(service.bulkLookup(BOOK_ID, USER.id)).rejects.toBe(unreachable);
  });

  it.each([
    { name: 'no metadata row', row: null },
    { name: 'no ASIN', row: chapterRow({ audibleId: null }) },
    { name: 'a blank ASIN', row: chapterRow({ audibleId: '   ' }) },
  ])('skips a book with $name without asking Audible', async ({ row }) => {
    const { service, lookupService } = makeService({ row });

    await expect(service.bulkLookup(BOOK_ID, USER.id)).resolves.toEqual({ status: 'skipped', reason: 'no_asin', result: null });
    expect(lookupService.lookup).not.toHaveBeenCalled();
  });

  it('skips a book that no longer has audio tracks', async () => {
    const { service, lookupService } = makeService({ tracks: [track(3, 'cover.jpg', null, 0, 'jpg')] });

    await expect(service.bulkLookup(BOOK_ID, USER.id)).resolves.toEqual({ status: 'skipped', reason: 'no_audio', result: null });
    expect(lookupService.lookup).not.toHaveBeenCalled();
  });

  it('lets any other failure loading the book through, so it is tried again', async () => {
    const { service, repo } = makeService();
    const failure = new Error('connection terminated');
    repo.findTrackRows.mockRejectedValue(failure);

    await expect(service.bulkLookup(BOOK_ID, USER.id)).rejects.toBe(failure);
  });
});
