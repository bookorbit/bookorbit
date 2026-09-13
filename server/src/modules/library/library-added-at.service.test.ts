import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { LibraryAddedAtService } from './library-added-at.service';
import { LibraryRepository } from './library.repository';
import { PathPolicyService } from '../path/path-policy.service';
import type { RequestUser } from '../../common/types/request-user';
import { realpath, stat } from 'fs/promises';

vi.mock('fs/promises', () => ({ realpath: vi.fn(), stat: vi.fn() }));

const user = { id: 7, isSuperuser: false } as RequestUser;
const oldTime = new Date('2020-01-01T00:00:00Z');
const newTime = new Date('2022-01-01T00:00:00Z');
const book = (id: number) => ({ id, addedAt: newTime, previousAddedAt: '2022-01-01 00:00:00.000123+00' });
const file = (id: number, bookId = id) => ({ id, bookId, absolutePath: `/library/${id}.epub`, rootPath: '/library', mtime: oldTime });

describe('LibraryAddedAtService', () => {
  let module: TestingModule;
  let service: LibraryAddedAtService;
  const repo = {
    hasUserAccess: vi.fn(),
    findById: vi.fn(),
    getAddedAtRecomputeBounds: vi.fn(),
    findAddedAtBookBatch: vi.fn(),
    findAddedAtFileBatch: vi.fn(),
    findAddedAtMtimes: vi.fn(),
    updateAddedAtBatch: vi.fn(),
  };
  const pathPolicy = { assertWithinBrowseRoot: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    repo.hasUserAccess.mockResolvedValue(true);
    repo.findById.mockResolvedValue([{ id: 1, addedAtSource: 'file_modified' }]);
    repo.getAddedAtRecomputeBounds.mockResolvedValue({ total: 1, maxId: 1 });
    repo.findAddedAtBookBatch.mockResolvedValue([book(1)]);
    repo.findAddedAtMtimes.mockResolvedValue([{ bookId: 1, mtime: oldTime }]);
    repo.findAddedAtFileBatch.mockImplementation((_lib, _ids, after) => Promise.resolve(after === 0 ? [file(1)] : []));
    repo.updateAddedAtBatch.mockImplementation((_lib, changes) => Promise.resolve(changes.map(({ id }: { id: number }) => id)));
    pathPolicy.assertWithinBrowseRoot.mockResolvedValue('/library');
    vi.mocked(realpath).mockImplementation((path) => Promise.resolve(String(path)));
    vi.mocked(stat).mockResolvedValue({ birthtime: oldTime, mtime: newTime, isFile: () => true } as Awaited<ReturnType<typeof stat>>);
    module = await Test.createTestingModule({
      providers: [LibraryAddedAtService, { provide: LibraryRepository, useValue: repo }, { provide: PathPolicyService, useValue: pathPolicy }],
    }).compile();
    service = module.get(LibraryAddedAtService);
  });
  afterEach(async () => {
    await module.close();
  });

  async function complete(libraryId = 1) {
    await vi.waitFor(async () => {
      expect((await service.get(libraryId, user))?.status).not.toBe('running');
    });
    return (await service.get(libraryId, user))!;
  }

  it('returns immediately, updates bounded batches, and retains progress for reopening', async () => {
    const all = Array.from({ length: 251 }, (_, i) => book(i + 1));
    repo.getAddedAtRecomputeBounds.mockResolvedValue({ total: all.length, maxId: 251 });
    repo.findAddedAtBookBatch.mockImplementation((_lib, after, max, limit) =>
      Promise.resolve(all.filter(({ id }) => id > after && id <= max).slice(0, limit)),
    );
    repo.findAddedAtMtimes.mockImplementation((_lib, ids: number[]) => Promise.resolve(ids.map((bookId) => ({ bookId, mtime: oldTime }))));
    const initial = await service.start(1, user);
    expect(initial.status).toBe('running');
    expect(repo.updateAddedAtBatch).not.toHaveBeenCalled();
    const result = await complete();
    expect(result).toMatchObject({ total: 251, processed: 251, updated: 251, failed: 0, status: 'completed' });
    expect(repo.findAddedAtBookBatch.mock.calls.map((args) => args[1])).toEqual([0, 100, 200]);
    expect(repo.updateAddedAtBatch.mock.calls.every((args) => args[1].length <= 100)).toBe(true);
    expect(repo.findAddedAtFileBatch).not.toHaveBeenCalled();
    expect(initial.processed).toBe(0);
  });

  it('does not change dates when already correct or when no usable timestamp exists', async () => {
    repo.getAddedAtRecomputeBounds.mockResolvedValue({ total: 2, maxId: 2 });
    repo.findAddedAtBookBatch.mockResolvedValue([book(1), book(2)]);
    repo.findAddedAtMtimes.mockResolvedValue([
      { bookId: 1, mtime: newTime },
      { bookId: 2, mtime: new Date(0) },
    ]);
    await service.start(1, user);
    expect(await complete()).toMatchObject({ unchanged: 1, skipped: 1, updated: 0, processed: 2 });
    expect(repo.updateAddedAtBatch).not.toHaveBeenCalled();
  });

  it('preserves the entire book if one content file is unreadable', async () => {
    repo.findById.mockResolvedValue([{ addedAtSource: 'file_created' }]);
    repo.findAddedAtFileBatch.mockImplementation((_lib, _ids, after) => Promise.resolve(after === 0 ? [file(1, 1), file(2, 1)] : []));
    vi.mocked(stat)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ birthtime: oldTime, isFile: () => true } as never);
    await service.start(1, user);
    expect(await complete()).toMatchObject({ failed: 1, updated: 0, failureSamples: [{ bookId: 1, code: 'file_unavailable' }] });
    expect(repo.updateAddedAtBatch).not.toHaveBeenCalled();
  });

  it('paginates one large book and falls back from birthtime to mtime', async () => {
    repo.findById.mockResolvedValue([{ addedAtSource: 'file_created' }]);
    const files = Array.from({ length: 451 }, (_, i) => file(i + 1, 1));
    repo.findAddedAtFileBatch.mockImplementation((_lib, _ids, after, limit) => Promise.resolve(files.filter(({ id }) => id > after).slice(0, limit)));
    vi.mocked(stat).mockResolvedValue({ birthtime: new Date(0), mtime: oldTime, isFile: () => true } as never);
    await service.start(1, user);
    expect(await complete()).toMatchObject({ updated: 1 });
    expect(repo.findAddedAtFileBatch.mock.calls.map((args) => args[2])).toEqual([0, 200, 400, 451]);
    expect(repo.updateAddedAtBatch).toHaveBeenCalledWith(1, [{ id: 1, addedAt: oldTime, previousAddedAt: book(1).previousAddedAt }]);
  });

  it('rejects symlinks that resolve outside the configured library folder', async () => {
    repo.findById.mockResolvedValue([{ addedAtSource: 'file_created' }]);
    vi.mocked(realpath).mockImplementation((path) => Promise.resolve(String(path).endsWith('.epub') ? '/outside/book.epub' : String(path)));
    await service.start(1, user);
    expect(await complete()).toMatchObject({ failed: 1, failureSamples: [{ bookId: 1, code: 'unsafe_path' }] });
    expect(stat).not.toHaveBeenCalled();
  });

  it('counts database failures and continues subsequent batches with bounded failure samples', async () => {
    repo.getAddedAtRecomputeBounds.mockResolvedValue({ total: 101, maxId: 101 });
    repo.findAddedAtBookBatch.mockImplementation((_lib, after) =>
      Promise.resolve(after === 0 ? Array.from({ length: 100 }, (_, i) => book(i + 1)) : [book(101)]),
    );
    repo.findAddedAtMtimes.mockImplementation((_lib, ids: number[]) => Promise.resolve(ids.map((bookId) => ({ bookId, mtime: oldTime }))));
    repo.updateAddedAtBatch.mockRejectedValueOnce(new Error('database unavailable'));
    await service.start(1, user);
    const result = await complete();
    expect(result).toMatchObject({ processed: 101, failed: 100, updated: 1, status: 'completed' });
    expect(result.failureSamples).toHaveLength(10);
    expect(result.failureSamples[0]).toEqual({ bookId: 1, code: 'database_error' });
  });

  it('reports a terminal failure while retaining counts for already committed batches', async () => {
    repo.getAddedAtRecomputeBounds.mockResolvedValue({ total: 2, maxId: 2 });
    repo.findAddedAtBookBatch.mockResolvedValueOnce([book(1)]).mockRejectedValueOnce(new Error('connection lost'));
    await service.start(1, user);
    expect(await complete()).toMatchObject({ status: 'failed', processed: 1, updated: 1, total: 2 });
  });

  it('checks library access and keeps another user job private', async () => {
    repo.hasUserAccess.mockResolvedValueOnce(false);
    await expect(service.start(1, user)).rejects.toBeInstanceOf(ForbiddenException);
    await service.start(1, user);
    expect(await service.get(1, { ...user, id: 8 })).toBeNull();
    await complete();
    repo.hasUserAccess.mockResolvedValueOnce(false);
    await expect(service.get(1, user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects import-time sources, duplicate runs, and excess global concurrency', async () => {
    repo.findById.mockResolvedValueOnce([{ addedAtSource: 'imported' }]);
    await expect(service.start(1, user)).rejects.toBeInstanceOf(BadRequestException);
    await service.start(1, user);
    await expect(service.start(1, user)).rejects.toBeInstanceOf(ConflictException);
    await service.start(2, user);
    await expect(service.start(3, user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await complete(1);
    await complete(2);
  });
});
