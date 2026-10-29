import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestUser } from '../../common/types/request-user';
import {
  fitGeneratedFilename,
  GENERATED_FILENAME_MAX_BYTES,
  GeneratedBookFileService,
  GeneratedFileError,
  truncateUtf8,
} from './generated-book-file.service';

const statfsMock = vi.hoisted(() => ({ available: Number.MAX_SAFE_INTEGER }));
const copyMock = vi.hoisted(() => ({ failAfterWriting: false }));

vi.mock('node:stream/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:stream/promises')>();
  return {
    ...actual,
    pipeline: vi.fn(async (...streams: Parameters<typeof actual.pipeline>) => {
      if (!copyMock.failAfterWriting) return actual.pipeline(...streams);
      const writable = streams.at(-1) as NodeJS.WritableStream;
      await new Promise<void>((resolve) => writable.write('half a copy', () => resolve()));
      writable.end();
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    }),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    statfs: vi.fn(() => Promise.resolve({ bavail: BigInt(statfsMock.available), bsize: 1n })),
  };
});

const USER = { id: 7, isSuperuser: false } as RequestUser;

describe('GeneratedBookFileService', () => {
  let root: string;
  let source: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'generated-file-'));
    source = join(root, 'output.epub');
    await writeFile(source, 'generated read-along bytes');
    statfsMock.available = Number.MAX_SAFE_INTEGER;
    copyMock.failAfterWriting = false;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** `existing` is the file a lookup finds: by hash when adding, by id when replacing. */
  function makeService(
    existing: { id: number; absolutePath?: string; fileHash?: string | null; format?: string } | null,
    options: { allowed?: boolean } = {},
  ) {
    const folder = join(root, 'library', 'novel');
    const book = {
      folderPath: folder,
      libraryId: 3,
      libraryFolderId: 4,
      allowedFormats: ['epub'],
      organizationMode: 'book_per_folder',
      libraryFolderPath: join(root, 'library'),
    };
    const repository = {
      findBookPlacement: vi.fn().mockResolvedValue(book),
      findFile: vi.fn().mockResolvedValue(existing),
      findFileIdByHash: vi.fn().mockResolvedValue(existing?.id ?? null),
      findFileByPath: vi.fn<(path: string) => Promise<{ id: number; bookId: number } | null>>().mockResolvedValue(null),
    };
    const validator = {
      sanitizeFilename: vi.fn((name: string) => name),
      validateFormat: vi.fn(() => {
        if (options.allowed === false) throw new Error('not allowed');
        return 'epub';
      }),
      validateContent: vi.fn().mockResolvedValue(undefined),
    };
    const uploads = { registerBookFile: vi.fn(() => Promise.resolve({ id: 900 })) };
    const fileWriteRepo = {
      recordHashHistory: vi.fn().mockResolvedValue(undefined),
      updateFileStateAfterMetadataWrite: vi.fn().mockResolvedValue(undefined),
    };
    const fileLocks = { withLock: vi.fn((_path: string, fn: () => Promise<unknown>) => fn()) };
    const service = new GeneratedBookFileService(
      repository as never,
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      validator as never,
      { assertWithinRoot: vi.fn().mockResolvedValue(undefined) } as never,
      uploads as never,
      { reconcileCoversAsync: vi.fn() } as never,
      fileLocks as never,
      fileWriteRepo as never,
    );
    return { service, folder, uploads, fileWriteRepo, fileLocks, repository };
  }

  it('copies the file into the book folder and registers it without any upload size limit', async () => {
    const { service, folder, uploads } = makeService(null);
    await import('node:fs/promises').then((fs) => fs.mkdir(folder, { recursive: true }));
    const result = await service.addFile({
      bookId: 12,
      sourcePath: source,
      partialKey: 'abc',
      maxBytes: 1e12,
      user: USER,
      filename: 'novel.readaloud.epub',
    });

    expect(result).toEqual({ fileId: 900, reused: false });
    expect(await readFile(join(folder, 'novel.readaloud.epub'), 'utf8')).toBe('generated read-along bytes');
    expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
    expect(uploads.registerBookFile).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 12, destination: join(folder, 'novel.readaloud.epub'), format: 'epub', fileHash: expect.any(String) }),
    );
  });

  it('never overwrites: a taken name gets a numbered sibling', async () => {
    const { service, folder } = makeService(null);
    const fs = await import('node:fs/promises');
    await fs.mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'novel.readaloud.epub'), 'older');
    await service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'novel.readaloud.epub' });

    expect(await readFile(join(folder, 'novel.readaloud.epub'), 'utf8')).toBe('older');
    expect(await readFile(join(folder, 'novel.readaloud-2.epub'), 'utf8')).toBe('generated read-along bytes');
  });

  it('reuses a file already attached with the same content', async () => {
    const { service, folder, uploads } = makeService({ id: 321 });
    await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
    const result = await service.addFile({
      bookId: 12,
      sourcePath: source,
      partialKey: 'abc',
      maxBytes: 1e12,
      user: USER,
      filename: 'novel.readaloud.epub',
    });

    expect(result).toEqual({ fileId: 321, reused: true });
    expect(uploads.registerBookFile).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  describe('when registering the placed file fails', () => {
    const add = (service: GeneratedBookFileService) =>
      service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'novel.readaloud.epub' });

    it('removes the file nothing tracks, so no scan imports it and no retry doubles it', async () => {
      const { service, folder, uploads, repository } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      uploads.registerBookFile.mockRejectedValue(new Error('connection terminated'));

      await expect(add(service)).rejects.toThrow('connection terminated');
      expect(repository.findFileByPath).toHaveBeenCalledWith(join(folder, 'novel.readaloud.epub'));
      expect(await readdir(folder)).toEqual([]);

      // The next attempt takes the plain name again instead of a numbered sibling.
      uploads.registerBookFile.mockResolvedValue({ id: 900 });
      await expect(add(service)).resolves.toEqual({ fileId: 900, reused: false });
      expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
    });

    it('adopts the file the library watcher registered for this book first', async () => {
      const { service, folder, uploads, repository } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      uploads.registerBookFile.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));
      repository.findFileByPath.mockResolvedValue({ id: 901, bookId: 12 });

      await expect(add(service)).resolves.toEqual({ fileId: 901, reused: true });
      expect(await readFile(join(folder, 'novel.readaloud.epub'), 'utf8')).toBe('generated read-along bytes');
    });

    it('keeps a file another book now owns, and still reports the failure', async () => {
      const { service, folder, uploads, repository } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      uploads.registerBookFile.mockRejectedValue(new Error('duplicate key value'));
      repository.findFileByPath.mockResolvedValue({ id: 5, bookId: 99 });

      await expect(add(service)).rejects.toThrow('duplicate key value');
      expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
    });

    it('keeps the file when it cannot tell whether anything tracks it', async () => {
      const { service, folder, uploads, repository } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      uploads.registerBookFile.mockRejectedValue(new Error('connection terminated'));
      repository.findFileByPath.mockRejectedValue(new Error('connection terminated again'));

      await expect(add(service)).rejects.toThrow('connection terminated');
      expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
    });

    it('never looks the path up when the failure came before the file had a name', async () => {
      const { service, folder, repository } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      repository.findFileIdByHash.mockRejectedValue(new Error('connection terminated'));

      await expect(add(service)).rejects.toThrow('connection terminated');
      expect(repository.findFileByPath).not.toHaveBeenCalled();
      expect(await readdir(folder)).toEqual([]);
    });
  });

  it('refuses formats the library does not allow, oversized output, and a full disk', async () => {
    await expect(
      makeService(null, { allowed: false }).service.addFile({
        bookId: 12,
        sourcePath: source,
        partialKey: 'a',
        maxBytes: 1e12,
        user: USER,
        filename: 'x.epub',
      }),
    ).rejects.toMatchObject({ reason: 'not_allowed' });
    await expect(
      makeService(null).service.addFile({ bookId: 12, sourcePath: source, partialKey: 'a', maxBytes: 3, user: USER, filename: 'x.epub' }),
    ).rejects.toMatchObject({ reason: 'too_large' });
    statfsMock.available = 10;
    const full = await makeService(null)
      .service.addFile({ bookId: 12, sourcePath: source, partialKey: 'a', maxBytes: 1e12, user: USER, filename: 'x.epub' })
      .catch((error: unknown) => error);
    expect(full).toBeInstanceOf(GeneratedFileError);
    expect(full).toMatchObject({ reason: 'insufficient_storage' });
  });

  it('replaces content in place, keeps the row, and records the previous hash', async () => {
    const folder = join(root, 'library', 'novel');
    const target = join(folder, 'novel.readaloud.epub');
    const { service, fileWriteRepo, fileLocks } = makeService({ id: 300, absolutePath: target, fileHash: 'old-hash', format: 'epub' });
    const fs = await import('node:fs/promises');
    await fs.mkdir(folder, { recursive: true });
    await writeFile(target, 'old read-along');
    const result = await service.replaceFile({ bookId: 12, fileId: 300, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER });

    expect(result).toEqual({ fileId: 300 });
    expect(await readFile(target, 'utf8')).toBe('generated read-along bytes');
    expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
    expect(fileLocks.withLock).toHaveBeenCalledWith(target, expect.any(Function));
    expect(fileWriteRepo.recordHashHistory).toHaveBeenCalledWith(300, 'old-hash', 'read_aloud_replace');
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledWith(
      12,
      300,
      'old-hash',
      expect.objectContaining({ fileHash: expect.any(String), mediaOverlayAvailable: false }),
    );
  });

  it('puts the previous content back when the row cannot be updated', async () => {
    const folder = join(root, 'library', 'novel');
    const target = join(folder, 'novel.readaloud.epub');
    const { service, fileWriteRepo } = makeService({ id: 300, absolutePath: target, fileHash: 'old-hash', format: 'epub' });
    await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
    await writeFile(target, 'old read-along');
    fileWriteRepo.updateFileStateAfterMetadataWrite.mockRejectedValue(new Error('connection terminated'));

    await expect(service.replaceFile({ bookId: 12, fileId: 300, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER })).rejects.toThrow(
      'connection terminated',
    );
    expect(await readFile(target, 'utf8')).toBe('old read-along');
    expect(await readdir(folder)).toEqual(['novel.readaloud.epub']);
  });

  it('refuses a source that is a link to another file', async () => {
    const elsewhere = join(root, 'elsewhere.epub');
    await writeFile(elsewhere, 'another library');
    const linked = join(root, 'linked.epub');
    await symlink(elsewhere, linked);
    const { service, folder } = makeService(null);
    await (await import('node:fs/promises')).mkdir(folder, { recursive: true });

    await expect(
      service.addFile({ bookId: 12, sourcePath: linked, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'novel.readaloud.epub' }),
    ).rejects.toMatchObject({ reason: 'invalid_content' });
    expect(await readdir(folder)).toEqual([]);
  });

  it('holds the book operation lock for adds and replaces', async () => {
    const folder = join(root, 'library', 'novel');
    const target = join(folder, 'novel.readaloud.epub');
    const { service, fileLocks } = makeService({ id: 300, absolutePath: target, fileHash: 'old-hash', format: 'epub' });
    await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
    await writeFile(target, 'old read-along');

    await service.replaceFile({ bookId: 12, fileId: 300, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER });
    expect(fileLocks.withLock).toHaveBeenNthCalledWith(1, 'book:12', expect.any(Function));

    fileLocks.withLock.mockClear();
    const adder = makeService(null);
    await adder.service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'other.epub' });
    expect(adder.fileLocks.withLock).toHaveBeenCalledWith('book:12', expect.any(Function));
  });

  describe('partial copies', () => {
    it('removes the partial when the copy itself fails', async () => {
      const { service, folder } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      copyMock.failAfterWriting = true;

      await expect(
        service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'novel.readaloud.epub' }),
      ).rejects.toThrow('no space left on device');
      expect(await readdir(folder)).toEqual([]);
    });

    it("clears this book's leftovers before the free-space check, and leaves other books' alone", async () => {
      const { service, folder } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      await writeFile(join(folder, '.bookorbit-generated-12-0ld3r.partial'), 'left by a restart');
      await writeFile(join(folder, '.bookorbit-generated-99-abc.partial'), 'another book, mid-copy');
      statfsMock.available = 10;

      await expect(
        service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename: 'novel.readaloud.epub' }),
      ).rejects.toMatchObject({ reason: 'insufficient_storage' });
      expect(await readdir(folder)).toEqual(['.bookorbit-generated-99-abc.partial']);
    });
  });

  describe('long names', () => {
    it('keeps the extension and fits the byte limit, without splitting a character', () => {
      const name = `${'Ж'.repeat(200)}.readaloud.epub`;
      const fitted = fitGeneratedFilename(name);
      expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(GENERATED_FILENAME_MAX_BYTES);
      expect(fitted.endsWith('.epub')).toBe(true);
      expect(fitted).not.toContain('\uFFFD');
      expect(truncateUtf8('aЖb', 2)).toBe('a');
      expect(fitGeneratedFilename('short.epub')).toBe('short.epub');
    });

    it('stages a long name under a short partial name, so the copy never hits the filesystem limit', async () => {
      const { service, folder } = makeService(null);
      await (await import('node:fs/promises')).mkdir(folder, { recursive: true });
      const filename = `${'書'.repeat(78)}.readaloud.epub`;

      await service.addFile({ bookId: 12, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER, filename });
      const [placed] = await readdir(folder);
      expect(Buffer.byteLength(placed!)).toBeLessThanOrEqual(255);
      expect(placed).toBe(filename);
    });
  });

  it('reports a replace target that disappeared', async () => {
    const { service } = makeService(null);
    await expect(
      service.replaceFile({ bookId: 12, fileId: 300, sourcePath: source, partialKey: 'abc', maxBytes: 1e12, user: USER }),
    ).rejects.toMatchObject({
      reason: 'missing_target',
    });
  });
});
