vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, access: vi.fn(), readdir: vi.fn(), stat: vi.fn(), statfs: vi.fn() };
});

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { access, readdir, stat, statfs } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';

import { BOOK_MERGE_MAX_BOOKS, Permission } from '@bookorbit/types';

import type { FileLockService } from '../../common/services/file-lock.service';
import type { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import type { BookConsolidationService } from '../book-consolidation/book-consolidation.service';
import type { BookFacts } from '../book-consolidation/field-picks';
import type { BookService } from '../book/book.service';
import { BookMergePlanner, type PlanRequest } from './book-merge.planner';
import type { BookMergeRepository, MergeBookRow, MergeFileRow, MergeLibraryRow } from './book-merge.repository';

const LIBRARY = '/library';
const TARGET_FOLDER = join(LIBRARY, 'Frank Herbert', 'Dune');
const SOURCE_FOLDER = join(LIBRARY, 'Frank Herbert', 'Dune Copy');
const MTIME_MS = 1_767_225_600_000;

interface DiskEntry {
  directory: boolean;
  size: number;
  mtimeMs: number;
  dev: number;
  nlink?: number;
}

const disk = new Map<string, DiskEntry>();
const readOnly = new Set<string>();

function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function addDir(path: string): void {
  for (let current = path; !disk.has(current); current = dirname(current)) {
    disk.set(current, { directory: true, size: 0, mtimeMs: 0, dev: 1 });
    if (current === dirname(current)) break;
  }
}

function addFile(path: string, size = 100): void {
  addDir(dirname(path));
  disk.set(path, { directory: false, size, mtimeMs: MTIME_MS, dev: 1 });
}

function installDisk(): void {
  vi.mocked(stat).mockImplementation(((path: string) => {
    const entry = disk.get(path);
    if (!entry) return Promise.reject(fsError('ENOENT', path));
    return Promise.resolve({
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      dev: entry.dev,
      nlink: entry.nlink ?? 1,
      isDirectory: () => entry.directory,
    });
  }) as never);
  vi.mocked(readdir).mockImplementation(((directory: string) => {
    if (!disk.get(directory)?.directory) return Promise.reject(fsError('ENOENT', directory));
    const children = [...disk.entries()].filter(([path]) => path !== directory && dirname(path) === directory);
    return Promise.resolve(children.map(([path, entry]) => ({ name: basename(path), isDirectory: () => entry.directory })));
  }) as never);
  vi.mocked(access).mockImplementation(((path: string) => {
    if (!disk.has(path)) return Promise.reject(fsError('ENOENT', path));
    if (readOnly.has(path)) return Promise.reject(fsError('EACCES', path));
    return Promise.resolve();
  }) as never);
}

function bookRow(id: number, folderPath: string, overrides: Partial<MergeBookRow> = {}): MergeBookRow {
  return {
    id,
    libraryId: 1,
    libraryFolderId: 11,
    libraryFolderPath: LIBRARY,
    folderPath,
    status: 'present',
    addedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    primaryFileId: null,
    title: `Book ${id}`,
    metadataUpdatedAt: null,
    organizationMode: 'book_per_folder',
    formatPriority: null,
    allowedFormats: [],
    ...overrides,
  };
}

function fileRow(id: number, bookId: number, absolutePath: string, overrides: Partial<MergeFileRow> = {}): MergeFileRow {
  return {
    id,
    bookId,
    absolutePath,
    relPath: null,
    role: 'content',
    format: extname(absolutePath).slice(1).toLowerCase(),
    sizeBytes: 100,
    mtime: new Date(MTIME_MS),
    ino: BigInt(id),
    fileHash: null,
    sortOrder: null,
    mediaOverlayAvailable: false,
    ...overrides,
  };
}

function libraryRow(id: number, overrides: Partial<MergeLibraryRow> = {}): MergeLibraryRow {
  return {
    id,
    name: `Library ${id}`,
    organizationMode: 'book_per_folder',
    formatPriority: null,
    allowedFormats: [],
    excludePatterns: [],
    fileWriteEnabled: false,
    fileNamingPattern: null,
    watch: false,
    ...overrides,
  };
}

function factsOf(bookId: number, overrides: Partial<BookFacts> = {}): BookFacts {
  return {
    bookId,
    metadata: { title: `Book ${bookId}` },
    lockedFields: new Set(),
    authors: ['Frank Herbert'],
    narrators: [],
    series: [],
    hasAudio: false,
    ...overrides,
  };
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 0,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] },
    ...overrides,
  };
}

interface Scenario {
  books: MergeBookRow[];
  files: MergeFileRow[];
  facts?: BookFacts[];
  libraries?: MergeLibraryRow[];
}

