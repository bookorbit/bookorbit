import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtemp, rename, rm, stat, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { djvuBundleFixture, djvuPageFixture } from '../../../../test/e2e/djvu-fixture';
import { djvuConfig, storageConfig } from '../../../config/config';
import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';
import { PathPolicyService } from '../../path/path-policy.service';
import { DjvuProcess } from '../../djvu/djvu-process';
import { DjvuDocumentService } from '../../djvu/djvu-document.service';
import { DjvuService } from './djvu.service';

describe('DjVu reader service', () => {
  let module: TestingModule;
  let service: DjvuService;
  let directory: string;
  let path: string;
  const access = vi.fn();
  const run = vi.fn();
  const user = { id: 7 } as RequestUser;
  const config = { maxConcurrent: 2, timeoutMs: 200, maxSourceBytes: 1024 * 1024, cacheBytes: 128 * 1024 };

  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'djvu-service-test-'));
    path = join(directory, 'source.djvu');
    await writeFile(path, djvuPageFixture());
    access.mockResolvedValue({ absolutePath: path, libraryFolderPath: directory, format: 'djvu' });
    run.mockImplementation(async (binary: string, args: string[]) => {
      if (binary === 'djvused') return '1\n';
      await sharp({ create: { width: 80, height: 120, channels: 3, background: 'white' } })
        .tiff()
        .toFile(args.at(-1)!);
      return '';
    });
    module = await Test.createTestingModule({
      providers: [
        DjvuService,
        DjvuDocumentService,
        PathPolicyService,
        { provide: BookService, useValue: { verifyFileAccess: access } },
        { provide: DjvuProcess, useValue: { run, onModuleDestroy: vi.fn() } },
        { provide: djvuConfig.KEY, useValue: config },
        { provide: storageConfig.KEY, useValue: { libraryBrowseRoot: directory } },
      ],
    }).compile();
    service = module.get(DjvuService);
  });
  afterEach(async () => {
    await module.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('coalesces metadata and page work and returns bounded WebP', async () => {
    const pages = await Promise.all([service.getPage(1, 0, 1280, user), service.getPage(1, 0, 1280, user)]);
    expect(access).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.filter(([binary]) => binary === 'djvused')).toHaveLength(1);
    expect(run.mock.calls.filter(([binary]) => binary === 'ddjvu')).toHaveLength(1);
    expect(pages[0]).toEqual(pages[1]);
    const page = pages[0]!;
    if (page.notModified) throw new Error('Expected rendered page');
    expect(await sharp(page.buffer).metadata()).toMatchObject({ format: 'webp', width: 80, height: 120 });
  });

  it('rechecks ownership before cached and conditional responses', async () => {
    const page = await service.getPage(1, 0, 1280, user);
    expect(await service.getPage(1, 0, 1280, user, `W/${page.etag}`)).toEqual({ notModified: true, etag: page.etag });
    access.mockRejectedValue(new ForbiddenException());
    await expect(service.getPage(1, 0, 1280, user, page.etag)).rejects.toMatchObject({ status: 403 });
    await expect(service.getPageCount(1, user)).rejects.toMatchObject({ status: 403 });
    await expect(service.getPageText(1, 0, user)).rejects.toMatchObject({ status: 403 });
  });

  it('invalidates metadata and validators when the source is replaced', async () => {
    const first = await service.getPage(1, 0, 1280, user);
    const replacement = join(directory, 'replacement.djvu');
    await writeFile(replacement, djvuBundleFixture());
    await rename(replacement, path);
    run.mockResolvedValue('2\n');
    expect(await service.getPageCount(1, user)).toBe(2);
    const conditional = await service.getPage(1, 0, 1280, user, '*');
    expect(conditional.etag).not.toBe(first.etag);
  });

  it('rejects missing pages, render sizes, and invalid magic before decoding', async () => {
    await expect(service.getPage(1, -1, 1280, user)).rejects.toMatchObject({ status: 404 });
    await expect(service.getPage(1, 1, 1280, user)).rejects.toMatchObject({ status: 404 });
    await expect(service.getPage(1, 0, 65535, user)).rejects.toMatchObject({ status: 422 });
    await writeFile(path, 'not a djvu');
    await expect(service.getPageCount(1, user)).rejects.toMatchObject({ status: 422 });
    expect(run.mock.calls.filter(([binary]) => binary === 'ddjvu')).toHaveLength(0);
  });

  it('rejects a symlink escaping the authorized folder', async () => {
    const external = await mkdtemp(join(tmpdir(), 'djvu-external-test-'));
    try {
      const outside = join(external, 'external.djvu');
      await writeFile(outside, djvuPageFixture());
      const link = join(directory, 'link.djvu');
      await symlink(outside, link);
      access.mockResolvedValue({ absolutePath: link, libraryFolderPath: directory, format: 'djvu' });
      await expect(service.getPageCount(1, user)).rejects.toMatchObject({ status: 403 });
      expect(run).not.toHaveBeenCalled();
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  it('rejects excess queued work and drains the admitted requests', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementation(async () => {
      await blocked;
      return '1';
    });
    const requests = Array.from({ length: 19 }, () => service.getPageCount(1, user));
    const completed = Promise.allSettled(requests);
    await vi.waitFor(() => expect(access).toHaveBeenCalledTimes(19));
    release();
    const results = await completed;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(18);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('evicts idle source snapshots and removes private files on shutdown', async () => {
    const snapshotPaths: string[] = [];
    for (let index = 0; index < 5; index++) {
      const source = join(directory, `book-${index}.djvu`);
      await writeFile(source, djvuPageFixture());
      access.mockResolvedValue({ absolutePath: source, libraryFolderPath: directory, format: 'djvu' });
      expect(await service.getPageCount(index + 1, user)).toBe(1);
      snapshotPaths.push(run.mock.calls.at(-1)![1][0]);
    }
    await expect(stat(snapshotPaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    await module.close();
    for (const path of snapshotPaths) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('answers revalidation, cached pages and page counts without a decoder slot, even after the source is evicted', async () => {
    const page = await service.getPage(1, 0, 1280, user);
    for (let index = 0; index < 4; index++) {
      const other = join(directory, `other-${index}.djvu`);
      await writeFile(other, djvuPageFixture());
      access.mockResolvedValueOnce({ absolutePath: other, libraryFolderPath: directory, format: 'djvu' });
      await service.getPageCount(index + 2, user);
    }
    run.mockReset();
    run.mockRejectedValue(new Error('decoder must not run'));
    expect(await service.getPage(1, 0, 1280, user, page.etag)).toEqual({ notModified: true, etag: page.etag });
    expect(await service.getPageCount(1, user)).toBe(1);
    await expect(service.getPage(1, 1, 1280, user, page.etag)).rejects.toMatchObject({ status: 404 });
    await expect(service.getPageText(1, 3, user)).rejects.toMatchObject({ status: 404 });
    expect(run).not.toHaveBeenCalled();
  });

  it('admits background extraction beyond the reader queue', async () => {
    const documents = module.get(DjvuDocumentService);
    const queues = documents as unknown as { waiters: unknown[]; backgroundWaiters: unknown[] };
    const render = run.getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementation(async (...args: unknown[]) => {
      await blocked;
      return render(...args);
    });
    const readers = Array.from({ length: 18 }, () => service.getPageCount(1, user));
    await vi.waitFor(() => expect(queues.waiters).toHaveLength(16));
    const background = Array.from({ length: 4 }, () => documents.extractMetadata(path));
    await vi.waitFor(() => expect(queues.backgroundWaiters).toHaveLength(4));
    await expect(service.getPageCount(1, user)).rejects.toMatchObject({ status: 503 });
    release();
    const results = await Promise.allSettled([...readers, ...background]);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(0);
  });

  it('expires queued requests without starting more decoders', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementation(async () => {
      await blocked;
      return '1';
    });
    // Requests join the queue once their file is open, so which call waits is decided by I/O, not by
    // call order. Whichever it is, it must be the one that times out while the other two hold the slots.
    const outcomes = [service.getPageCount(1, user), service.getPageCount(1, user), service.getPageCount(1, user)].map((request) =>
      request.then(
        () => 'served',
        (error: { status?: number }) => error.status,
      ),
    );
    await expect(Promise.race(outcomes)).resolves.toBe(503);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    const settled = await Promise.all(outcomes);
    expect(settled.filter((outcome) => outcome === 503)).toHaveLength(1);
    expect(settled.filter((outcome) => outcome === 'served')).toHaveLength(2);
  });
});
