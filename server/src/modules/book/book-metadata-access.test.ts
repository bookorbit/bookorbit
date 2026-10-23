import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { tmpdir } from 'os';
import { EMPTY_CONTENT_FILTER_RULES, Permission, type AccessLevel } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryRepository } from '../library/library.repository';
import { LibraryService } from '../library/library.service';
import { MetadataService } from '../metadata/metadata.service';
import { MetadataFetchPipeline } from '../metadata-fetch/metadata-fetch-pipeline';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { FileWriteService } from '../file-write/file-write.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { CoverService } from '../cover/cover.service';
import { BulkEditFieldsDto } from './dto/bulk-edit-metadata.dto';
import { BookRepository } from './book.repository';
import { BookReadService } from './book-read.service';
import { BookService } from './book.service';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { AchievementEventsService } from '../achievement/achievement-events.service';
import { AudiobookEbookProgressSyncService } from './audiobook-ebook-progress-sync.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';

const user: RequestUser = {
  id: 11,
  username: 'metadata-editor',
  name: 'Metadata Editor',
  email: null,
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [Permission.LibraryEditMetadata],
  contentFilters: EMPTY_CONTENT_FILTER_RULES,
};

type Context = Awaited<ReturnType<typeof createContext>>;

async function createContext(role: AccessLevel | null = 'viewer') {
  const roles = new Map<number, AccessLevel | null>([
    [7, role],
    [8, 'editor'],
    [9, 'owner'],
  ]);
  const bookLibraries = new Map([
    [1, 7],
    [2, 8],
    [3, 9],
  ]);
  const libraryRepo = {
    hasUserAccess: vi.fn((_userId: number, libraryId: number) => Boolean(roles.get(libraryId))),
    findUserAccessLevel: vi.fn((_userId: number, libraryId: number) => roles.get(libraryId) ?? null),
  };
  const bookRepo = {
    findLibraryIdByBookId: vi.fn((id: number) => bookLibraries.get(id) ?? null),
    findLibraryIdsByBookIds: vi.fn((ids: number[]) =>
      ids.filter((id) => bookLibraries.has(id)).map((id) => ({ id, libraryId: bookLibraries.get(id)! })),
    ),
    findById: vi.fn((id: number) => {
      const libraryId = bookLibraries.get(id);
      return libraryId === undefined
        ? null
        : {
            book: { books: { id, libraryId }, book_metadata: {} },
            authorRows: [],
            genreRows: [],
            communityRatingRows: [],
            fileRows: [],
            narratorRows: [],
          };
    }),
    checkBookPassesContentFilters: vi.fn().mockResolvedValue(true),
    withTransaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
    updateMetadataFields: vi.fn(),
    updateAddedAt: vi.fn(),
    bulkUpdateMetadataFields: vi.fn(),
    bulkSetRating: vi.fn(),
    findCoverSourceFilesByBookIds: vi.fn().mockResolvedValue([]),
    findProgress: vi.fn().mockResolvedValue(null),
    upsertProgress: vi.fn(),
    findFileById: vi.fn().mockResolvedValue({ id: 10, bookId: 1, libraryId: 7 }),
    findProgressByBook: vi.fn().mockResolvedValue(0),
  };
  const metadata = { replaceAuthors: vi.fn(), replaceTags: vi.fn(), replaceGenres: vi.fn(), downloadAndSaveCover: vi.fn() };
  const locks = {
    assertManualUpdateAllowed: vi.fn(),
    assertFieldsUnlocked: vi.fn(),
    replaceLockedFields: vi.fn().mockResolvedValue([]),
    bulkReplaceLockedFields: vi.fn(),
    getBookIdsWithLockedField: vi.fn().mockResolvedValue(new Set()),
    getLockedFieldsMap: vi.fn().mockResolvedValue(new Map()),
  };
  const pipeline = { run: vi.fn(), runWithSources: vi.fn() };
  const coverStore = { saveCustom: vi.fn(), revert: vi.fn(), chooseWriteMedium: vi.fn().mockResolvedValue('ebook') };
  const fileWrite = {
    scheduleWrite: vi.fn(),
    writeToFile: vi.fn(),
    cancelPendingWrite: vi.fn(),
    findLibraryWriteSettingsForBook: vi.fn().mockResolvedValue({ fileWriteEnabled: false, fileRenameEnabled: false }),
  };
  const fileRename = { scheduleRename: vi.fn(), cancelPendingRename: vi.fn(), performRename: vi.fn() };
  const score = { calculateAndSave: vi.fn(), calculateAndSaveMany: vi.fn() };
  const mocks = new Map<unknown, unknown>([
    [BookEmbedderService, { embedBook: vi.fn().mockResolvedValue(undefined) }],
    [MetadataScoreService, score],
    [AchievementEventsService, { emit: vi.fn() }],
    [AudiobookEbookProgressSyncService, { syncFromEbookProgress: vi.fn(), advanceNarrationToText: vi.fn() }],
    [UserBookStatusService, { autoUpdate: vi.fn(), findOne: vi.fn() }],
    [ConfigService, { get: vi.fn().mockReturnValue(tmpdir()) }],
    [LibraryRepository, libraryRepo],
    [BookRepository, bookRepo],
    [BookReadService, bookRepo],
    [MetadataService, metadata],
    [BookMetadataLockService, locks],
    [MetadataFetchPipeline, pipeline],
    [BookCoverStore, coverStore],
    [FileWriteService, fileWrite],
    [FileRenameService, fileRename],
  ]);
  const module = await Test.createTestingModule({ providers: [BookService, LibraryService, CoverService] })
    .useMocker((token) => mocks.get(token) ?? {})
    .compile();
  const service = module.get(BookService);
  vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 1 } as never);
  return {
    module,
    service,
    covers: module.get(CoverService),
    roles,
    bookRepo,
    libraryRepo,
    metadata,
    locks,
    pipeline,
    coverStore,
    fileWrite,
    fileRename,
    score,
  };
}