/** Kept book 1 in its own folder with Dune.epub; source 2 in another folder with Dune.mobi. */
function twoBooks(): Scenario {
  const files = [fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')), fileRow(20, 2, join(SOURCE_FOLDER, 'Dune.mobi'))];
  for (const file of files) addFile(file.absolutePath, file.sizeBytes ?? 0);
  return { books: [bookRow(1, TARGET_FOLDER), bookRow(2, SOURCE_FOLDER)], files };
}

function createPlanner(scenario: Scenario) {
  const factsById = new Map((scenario.facts ?? []).map((facts) => [facts.bookId, facts]));
  const repository = {
    loadBooks: vi.fn((ids: number[]) => Promise.resolve(scenario.books.filter((book) => ids.includes(book.id)))),
    loadFiles: vi.fn((ids: number[]) => Promise.resolve(scenario.files.filter((file) => ids.includes(file.bookId)))),
    transaction: vi.fn((work: (tx: unknown) => Promise<unknown>) => work({})),
    findBusyBooks: vi.fn().mockResolvedValue(new Map<number, string>()),
    countActivity: vi.fn().mockResolvedValue(new Map()),
    findCoverMediums: vi.fn().mockResolvedValue([]),
    findPathOwners: vi.fn().mockResolvedValue(new Map<string, number>()),
    countUserData: vi.fn().mockResolvedValue([]),
    loadTagsAndGenres: vi.fn().mockResolvedValue({ tags: [], genres: [] }),
    findRestrictedReaders: vi.fn().mockResolvedValue([]),
    findReadersWithData: vi.fn().mockResolvedValue(new Set<number>()),
    findRequestsOnBooks: vi.fn().mockResolvedValue([]),
    countKoboEntitlements: vi.fn().mockResolvedValue(0),
    countRemoteBookConflicts: vi.fn().mockResolvedValue(0),
    isFolderInUse: vi.fn().mockResolvedValue(false),
    loadLibraries: vi.fn((ids: number[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            scenario.libraries?.find((library) => library.id === id) ??
              libraryRow(id, { organizationMode: scenario.books.find((book) => book.libraryId === id)?.organizationMode ?? 'book_per_folder' }),
          ]),
        ),
      ),
    ),
    findReadersLosingAccess: vi.fn().mockResolvedValue(new Set<number>()),
    findUsersWithoutLibraryAccess: vi.fn().mockResolvedValue(new Set<number>()),
    countKoboUsersLosingAccess: vi.fn().mockResolvedValue(0),
    countHiddenCustomFields: vi.fn().mockResolvedValue(0),
    countCompanionRequestsLeftBehind: vi.fn().mockResolvedValue([]),
    findSessionReaders: vi.fn().mockResolvedValue([]),
  };
  const bookService = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const consolidation = { loadFacts: vi.fn((_tx: unknown, id: number) => Promise.resolve(factsById.get(id) ?? factsOf(id))) };
  const libraryGate = { isHeld: vi.fn().mockReturnValue(false) };
  const fileLocks = { isLocked: vi.fn().mockReturnValue(false) };
  const planner = new BookMergePlanner(
    repository as unknown as BookMergeRepository,
    bookService as unknown as BookService,
    consolidation as unknown as BookConsolidationService,
    libraryGate as unknown as LibraryOperationGate,
    fileLocks as unknown as FileLockService,
  );
  return { planner, repository, bookService, libraryGate, fileLocks };
}

const MERGE_2_INTO_1: PlanRequest = { targetBookId: 1, sourceBookIds: [2] };

beforeEach(() => {
  disk.clear();
  readOnly.clear();
  vi.mocked(stat).mockReset();
  vi.mocked(readdir).mockReset();
  vi.mocked(access).mockReset();
  vi.mocked(statfs).mockReset();
  vi.mocked(statfs).mockResolvedValue({ bavail: 10n ** 9n, bsize: 4096n, blocks: 10n ** 9n } as never);
  installDisk();
});

