import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { CoverImporter } from './cover.importer';

function makeImporter() {
  const repo = {
    setRunMetric: vi.fn().mockResolvedValue(undefined),
  };
  const importRepo = {
    fetchLibraryIdsByBookIds: vi.fn().mockResolvedValue(new Map<number, number>()),
    markCoverAsCustom: vi.fn().mockResolvedValue(undefined),
  };
  const scanGateway = {
    emitCoverRefreshed: vi.fn(),
  };
  const importer = new CoverImporter(repo as never, importRepo as never, scanGateway as never);
  return { importer, repo, importRepo, scanGateway };
}

describe('CoverImporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts rejected per-book tasks as failed while continuing batch processing', async () => {
    const { importer, repo, importRepo, scanGateway } = makeImporter();
    importRepo.fetchLibraryIdsByBookIds.mockResolvedValue(new Map([[901, 12]]));
    const processSingleMatch = vi
      .spyOn(importer as any, 'processSingleMatch')
      .mockResolvedValueOnce('imported')
      .mockRejectedValueOnce(new Error('permission denied'));

    await importer.import(
      41,
      {
        execution: {
          matchedBooks: [
            { sourceBookId: 'source-1', targetBookId: 901 },
            { sourceBookId: 'source-2', targetBookId: 902 },
          ],
        },
      } as never,
      '/app',
      '/source-media',
      vi.fn().mockResolvedValue(undefined),
    );

    expect(processSingleMatch).toHaveBeenCalledTimes(2);
    expect(scanGateway.emitCoverRefreshed).toHaveBeenCalledWith({ bookId: 901, libraryId: 12 });
    expect(repo.setRunMetric).toHaveBeenCalledWith(
      41,
      'book_covers',
      'book_covers',
      expect.objectContaining({
        processed: 2,
        imported: 1,
        failed: 1,
      }),
    );
  });

  it('returns failed when importing a single cover throws after reading source cover bytes', async () => {
    const { importer } = makeImporter();
    vi.spyOn(importer as any, 'readOptionalFile').mockResolvedValue(Buffer.from('cover-bytes'));
    vi.spyOn(importer as any, 'importSingleCover').mockRejectedValue(new Error('invalid image payload'));

    await expect((importer as any).processSingleMatch(99, { sourceBookId: 'source-1', targetBookId: 901 }, '/app', '/source-media')).resolves.toBe(
      'failed',
    );
  });

  it('readOptionalFile returns null for ENOENT and rethrows non-ENOENT read errors', async () => {
    const { importer } = makeImporter();
    const tempRoot = await mkdtemp(join(tmpdir(), 'cover-importer-read-'));
    try {
      await expect((importer as any).readOptionalFile(join(tempRoot, 'missing.jpg'))).resolves.toBeNull();
      await expect((importer as any).readOptionalFile(tempRoot)).rejects.toBeInstanceOf(Error);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('deleteFilesByPrefix removes only matching files and keeps unrelated entries', async () => {
    const { importer } = makeImporter();
    const tempRoot = await mkdtemp(join(tmpdir(), 'cover-importer-delete-'));
    try {
      await writeFile(join(tempRoot, 'cover_custom.jpg'), 'cover');
      await writeFile(join(tempRoot, 'cover_custom.png'), 'cover');
      await writeFile(join(tempRoot, 'thumbnail.jpg'), 'thumb');

      await (importer as any).deleteFilesByPrefix(tempRoot, 'cover_custom.');
      const remaining = await readdir(tempRoot);

      expect(remaining).toEqual(['thumbnail.jpg']);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('readDirIfExists/removeFileIfPresent handle ENOENT and still surface other fs errors', async () => {
    const { importer } = makeImporter();
    const tempRoot = await mkdtemp(join(tmpdir(), 'cover-importer-fs-'));
    const existingFile = join(tempRoot, 'existing.txt');
    await writeFile(existingFile, 'x');

    try {
      await expect((importer as any).readDirIfExists(join(tempRoot, 'missing-dir'))).resolves.toEqual([]);
      await expect((importer as any).removeFileIfPresent(join(tempRoot, 'missing.txt'))).resolves.toBeUndefined();

      await expect((importer as any).readDirIfExists(existingFile)).rejects.toBeInstanceOf(Error);
      await expect((importer as any).removeFileIfPresent(tempRoot)).rejects.toBeInstanceOf(Error);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