const singleWrites: { name: string; run: (ctx: Context, caller: RequestUser) => Promise<unknown> }[] = [
  { name: 'metadata', run: ({ service }, caller) => service.updateMetadata(1, { title: 'Changed' }, caller) },
  {
    name: 'metadata and locks',
    run: ({ service }, caller) => service.updateMetadataAndLocks(1, { metadata: { title: 'Changed' }, lockedFields: [] }, caller),
  },
  { name: 'locks only', run: ({ service }, caller) => service.updateMetadataLocks(1, [], caller) },
  { name: 'added date', run: ({ service }, caller) => service.updateAddedAt(1, { addedAt: '2025-01-01' }, caller) },
  { name: 'write and rename', run: ({ service }, caller) => service.writeAndRename(1, caller) },
  { name: 'file rename', run: ({ service }, caller) => service.renameFile(10, { filename: 'renamed.epub' }, caller) },
  { name: 'metadata refresh', run: ({ service }, caller) => service.refreshMetadata(1, false, caller) },
  { name: 'cover regeneration', run: ({ service }, caller) => service.reExtractCover(1, caller) },
  { name: 'cover upload', run: ({ covers }, caller) => covers.uploadCover(1, Buffer.from('image'), 'image/png', caller) },
  { name: 'cover URL upload', run: ({ covers }, caller) => covers.uploadCoverFromUrl(1, 'https://example.com/cover.png', caller) },
  { name: 'cover deletion', run: ({ covers }, caller) => covers.deleteCover(1, caller) },
];

const bulkWrites: { name: string; run: (ctx: Context, ids: number[]) => Promise<unknown> }[] = [
  { name: 'set metadata', run: ({ service }, ids) => service.bulkSetMetadata(ids, 'publisher', 'Changed', user) },
  { name: 'update tags', run: ({ service }, ids) => service.bulkUpdateTags(ids, 'replace', ['Changed'], user) },
  { name: 'set locks', run: ({ service }, ids) => service.bulkSetMetadataLock(ids, true, user) },
  {
    name: 'edit metadata',
    run: ({ service }, ids) => service.bulkEditMetadata(ids, Object.assign(new BulkEditFieldsDto(), { publisher: { value: 'Changed' } }), user),
  },
  { name: 'refresh metadata', run: ({ service }, ids) => service.bulkRefreshMetadata(ids, user) },
  { name: 'regenerate covers', run: ({ service }, ids) => service.bulkReExtractCover(ids, user) },
];

function expectNoWrites(ctx: Context) {
  for (const mock of [
    ctx.bookRepo.withTransaction,
    ctx.bookRepo.updateMetadataFields,
    ctx.bookRepo.updateAddedAt,
    ctx.bookRepo.bulkUpdateMetadataFields,
    ctx.metadata.replaceAuthors,
    ctx.metadata.replaceTags,
    ctx.metadata.replaceGenres,
    ctx.metadata.downloadAndSaveCover,
    ctx.locks.replaceLockedFields,
    ctx.locks.bulkReplaceLockedFields,
    ctx.pipeline.run,
    ctx.pipeline.runWithSources,
    ctx.coverStore.saveCustom,
    ctx.coverStore.revert,
    ctx.fileWrite.scheduleWrite,
    ctx.fileWrite.writeToFile,
    ctx.fileWrite.cancelPendingWrite,
    ctx.fileRename.cancelPendingRename,
    ctx.fileRename.scheduleRename,
    ctx.fileRename.performRename,
  ])
    expect(mock).not.toHaveBeenCalled();
}