describe('BookMergePlanner.plan', () => {
  it('plans an eligible merge that moves the source file into the kept book folder', async () => {
    const { planner } = createPlanner(twoBooks());

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.eligible).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.destinationBookId).toBe(1);
    expect(preview.previewToken).toMatch(/^[0-9a-f]{32}$/);
    expect(plan?.steps).toEqual([
      expect.objectContaining({
        sourceBookId: 2,
        moves: [
          {
            fileId: 20,
            bookId: 2,
            from: join(SOURCE_FOLDER, 'Dune.mobi'),
            to: join(TARGET_FOLDER, 'Dune.mobi'),
            relPath: join('Frank Herbert', 'Dune', 'Dune.mobi'),
            kind: 'move',
            expectedSize: 100,
            expectedMtimeMs: MTIME_MS,
            crossDevice: false,
          },
        ],
        vacatedFolders: [SOURCE_FOLDER],
      }),
    ]);
  });

  describe('blockers', () => {
    it('reports SAME_BOOK when the kept book is also a source', async () => {
      const scenario = twoBooks();
      const { planner, bookService } = createPlanner(scenario);

      const { preview, plan } = await planner.plan({ targetBookId: 1, sourceBookIds: [1] }, makeUser());

      expect(preview.blockers).toEqual([{ code: 'SAME_BOOK' }]);
      expect(preview.eligible).toBe(false);
      expect(preview.previewToken).toBeNull();
      expect(plan).toBeNull();
      expect(bookService.verifyBookAccess).toHaveBeenCalledTimes(1);
    });

    it('rejects more than the maximum number of books with TOO_MANY_BOOKS before checking access', async () => {
      const { planner, bookService } = createPlanner(twoBooks());
      const sourceBookIds = Array.from({ length: BOOK_MERGE_MAX_BOOKS }, (_, index) => index + 2);

      const error = await planner.plan({ targetBookId: 1, sourceBookIds }, makeUser()).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ errorCode: 'TOO_MANY_BOOKS' });
      expect(bookService.verifyBookAccess).not.toHaveBeenCalled();
    });

    it('passes on a BOOK_MERGED not-found answer for a merged-away id without loading any book', async () => {
      const { planner, bookService, repository } = createPlanner(twoBooks());
      const merged = new NotFoundException({
        message: 'Book was merged into another book',
        errorCode: 'BOOK_MERGED',
        errorMeta: { targetBookId: 1 },
      });
      bookService.verifyBookAccess.mockImplementation((id: number) => (id === 2 ? Promise.reject(merged) : Promise.resolve()));

      await expect(planner.plan(MERGE_2_INTO_1, makeUser())).rejects.toBe(merged);
      expect(repository.loadBooks).not.toHaveBeenCalled();
    });

    it('passes on a NOT_FOUND answer for a book the user cannot see', async () => {
      const { planner, bookService } = createPlanner(twoBooks());
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 2 not found'));

      await expect(planner.plan(MERGE_2_INTO_1, makeUser())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('checks editor access for every distinct book', async () => {
      const { planner, bookService } = createPlanner(twoBooks());
      const user = makeUser();

      await planner.plan(MERGE_2_INTO_1, user);

      expect(bookService.verifyBookAccess.mock.calls).toEqual([
        [1, user, 'editor'],
        [2, user, 'editor'],
      ]);
    });

    it('reports FILE_PER_BOOK_LIBRARY for a library that keeps one book per file', async () => {
      const scenario = twoBooks();
      scenario.books = scenario.books.map((book) => ({ ...book, organizationMode: 'book_per_file' }));
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'FILE_PER_BOOK_LIBRARY' }]);
    });

    it('reports TARGET_NOT_PRESENT when the kept book is missing', async () => {
      const scenario = twoBooks();
      scenario.books[0] = { ...scenario.books[0], status: 'missing' };
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'TARGET_NOT_PRESENT', bookId: 1 }]);
    });

    it('reports SOURCE_PROCESSING for a source the scanner is still processing', async () => {
      const scenario = twoBooks();
      scenario.books[1] = { ...scenario.books[1], status: 'processing' };
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'SOURCE_PROCESSING', bookId: 2 }]);
    });

    it('reports BOTH_HAVE_AUDIO when more than one book has audio', async () => {
      const scenario = { ...twoBooks(), facts: [factsOf(1, { hasAudio: true }), factsOf(2, { hasAudio: true })] };
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'BOTH_HAVE_AUDIO' }]);
    });

    it('reports LIBRARY_BUSY while another operation holds the library', async () => {
      const { planner, libraryGate } = createPlanner(twoBooks());
      libraryGate.isHeld.mockReturnValue(true);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'LIBRARY_BUSY', libraryId: 1 }]);
      expect(libraryGate.isHeld).toHaveBeenCalledWith(1);
    });

    it('reports BOOK_BUSY for a book with background work in flight', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.findBusyBooks.mockResolvedValue(new Map([[2, 'read_aloud']]));

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'BOOK_BUSY', bookId: 2, busyReason: 'read_aloud' }]);
      expect(repository.findBusyBooks).toHaveBeenCalledWith([1, 2]);
    });

    it('reports BOOK_BUSY for a book whose operation lock is held', async () => {
      const { planner, fileLocks } = createPlanner(twoBooks());
      fileLocks.isLocked.mockImplementation((key: string) => key === 'book:1');

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'BOOK_BUSY', bookId: 1, busyReason: 'file_operation' }]);
    });

    it('reports LEGACY_VIRTUAL_FOLDER when a foldered book has a file outside its folder', async () => {
      const scenario = twoBooks();
      const stray = join(LIBRARY, 'Elsewhere', 'Dune.mobi');
      scenario.files[1] = fileRow(20, 2, stray);
      addFile(stray);
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toContainEqual({ code: 'LEGACY_VIRTUAL_FOLDER', bookId: 2 });
      expect(preview.eligible).toBe(false);
    });

    it('reports FOLDER_NOT_WRITABLE for a destination folder the server cannot write to', async () => {
      const { planner } = createPlanner(twoBooks());
      readOnly.add(TARGET_FOLDER);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'FOLDER_NOT_WRITABLE', libraryId: 1, relPath: join('Frank Herbert', 'Dune') }]);
    });

    it('reports FOLDER_NOT_WRITABLE for a source folder a file has to leave', async () => {
      const { planner } = createPlanner(twoBooks());
      readOnly.add(SOURCE_FOLDER);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'FOLDER_NOT_WRITABLE', libraryId: 1, relPath: join('Frank Herbert', 'Dune Copy') }]);
    });

    it('reports NESTED_BOOK_CONFLICT when a content file would land beside a folder named like its stem', async () => {
      const scenario = twoBooks();
      const sequel = join(SOURCE_FOLDER, 'Dune Messiah.epub');
      scenario.files[1] = fileRow(20, 2, sequel);
      addFile(sequel);
      addDir(join(TARGET_FOLDER, 'Dune Messiah'));
      const { planner } = createPlanner(scenario);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'NESTED_BOOK_CONFLICT', bookId: 2, relPath: join('Frank Herbert', 'Dune', 'Dune Messiah.epub') }]);
    });

    it('wraps the kept book into a new folder when every book is a single file at the library root', async () => {
      const targetFile = join(LIBRARY, 'Dune.epub');
      const sourceFile = join(LIBRARY, 'Dune.mobi');
      addFile(targetFile);
      addFile(sourceFile);
      const { planner } = createPlanner({
        books: [bookRow(1, targetFile, { primaryFileId: 10 }), bookRow(2, sourceFile)],
        files: [fileRow(10, 1, targetFile), fileRow(20, 2, sourceFile)],
      });

      const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([]);
      expect(preview.destinationCandidates).toEqual([]);
      expect(preview.destinationBookId).toBe(1);
      expect(preview.newFolderRelPath).toBe('Dune');
      expect(plan?.destination.folderPath).toBe(join(LIBRARY, 'Dune'));
      expect(plan?.steps).toHaveLength(1);
      expect(plan?.steps[0].moves.map((move) => [move.bookId, move.to])).toEqual([
        [1, join(LIBRARY, 'Dune', 'Dune.epub')],
        [2, join(LIBRARY, 'Dune', 'Dune.mobi')],
      ]);
      expect(plan?.steps[0].vacatedFolders).toEqual([]);
    });

    it('numbers the new folder when its name is taken on disk or by a book in the library', async () => {
      const targetFile = join(LIBRARY, 'Dune.epub');
      const sourceFile = join(LIBRARY, 'Dune.mobi');
      addFile(targetFile);
      addFile(sourceFile);
      addDir(join(LIBRARY, 'dune'));
      const { planner, repository } = createPlanner({
        books: [bookRow(1, targetFile, { primaryFileId: 10 }), bookRow(2, sourceFile)],
        files: [fileRow(10, 1, targetFile), fileRow(20, 2, sourceFile)],
      });
      repository.isFolderInUse.mockImplementation((_libraryId: number, path: string) => Promise.resolve(path === join(LIBRARY, 'Dune (2)')));

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.newFolderRelPath).toBe('Dune (3)');
    });

    it('reports NO_DESTINATION_FOLDER when every book is root-level and another root-level book is chosen as the destination', async () => {
      const targetFile = join(LIBRARY, 'Dune.epub');
      const sourceFile = join(LIBRARY, 'Dune.mobi');
      addFile(targetFile);
      addFile(sourceFile);
      const { planner } = createPlanner({
        books: [bookRow(1, targetFile), bookRow(2, sourceFile)],
        files: [fileRow(10, 1, targetFile), fileRow(20, 2, sourceFile)],
      });

      const { preview } = await planner.plan({ ...MERGE_2_INTO_1, destinationBookId: 2 }, makeUser());

      expect(preview.blockers).toEqual([{ code: 'NO_DESTINATION_FOLDER' }]);
      expect(preview.destinationBookId).toBeNull();
      expect(preview.newFolderRelPath).toBeNull();
    });

    it('reports PATH_CONFLICT when no numbered name is free in the destination', async () => {
      const { planner } = createPlanner(twoBooks());
      addFile(join(TARGET_FOLDER, 'Dune.mobi'));
      for (let attempt = 2; attempt <= 50; attempt++) addFile(join(TARGET_FOLDER, `Dune (${attempt}).mobi`));

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.blockers).toEqual([{ code: 'PATH_CONFLICT', bookId: 2, relPath: join('Frank Herbert', 'Dune', 'Dune.mobi') }]);
    });
  });

  describe('destination', () => {
    it('defaults to the first book with a folder of its own when the kept book is a root-level file', async () => {
      const targetFile = join(LIBRARY, 'Dune.epub');
      const rootSource = join(LIBRARY, 'Dune.azw3');
      const folderedSource = join(SOURCE_FOLDER, 'Dune.mobi');
      for (const path of [targetFile, rootSource, folderedSource]) addFile(path);
      const { planner } = createPlanner({
        books: [bookRow(1, targetFile), bookRow(2, rootSource), bookRow(3, SOURCE_FOLDER)],
        files: [fileRow(10, 1, targetFile), fileRow(20, 2, rootSource), fileRow(30, 3, folderedSource)],
      });

      const { preview, plan } = await planner.plan({ targetBookId: 1, sourceBookIds: [2, 3] }, makeUser());

      expect(preview.destinationCandidates).toEqual([3]);
      expect(preview.destinationBookId).toBe(3);
      expect(preview.warnings).toContainEqual({ code: 'DESTINATION_MOVES_TARGET', bookId: 3 });
      expect(plan?.destination.folderPath).toBe(SOURCE_FOLDER);
      expect(plan?.steps.map((step) => step.sourceBookId)).toEqual([3, 2]);
      expect(plan?.steps[0].moves).toEqual([expect.objectContaining({ fileId: 10, bookId: 1, to: join(SOURCE_FOLDER, 'Dune.epub') })]);
      expect(plan?.steps[0].targetFileIds).toEqual([10]);
    });

    it('rejects a destination that is not one of the merged books', async () => {
      const { planner } = createPlanner(twoBooks());

      await expect(planner.plan({ ...MERGE_2_INTO_1, destinationBookId: 3 }, makeUser())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('collisions', () => {
    it('renames a content file whose name is already taken in the destination, ignoring case', async () => {
      const scenario = twoBooks();
      const twin = join(SOURCE_FOLDER, 'DUNE.epub');
      scenario.files[1] = fileRow(20, 2, twin);
      addFile(twin);
      const { planner } = createPlanner(scenario);

      const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.eligible).toBe(true);
      expect(preview.files.find((entry) => entry.fileId === 20)).toMatchObject({
        action: 'move',
        renamed: true,
        toRelPath: join('Frank Herbert', 'Dune', 'DUNE (2).epub'),
      });
      expect(preview.warnings).toContainEqual({ code: 'RENAMED_ON_COLLISION', count: 1 });
      expect(plan?.steps[0].moves[0].to).toBe(join(TARGET_FOLDER, 'DUNE (2).epub'));
    });

    it('skips a name another file row owns even when the file is not on disk', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      const owned = join(TARGET_FOLDER, 'Dune.mobi').toLowerCase();
      repository.findPathOwners.mockImplementation((_libraryId: number, paths: string[]) =>
        Promise.resolve(new Map(paths.filter((path) => path.toLowerCase() === owned).map((path) => [path.toLowerCase(), 99]))),
      );

      const { plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(plan?.steps[0].moves[0].to).toBe(join(TARGET_FOLDER, 'Dune (2).mobi'));
    });

    it('never plans a move onto a name a file row owns when five or more numbered names are owned', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      const owned = new Set(
        ['Dune.mobi', 'Dune (2).mobi', 'Dune (3).mobi', 'Dune (4).mobi', 'Dune (5).mobi'].map((name) => join(TARGET_FOLDER, name).toLowerCase()),
      );
      repository.findPathOwners.mockImplementation((_libraryId: number, paths: string[]) =>
        Promise.resolve(new Map(paths.filter((path) => owned.has(path.toLowerCase())).map((path) => [path.toLowerCase(), 99]))),
      );

      const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      const planned = (plan?.steps ?? []).flatMap((step) => step.moves.map((move) => move.to.toLowerCase()));
      expect(planned.filter((path) => owned.has(path))).toEqual([]);
      if (preview.eligible) expect(planned).toContain(join(TARGET_FOLDER, 'Dune (6).mobi').toLowerCase());
      else expect(preview.blockers).toContainEqual(expect.objectContaining({ code: 'PATH_CONFLICT' }));
    });
  });

  describe('sidecars', () => {
    function withSourceCover(sourceContent = join(SOURCE_FOLDER, 'Dune.mobi')): Scenario {
      const cover = join(SOURCE_FOLDER, 'cover.jpg');
      const files = [
        fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')),
        fileRow(20, 2, sourceContent),
        fileRow(21, 2, cover, { role: 'cover', format: 'jpg' }),
      ];
      for (const file of files) addFile(file.absolutePath);
      return { books: [bookRow(1, TARGET_FOLDER), bookRow(2, SOURCE_FOLDER)], files };
    }

    it('leaves the source cover image in place when the kept book already has a cover for that medium (B8)', async () => {
      const { planner, repository } = createPlanner(withSourceCover());
      repository.findCoverMediums.mockResolvedValue(['ebook']);

      const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.files.find((entry) => entry.fileId === 21)).toMatchObject({ action: 'stay', reason: 'cover_kept_in_place' });
      expect(plan?.steps[0].moves.map((move) => move.fileId)).toEqual([20]);
      expect(plan?.steps[0].droppedSidecarFileIds).toEqual([21]);
      expect(preview.warnings).toContainEqual({ code: 'SIDECARS_LEFT_BEHIND', count: 1 });
    });

    it('moves the source cover image when the kept book has no cover of its own (B7)', async () => {
      const { planner } = createPlanner(withSourceCover());

      const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.files.find((entry) => entry.fileId === 21)).toMatchObject({ action: 'move', reason: 'cover' });
      expect(plan?.steps[0].moves.map((move) => move.to)).toContain(join(TARGET_FOLDER, 'cover.jpg'));
    });

    it('moves an audiobook source cover image when the kept book only has an ebook cover (B7)', async () => {
      const scenario = withSourceCover(join(SOURCE_FOLDER, 'Dune.m4b'));
      const { planner, repository } = createPlanner({ ...scenario, facts: [factsOf(1), factsOf(2, { hasAudio: true })] });
      repository.findCoverMediums.mockResolvedValue(['ebook']);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.files.find((entry) => entry.fileId === 21)).toMatchObject({ action: 'move', reason: 'cover' });
    });

    it("hides the destination source's metadata file and moves the kept book's own one in (B28)", async () => {
      const targetOpf = join(TARGET_FOLDER, 'metadata.opf');
      const sourceOpf = join(SOURCE_FOLDER, 'metadata.opf');
      const files = [
        fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')),
        fileRow(11, 1, targetOpf, { role: 'metadata', format: 'opf' }),
        fileRow(20, 2, join(SOURCE_FOLDER, 'Dune.mobi')),
        fileRow(21, 2, sourceOpf, { role: 'metadata', format: 'opf' }),
      ];
      for (const file of files) addFile(file.absolutePath);
      const { planner, repository } = createPlanner({ books: [bookRow(1, TARGET_FOLDER), bookRow(2, SOURCE_FOLDER)], files });
      repository.findPathOwners.mockImplementation((_libraryId: number, paths: string[]) =>
        Promise.resolve(new Map(paths.filter((path) => path.toLowerCase() === sourceOpf.toLowerCase()).map((path) => [path.toLowerCase(), 2]))),
      );

      const { preview, plan } = await planner.plan({ ...MERGE_2_INTO_1, destinationBookId: 2 }, makeUser());

      expect(preview.blockers).toEqual([]);
      expect(preview.files.find((entry) => entry.fileId === 21)).toMatchObject({ action: 'hide', reason: 'metadata_hidden' });
      expect(preview.files.find((entry) => entry.fileId === 11)).toMatchObject({
        action: 'move',
        toRelPath: join('Frank Herbert', 'Dune Copy', 'metadata.opf'),
      });
      const [step] = plan!.steps;
      expect(step.moves.map((move) => [move.fileId, move.kind, move.to])).toEqual([
        [21, 'hide', join(SOURCE_FOLDER, '.merged-2-metadata.opf')],
        [10, 'move', join(SOURCE_FOLDER, 'Dune.epub')],
        [11, 'move', sourceOpf],
      ]);
      expect(step.targetFileIds).toEqual([10, 11]);
      expect(step.droppedSidecarFileIds).toEqual([21]);
    });
  });

  describe('visibility overrides', () => {
    it.each([
      ['includeTagIds', { includeTagIds: [5] }],
      ['includeGenreIds', { includeGenreIds: [6] }],
    ])('refuses %s from a user who cannot manage users', async (_name, extra) => {
      const { planner, repository } = createPlanner(twoBooks());

      await expect(planner.plan({ ...MERGE_2_INTO_1, ...extra }, makeUser())).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.loadBooks).not.toHaveBeenCalled();
    });

    it('accepts includeTagIds from a user manager', async () => {
      const { planner } = createPlanner(twoBooks());

      const { preview } = await planner.plan({ ...MERGE_2_INTO_1, includeTagIds: [5] }, makeUser({ permissions: [Permission.ManageUsers] }));

      expect(preview.eligible).toBe(true);
      expect(preview.visibility.canOverride).toBe(true);
    });
  });

  describe('book summaries', () => {
    const activity = new Map([
      [1, { highlights: 2, shelves: 1, hasProgress: true, readers: 3 }],
      [2, { highlights: 0, shelves: 0, hasProgress: false, readers: 1 }],
    ]);

    it('shows the viewer their own activity and hides the reader count from a non-manager', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.countActivity.mockResolvedValue(activity);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(repository.countActivity).toHaveBeenCalledWith([1, 2], 1);
      expect(preview.books.map((book) => book.activity)).toEqual([
        { highlights: 2, shelves: 1, hasProgress: true, readers: null },
        { highlights: 0, shelves: 0, hasProgress: false, readers: null },
      ]);
      expect(preview.books[0]).toMatchObject({ libraryFolderId: 11, libraryFolderName: 'library' });
    });

    it('gives a user manager the reader count', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.countActivity.mockResolvedValue(activity);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser({ permissions: [Permission.ManageUsers] }));

      expect(preview.books.map((book) => book.activity?.readers)).toEqual([3, 1]);
    });

    it('lists the tags and genres the kept book ends with', async () => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.loadTagsAndGenres.mockResolvedValue({
        tags: [
          { bookId: 1, id: 5, name: 'Space' },
          { bookId: 2, id: 6, name: 'Classic' },
          { bookId: 2, id: 5, name: 'Space' },
        ],
        genres: [{ bookId: 2, id: 7, name: 'Science Fiction' }],
      });

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

      expect(preview.visibility.resultTags).toEqual(['Classic', 'Space']);
      expect(preview.visibility.resultGenres).toEqual(['Science Fiction']);
    });
  });

  describe('userData', () => {
    const counts = [
      { category: 'annotations', mine: true, rows: 4, users: 1 },
      { category: 'readingProgress', mine: false, rows: 3, users: 2 },
      { category: 'ratings', mine: false, rows: 1, users: 1 },
    ];

    it("hides other readers' counts from a user who cannot manage users", async () => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.countUserData.mockResolvedValue(counts);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser({ id: 4 }));

      expect(repository.countUserData).toHaveBeenCalledWith([2], 4);
      expect(preview.userData).toEqual({ own: [{ category: 'annotations', rows: 4, users: 1 }], others: null, otherReadersAffected: true });
      expect(preview.warnings).toContainEqual({ code: 'OTHER_READERS_AFFECTED' });
    });

    it.each([
      ['a superuser', { isSuperuser: true }],
      ['a user manager', { permissions: [Permission.ManageUsers] }],
    ])("shows other readers' counts to %s", async (_name, overrides) => {
      const { planner, repository } = createPlanner(twoBooks());
      repository.countUserData.mockResolvedValue(counts);

      const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser(overrides));

      expect(preview.userData.others).toEqual([
        { category: 'readingProgress', rows: 3, users: 2 },
        { category: 'ratings', rows: 1, users: 1 },
      ]);
      expect(preview.warnings).toContainEqual({ code: 'OTHER_READERS_AFFECTED', count: 2 });
    });
  });

  describe('previewToken', () => {
    it('is the same for the same books and files', async () => {
      const scenario = twoBooks();

      const first = await createPlanner(scenario).planner.plan(MERGE_2_INTO_1, makeUser());
      const second = await createPlanner(scenario).planner.plan(MERGE_2_INTO_1, makeUser());

      expect(first.preview.previewToken).not.toBeNull();
      expect(second.preview.previewToken).toBe(first.preview.previewToken);
    });

    it.each([
      ['size', { sizeBytes: 101 }],
      ['modification time', { mtime: new Date(MTIME_MS + 1000) }],
      ['path', { absolutePath: join(SOURCE_FOLDER, 'Dune (old).mobi') }],
    ])('changes when a file row changes its %s', async (_name, change) => {
      const scenario = twoBooks();
      const changed = { ...scenario, files: [scenario.files[0], { ...scenario.files[1], ...change }] };
      addFile(changed.files[1].absolutePath);

      const before = await createPlanner(scenario).planner.plan(MERGE_2_INTO_1, makeUser());
      const after = await createPlanner(changed).planner.plan(MERGE_2_INTO_1, makeUser());

      expect(after.preview.previewToken).not.toBeNull();
      expect(after.preview.previewToken).not.toBe(before.preview.previewToken);
    });
  });
});

