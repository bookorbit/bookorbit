import { ConfigService } from '@nestjs/config';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import type { BookRenameData } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';

describe('FileRenameService narrator-specific editions', () => {
  let libraryRoot: string;

  beforeEach(async () => {
    libraryRoot = await mkdtemp(join(tmpdir(), 'bookorbit-narrator-rename-'));
  });

  afterEach(async () => {
    await rm(libraryRoot, { recursive: true, force: true });
  });

  it('moves matching editions to distinct narrator-specific paths', async () => {
    const simon = makeRenameData(libraryRoot, 1, 'Simon Vance');
    const george = makeRenameData(libraryRoot, 2, 'George Guidall');
    const dataByBookId = new Map([
      [1, simon],
      [2, george],
    ]);

    for (const data of dataByBookId.values()) {
      await mkdir(dirname(data.file.absolutePath), { recursive: true });
      await writeFile(data.file.absolutePath, data.narrators[0]!);
    }

    const renameRepo = {
      findBookRenameData: vi.fn((bookId: number) => Promise.resolve(dataByBookId.get(bookId) ?? null)),
      findAllBookFiles: vi.fn((bookId: number) => {
        const data = dataByBookId.get(bookId);
        return Promise.resolve(
          data
            ? [
                {
                  id: data.file.id,
                  absolutePath: data.file.absolutePath,
                  relPath: data.file.relPath,
                  role: data.file.role,
                  format: data.file.format,
                  sortOrder: null,
                },
              ]
            : [],
        );
      }),
      checkPathTakenByOtherBook: vi.fn().mockResolvedValue(false),
      applyFolderRename: vi.fn().mockResolvedValue(undefined),
      findBookByExactFolderPath: vi.fn().mockResolvedValue(null),
      applyExistingFolderMerge: vi.fn().mockResolvedValue(undefined),
    };
    const lockService = {
      withLock: vi.fn().mockImplementation(async (_key: string, operation: () => Promise<unknown>) => operation()),
    };
    const appSettings = {
      getUploadPattern: vi.fn(),
      getUploadPatternBookPerFolder: vi.fn(),
      isCrossPlatformPathSanitizationEnabled: vi.fn().mockResolvedValue(false),
    };
    const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
    const config = { get: vi.fn() } as unknown as ConfigService;
    const service = new FileRenameService(
      renameRepo as never,
      lockService as never,
      appSettings as never,
      notificationService as never,
      config,
      new SelfWriteRegistry(),
    );

    const simonResult = await service.performRename(1, 7);
    const georgeResult = await service.performRename(2, 7);
    const simonTarget = join(libraryRoot, 'Frank Herbert', 'Dune', 'Dune - [Simon Vance]', 'Dune - [Simon Vance].m4b');
    const georgeTarget = join(libraryRoot, 'Frank Herbert', 'Dune', 'Dune - [George Guidall]', 'Dune - [George Guidall].m4b');

    expect(simonResult).toEqual(expect.objectContaining({ status: 'success', newPath: simonTarget }));
    expect(georgeResult).toEqual(expect.objectContaining({ status: 'success', newPath: georgeTarget }));
    expect(simonTarget).not.toBe(georgeTarget);
    await expect(readFile(simonTarget, 'utf8')).resolves.toBe('Simon Vance');
    await expect(readFile(georgeTarget, 'utf8')).resolves.toBe('George Guidall');
    await expect(access(simon.file.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(george.file.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function makeRenameData(libraryRoot: string, bookId: number, narrator: string): BookRenameData {
  const filename = `dune-${bookId}.m4b`;
  const absolutePath = join(libraryRoot, 'incoming', String(bookId), filename);

  return {
    file: {
      id: bookId * 10,
      absolutePath,
      relPath: join('incoming', String(bookId), filename),
      format: 'm4b',
      role: 'content',
    },
    libraryId: 1,
    libraryName: 'Audiobooks',
    libraryFolderId: 1,
    libraryFolderPath: libraryRoot,
    organizationMode: 'book_per_file',
    fileRenameEnabled: true,
    fileNamingPattern: '{authors}/{title}/{title} - [{narrators}]/{title} - [{narrators}]',
    bookFolderPath: absolutePath,
    metadata: {
      title: 'Dune',
      subtitle: null,
      publisher: null,
      language: null,
      isbn13: null,
      publishedYear: 1965,
      seriesName: 'Dune',
      seriesIndex: '1',
    },
    authors: ['Frank Herbert'],
    narrators: [narrator],
  };
}