describe('library roles for book metadata writes', () => {
  const modules: Context['module'][] = [];
  async function context(role: AccessLevel | null = 'viewer') {
    const ctx = await createContext(role);
    modules.push(ctx.module);
    return ctx;
  }
  afterEach(async () => {
    await Promise.all(modules.splice(0).map((module) => module.close()));
    vi.restoreAllMocks();
  });

  it.each(singleWrites)('rejects a viewer before $name has side effects', async ({ run }) => {
    const ctx = await context();
    await expect(run(ctx, user)).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it.each([
    { role: 'viewer' as const, ids: [1], rating: 4 },
    { role: 'editor' as const, ids: [1], rating: null },
    { role: 'owner' as const, ids: [1], rating: 5 },
    { role: 'viewer' as const, ids: [1, 2, 3], rating: 3 },
  ])('keeps personal ratings separate from shared metadata effects for $role and $ids', async ({ role, ids, rating }) => {
    const ctx = await context(role);
    await ctx.service.bulkSetRating(ids, rating, user);
    expect(ctx.bookRepo.bulkSetRating).toHaveBeenCalledWith(ids, rating, user.id);
    expectNoWrites(ctx);
    expect(ctx.score.calculateAndSaveMany).not.toHaveBeenCalled();
  });

  it('rejects a personal-rating batch with an inaccessible book before persisting anything', async () => {
    const ctx = await context(null);
    await expect(ctx.service.bulkSetRating([2, 1], 4, user)).rejects.toThrow(ForbiddenException);
    expect(ctx.bookRepo.bulkSetRating).not.toHaveBeenCalled();
    expectNoWrites(ctx);
  });

  it.each(bulkWrites)('rejects a mixed editor/viewer batch before $name writes anything', async ({ run }) => {
    const ctx = await context();
    await expect(run(ctx, [2, 1])).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it.each(['editor', 'owner'] as const)('allows %s to persist metadata', async (role) => {
    const ctx = await context(role);
    await ctx.service.updateMetadata(1, { title: 'Changed' }, user);
    expect(ctx.bookRepo.updateMetadataFields).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Changed' }), expect.anything());
  });

  it('allows a superuser without membership to persist metadata', async () => {
    const ctx = await context(null);
    await ctx.service.updateMetadata(1, { title: 'Changed' }, { ...user, isSuperuser: true, permissions: [] });
    expect(ctx.bookRepo.updateMetadataFields).toHaveBeenCalled();
    expect(ctx.libraryRepo.hasUserAccess).not.toHaveBeenCalled();
    expect(ctx.libraryRepo.findUserAccessLevel).not.toHaveBeenCalled();
  });

  it('keeps missing membership and missing books concealed as 404', async () => {
    const ctx = await context(null);
    await expect(ctx.service.updateMetadata(1, { title: 'Changed' }, user)).rejects.toThrow(NotFoundException);
    await expect(ctx.service.updateMetadata(99, { title: 'Changed' }, user)).rejects.toThrow(NotFoundException);
    expectNoWrites(ctx);
  });

  it('conceals content-filtered books before checking editor access', async () => {
    const ctx = await context();
    ctx.bookRepo.checkBookPassesContentFilters.mockResolvedValue(false);
    await expect(ctx.service.updateMetadata(1, { title: 'Changed' }, user)).rejects.toThrow(NotFoundException);
    expect(ctx.libraryRepo.findUserAccessLevel).not.toHaveBeenCalled();
    expectNoWrites(ctx);
  });

  it('rechecks a downgraded role for each write', async () => {
    const ctx = await context('editor');
    await ctx.service.updateMetadata(1, { title: 'Allowed' }, user);
    ctx.bookRepo.updateMetadataFields.mockClear();
    ctx.roles.set(7, 'viewer');
    await expect(ctx.service.updateMetadataAndLocks(1, { metadata: { title: 'Denied' }, lockedFields: [] }, user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(ctx.bookRepo.updateMetadataFields).not.toHaveBeenCalled();
  });

  it('validates every library once for bulk locks and deduplicates book IDs', async () => {
    const ctx = await context('editor');
    await ctx.service.bulkSetMetadataLock([1, 2, 3, 1], true, user);
    expect(ctx.bookRepo.findLibraryIdsByBookIds).toHaveBeenCalledWith([1, 2, 3]);
    expect(ctx.libraryRepo.findUserAccessLevel.mock.calls).toEqual([
      [user.id, 7],
      [user.id, 8],
      [user.id, 9],
    ]);
    expect(ctx.locks.bulkReplaceLockedFields).toHaveBeenCalled();
  });

  it.each(bulkWrites)('rejects missing IDs before bulk $name writes anything', async ({ run }) => {
    const ctx = await context('editor');
    await expect(run(ctx, [2, 99])).rejects.toThrow(NotFoundException);
    expectNoWrites(ctx);
  });

  it('preserves viewer access to reading progress', async () => {
    const ctx = await context();
    await ctx.service.saveProgress(user.id, 10, { percentage: 25 }, user);
    expect(ctx.bookRepo.upsertProgress).toHaveBeenCalled();
    expect(ctx.libraryRepo.findUserAccessLevel).not.toHaveBeenCalled();
  });
});