describe('BookMergePlanner.plan across libraries', () => {
  const AUDIO = '/audio';
  const AUDIO_FOLDER = join(AUDIO, 'Frank Herbert', 'Dune');
  const manager = () => makeUser({ permissions: [Permission.ManageUsers] });

  /** Kept book 1 with Dune.epub in library 1; source 2 with Dune.m4b in library 2, on its own root. */
  function twoLibraries(sourceDev = 1): Scenario {
    const files = [fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')), fileRow(20, 2, join(AUDIO_FOLDER, 'Dune.m4b'), { sizeBytes: 500 })];
    addFile(files[0].absolutePath, 100);
    addFile(files[1].absolutePath, 500);
    if (sourceDev !== 1) disk.set(files[1].absolutePath, { ...disk.get(files[1].absolutePath)!, dev: sourceDev });
    return {
      books: [
        bookRow(1, TARGET_FOLDER, { primaryFileId: 10 }),
        bookRow(2, AUDIO_FOLDER, { libraryId: 2, libraryFolderId: 22, libraryFolderPath: AUDIO, primaryFileId: 20 }),
      ],
      files,
      facts: [factsOf(1), factsOf(2, { hasAudio: true })],
    };
  }

  it('moves a book from another library into the kept book folder in one step', async () => {
    const { planner } = createPlanner(twoLibraries());

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.eligible).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.destinationLibraryId).toBe(1);
    expect(preview.files.find((entry) => entry.fileId === 20)).toMatchObject({
      action: 'move',
      toRelPath: join('Frank Herbert', 'Dune', 'Dune.m4b'),
      fromLibraryId: 2,
      toLibraryId: 1,
    });
    expect(preview.books.map((book) => book.libraryName)).toEqual(['Library 1', 'Library 2']);
    expect(plan).toMatchObject({ libraryId: 1, libraryIds: [1, 2] });
    expect(plan?.steps[0].roots).toEqual([LIBRARY, AUDIO]);
    expect(preview.warnings.map((warning) => warning.code)).not.toContain('TARGET_CHANGES_LIBRARY');
  });

  it('names a read-only source folder inside its own library, not relative to the destination', async () => {
    const { planner } = createPlanner(twoLibraries());
    readOnly.add(AUDIO_FOLDER);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'FOLDER_NOT_WRITABLE', libraryId: 2, relPath: join('Frank Herbert', 'Dune') }]);
  });

  it('asks a user manager to confirm when other readers would lose access, with their count', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.findReadersLosingAccess.mockResolvedValue(new Set([7, 8]));

    const { preview } = await planner.plan(MERGE_2_INTO_1, manager());

    expect(preview.eligible).toBe(true);
    expect(preview.warnings).toContainEqual({ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 2 });
    expect(repository.findReadersLosingAccess).toHaveBeenCalledWith([2], 1);
  });

  it('blocks a user who cannot see other readers from cutting their access', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.findReadersLosingAccess.mockResolvedValue(new Set([7]));

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'READERS_LOSE_ACCESS', libraryId: 1 }]);
    expect(plan).toBeNull();
  });

  it('counts requesters who could no longer see the book and keeps their requests off it', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.findRequestsOnBooks.mockResolvedValue([{ id: 55, userIds: [9] }]);
    repository.findUsersWithoutLibraryAccess.mockResolvedValue(new Set([9]));

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, manager(), {});
    const again = await planner.plan(MERGE_2_INTO_1, manager());

    expect(preview.warnings).toContainEqual({ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 1 });
    expect(plan?.hiddenRequestIds).toEqual([55]);
    expect(again.preview.previewToken).toBe(preview.previewToken);
  });

  it('defaults to the destination where nobody loses access, moving the kept book there', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.findReadersLosingAccess.mockImplementation((_ids: number[], libraryId: number) =>
      Promise.resolve(new Set(libraryId === 1 ? [7] : [])),
    );

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.eligible).toBe(true);
    expect(preview.destinationBookId).toBe(2);
    expect(preview.destinationLibraryId).toBe(2);
    expect(preview.destinationAccessLoss).toEqual([
      { bookId: 1, libraryId: 1, losesAccess: true, count: null },
      { bookId: 2, libraryId: 2, losesAccess: false, count: null },
    ]);
    expect(preview.warnings).toContainEqual({ code: 'TARGET_CHANGES_LIBRARY', bookId: 1, libraryId: 2 });
    expect(plan?.libraryId).toBe(2);
    expect(plan?.steps[0].moves.map((move) => move.to)).toEqual([join(AUDIO_FOLDER, 'Dune.epub')]);
  });

  it('keeps an explicit destination even when it costs access, and says so', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.findReadersLosingAccess.mockImplementation((_ids: number[], libraryId: number) =>
      Promise.resolve(new Set(libraryId === 1 ? [7] : [])),
    );

    const { preview } = await planner.plan({ ...MERGE_2_INTO_1, destinationBookId: 1 }, manager());

    expect(preview.destinationBookId).toBe(1);
    expect(preview.warnings).toContainEqual({ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 1 });
  });

  it('refuses a format the destination library does not allow', async () => {
    const scenario = twoLibraries();
    scenario.libraries = [libraryRow(1, { allowedFormats: ['epub'] }), libraryRow(2)];
    const { planner } = createPlanner(scenario);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'FORMAT_NOT_ALLOWED', bookId: 2, libraryId: 1, format: 'm4b' }]);
  });

  it('refuses a path the destination library excludes from scans', async () => {
    const scenario = twoLibraries();
    scenario.libraries = [libraryRow(1, { excludePatterns: ['*.m4b'] }), libraryRow(2)];
    const { planner } = createPlanner(scenario);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'PATH_EXCLUDED', bookId: 2, libraryId: 1, relPath: join('Frank Herbert', 'Dune', 'Dune.m4b') }]);
  });

  it('refuses to leave a book file behind in the library the book leaves, unless another book owns it', async () => {
    const scenario = twoLibraries();
    addFile(join(AUDIO_FOLDER, 'Bonus.mp3'));
    addFile(join(AUDIO_FOLDER, 'Other.mp3'));
    const { planner, repository } = createPlanner(scenario);
    repository.findPathOwners.mockImplementation((libraryId: number, paths: string[]) =>
      Promise.resolve(
        new Map(libraryId === 2 && paths.includes(join(AUDIO_FOLDER, 'Other.mp3')) ? [[join(AUDIO_FOLDER, 'Other.mp3').toLowerCase(), 99]] : []),
      ),
    );

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'LEFTOVER_CONTENT', bookId: 2, libraryId: 2, relPath: join('Frank Herbert', 'Dune', 'Bonus.mp3') }]);
  });

  it('ignores a leftover file the source library would not import', async () => {
    const scenario = twoLibraries();
    scenario.libraries = [libraryRow(1), libraryRow(2, { allowedFormats: ['m4b'] })];
    addFile(join(AUDIO_FOLDER, 'Bonus.mp3'));
    addFile(join(AUDIO_FOLDER, 'notes.txt'));
    const { planner } = createPlanner(scenario);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([]);
  });

  it('refuses a copy onto another drive that lacks room, and warns about hard-linked files', async () => {
    const scenario = twoLibraries(2);
    disk.set(join(AUDIO_FOLDER, 'Dune.m4b'), { ...disk.get(join(AUDIO_FOLDER, 'Dune.m4b'))!, nlink: 2 });
    const { planner } = createPlanner(scenario);
    vi.mocked(statfs).mockResolvedValue({ bavail: 1n, bsize: 100n, blocks: 1000n } as never);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'INSUFFICIENT_SPACE', bytes: 500 }]);
    expect(preview.warnings).toContainEqual({ code: 'HARDLINKED_FILES', count: 1 });
    expect(preview.warnings).toContainEqual({ code: 'CROSS_DEVICE_COPY', bytes: 500 });
  });

  it('lets a book from a file-per-book library merge into a folder of its own', async () => {
    const file = fileRow(20, 2, join(AUDIO, 'Dune.m4b'));
    addFile(join(TARGET_FOLDER, 'Dune.epub'));
    addFile(file.absolutePath);
    addFile(join(AUDIO, 'Another Book.m4b'));
    const scenario: Scenario = {
      books: [
        bookRow(1, TARGET_FOLDER),
        bookRow(2, file.absolutePath, { libraryId: 2, libraryFolderId: 22, libraryFolderPath: AUDIO, organizationMode: 'book_per_file' }),
      ],
      files: [fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')), file],
    };
    const { planner } = createPlanner(scenario);

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([]);
    expect(preview.destinationCandidates).toEqual([1]);
    expect(plan?.steps[0]).toMatchObject({ vacatedFolders: [], moves: [expect.objectContaining({ to: join(TARGET_FOLDER, 'Dune.m4b') })] });
  });

  it('never offers a book in a file-per-book library as the destination', async () => {
    const file = fileRow(20, 2, join(AUDIO, 'Dune.m4b'));
    addFile(join(TARGET_FOLDER, 'Dune.epub'));
    addFile(file.absolutePath);
    const scenario: Scenario = {
      books: [
        bookRow(1, TARGET_FOLDER),
        bookRow(2, file.absolutePath, { libraryId: 2, libraryFolderId: 22, libraryFolderPath: AUDIO, organizationMode: 'book_per_file' }),
      ],
      files: [fileRow(10, 1, join(TARGET_FOLDER, 'Dune.epub')), file],
    };
    const { planner } = createPlanner(scenario);

    const { preview } = await planner.plan({ ...MERGE_2_INTO_1, destinationBookId: 2 }, makeUser());

    expect(preview.blockers).toEqual([{ code: 'FILE_PER_BOOK_LIBRARY', bookId: 2 }]);
  });

  it('reports what the destination library changes for the merged book', async () => {
    const scenario = twoLibraries();
    scenario.facts = [factsOf(1), factsOf(2)];
    scenario.libraries = [
      libraryRow(1, { formatPriority: ['m4b', 'epub'], fileWriteEnabled: true }),
      libraryRow(2, { fileNamingPattern: '{authors}/{title}' }),
    ];
    const { planner } = createPlanner(scenario);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.librarySettingChanges).toEqual([
      { setting: 'primaryFormat', fromLibraryId: 1, toLibraryId: 1, format: 'm4b' },
      { setting: 'fileWrite', fromLibraryId: 2, toLibraryId: 1 },
      { setting: 'namingPattern', fromLibraryId: 2, toLibraryId: 1 },
    ]);
  });

  it('says when a requested other format will land in the library the book leaves (X35)', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.countCompanionRequestsLeftBehind.mockResolvedValue([{ libraryId: 2, count: 1 }]);

    const asManager = await planner.plan(MERGE_2_INTO_1, manager());
    const asEditor = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(repository.countCompanionRequestsLeftBehind).toHaveBeenCalledWith([2], 1);
    expect(asManager.preview.warnings).toContainEqual({ code: 'COMPANION_REQUEST_STAYS', libraryId: 2, count: 1 });
    expect(asEditor.preview.warnings).toContainEqual({ code: 'COMPANION_REQUEST_STAYS', libraryId: 2 });
    expect(asEditor.preview.eligible).toBe(true);
  });

  it('makes the preview stale when a library change only alters what the review warned about (X25)', async () => {
    const scenario = twoLibraries();
    const { planner, repository } = createPlanner(scenario);
    const base = (await planner.plan(MERGE_2_INTO_1, manager())).preview.previewToken;

    repository.countKoboUsersLosingAccess.mockResolvedValue(1);
    const koboChanged = (await planner.plan(MERGE_2_INTO_1, manager())).preview.previewToken;
    repository.countKoboUsersLosingAccess.mockResolvedValue(0);
    const restored = (await planner.plan(MERGE_2_INTO_1, manager())).preview.previewToken;
    scenario.libraries = [libraryRow(1, { formatPriority: ['m4b', 'epub'] }), libraryRow(2)];
    const priorityChanged = (await createPlanner(scenario).planner.plan(MERGE_2_INTO_1, manager())).preview.previewToken;

    expect(base).not.toBeNull();
    expect(koboChanged).not.toBe(base);
    expect(restored).toBe(base);
    expect(priorityChanged).not.toBe(base);
  });

  it('warns about Kobo devices and hidden custom fields, counting devices only for user managers', async () => {
    const { planner, repository } = createPlanner(twoLibraries());
    repository.countKoboUsersLosingAccess.mockResolvedValue(3);
    repository.countHiddenCustomFields.mockResolvedValue(2);
    repository.findSessionReaders.mockResolvedValue([4, 5]);

    const asManager = await planner.plan(MERGE_2_INTO_1, manager());
    const asEditor = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(asManager.preview.warnings).toContainEqual({ code: 'KOBO_REMOVAL', libraryId: 1, count: 3 });
    expect(asEditor.preview.warnings).toContainEqual({ code: 'KOBO_REMOVAL', libraryId: 1 });
    expect(asEditor.preview.warnings).toContainEqual({ code: 'CUSTOM_FIELDS_HIDDEN', libraryId: 1, count: 2 });
    expect(asEditor.plan?.dailyStatsUserIds).toEqual([4, 5]);
    expect(repository.countKoboUsersLosingAccess).toHaveBeenCalledWith([2], 1);
  });

  it('merges books from three libraries under one plan, grouping each file by where it comes from (X10)', async () => {
    const COMICS = '/comics';
    const COMICS_FOLDER = join(COMICS, 'Frank Herbert', 'Dune');
    const scenario = twoLibraries();
    const comic = fileRow(30, 3, join(COMICS_FOLDER, 'Dune.cbz'), { sizeBytes: 700 });
    addFile(comic.absolutePath, 700);
    scenario.files = [...scenario.files, comic];
    scenario.books = [
      ...scenario.books,
      bookRow(3, COMICS_FOLDER, { libraryId: 3, libraryFolderId: 33, libraryFolderPath: COMICS, primaryFileId: 30 }),
    ];
    scenario.facts = [...scenario.facts, factsOf(3)];
    const { planner, libraryGate } = createPlanner(scenario);
    const request = { targetBookId: 1, sourceBookIds: [2, 3] };

    const { preview, plan } = await planner.plan(request, makeUser());

    expect(preview.eligible).toBe(true);
    expect(plan?.libraryIds).toEqual([1, 2, 3]);
    expect(new Set(plan?.steps.flatMap((step) => step.roots))).toEqual(new Set([LIBRARY, AUDIO, COMICS]));
    expect(preview.files.filter((entry) => entry.action === 'move').map((entry) => [entry.fileId, entry.fromLibraryId, entry.toLibraryId])).toEqual([
      [20, 2, 1],
      [30, 3, 1],
    ]);

    libraryGate.isHeld.mockImplementation((id: number) => id === 3);
    expect((await planner.plan(request, makeUser())).preview.blockers).toEqual([{ code: 'LIBRARY_BUSY', libraryId: 3 }]);
  });

  it('reports LIBRARY_BUSY for whichever involved library is held', async () => {
    const { planner, libraryGate } = createPlanner(twoLibraries());
    libraryGate.isHeld.mockImplementation((id: number) => id === 2);

    const { preview } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(preview.blockers).toEqual([{ code: 'LIBRARY_BUSY', libraryId: 2 }]);
  });

  it('changes nothing for books in one library: no access checks, no library lines', async () => {
    const { planner, repository } = createPlanner(twoBooks());

    const { preview, plan } = await planner.plan(MERGE_2_INTO_1, makeUser());

    expect(repository.findReadersLosingAccess).not.toHaveBeenCalled();
    expect(preview.destinationAccessLoss).toEqual([]);
    expect(preview.librarySettingChanges).toEqual([]);
    expect(plan).toMatchObject({ libraryId: 1, libraryIds: [1], dailyStatsUserIds: [] });
  });
});
