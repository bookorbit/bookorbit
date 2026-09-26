import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { CoverImporter } from './cover.importer';

function makeImporter() {
  const repo = {
    setRunMetric: vi.fn().mockResolvedValue(undefined),
  };
  const coverStore = {
    chooseWriteMedium: vi.fn().mockResolvedValue('ebook'),
    saveCustom: vi.fn().mockResolvedValue(true),
  };
  const importer = new CoverImporter(repo as never, coverStore as never);
  return { importer, repo, coverStore };
}

describe('CoverImporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts rejected per-book tasks as failed while continuing batch processing', async () => {
    const { importer, repo } = makeImporter();
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
    const tempRoot = await mkdtemp(join(tmpdir(), 'cover-importer-failure-'));
    try {
      const sourceDir = join(tempRoot, 'images', 'source-1');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, 'cover.jpg'), Buffer.from('cover-bytes'));
      vi.spyOn(importer as any, 'importSingleCover').mockRejectedValue(new Error('invalid image payload'));

      await expect((importer as any).processSingleMatch(99, { sourceBookId: 'source-1', targetBookId: 901 }, tempRoot)).resolves.toBe('failed');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
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

  it('routes imported bytes through the slot store as a legacy custom cover', async () => {
    const { importer, coverStore } = makeImporter();
    const bytes = Buffer.from('cover-bytes');

    await (importer as any).importSingleCover(901, bytes);

    expect(coverStore.chooseWriteMedium).toHaveBeenCalledWith(901, bytes);
    expect(coverStore.saveCustom).toHaveBeenCalledWith(901, 'ebook', bytes, { origin: 'legacy' });
  });

  it('rejects source identifiers that escape the images directory', async () => {
    const { importer, coverStore } = makeImporter();

    await expect((importer as any).processSingleMatch(99, { sourceBookId: '../escape', targetBookId: 901 }, '/source-media')).resolves.toBe(
      'unresolved',
    );
    expect(coverStore.saveCustom).not.toHaveBeenCalled();
  });

  it('rejects a source cover symlink that escapes its source directory', async () => {
    const { importer, coverStore } = makeImporter();
    const tempRoot = await mkdtemp(join(tmpdir(), 'cover-importer-symlink-'));
    try {
      const sourceDir = join(tempRoot, 'images', 'source-1');
      const outsideCover = join(tempRoot, 'outside.jpg');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(outsideCover, Buffer.from('outside-cover'));
      await symlink(outsideCover, join(sourceDir, 'cover.jpg'));

      await expect((importer as any).processSingleMatch(99, { sourceBookId: 'source-1', targetBookId: 901 }, tempRoot)).resolves.toBe('unresolved');
      expect(coverStore.saveCustom).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
