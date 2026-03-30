vi.mock('../src/modules/scanner/lib/stability', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import type { FixtureEntry } from './e2e/scanner/scanner-fixture-builder';
import { createFixtureTree, file } from './e2e/scanner/scanner-fixture-builder';
import {
  assertNoIntegrityViolations,
  closeScannerE2EContext,
  createScannerE2EContext,
  loadLibraryBookState,
  seedLibrary,
  triggerLibraryScan,
  waitForScanCompletion,
  type LibraryBookState,
  type ScannerE2EContext,
} from './e2e/scanner/scanner-harness';

type OrganizationMode = 'book_per_file' | 'book_per_folder';

interface ExpectedBook {
  folderPath: string;
  filePaths: string[];
  primaryPath?: string | null;
  status?: 'present' | 'missing';
}

interface ScannerScenario {
  id: string;
  mode: OrganizationMode;
  entries: FixtureEntry[];
  expected: ExpectedBook[];
  allowedFormats?: string[];
  excludePatterns?: string[];
}

interface ScenarioRunResult {
  id: string;
  mode: OrganizationMode;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

const SCENARIO_TIMEOUT_MS = 60_000;

const bookPerFolderScenarios: ScannerScenario[] = [
  {
    id: 'book-per-folder-flat-root-file',
    mode: 'book_per_folder',
    entries: [file('book.epub')],
    expected: [{ folderPath: 'book.epub', filePaths: ['book.epub'], primaryPath: 'book.epub' }],
  },
  {
    id: 'book-per-folder-mixed-root-and-folder',
    mode: 'book_per_folder',
    entries: [file('root.pdf'), file('Author/Book/book.epub')],
    expected: [
      { folderPath: 'root.pdf', filePaths: ['root.pdf'], primaryPath: 'root.pdf' },
      { folderPath: 'Author/Book', filePaths: ['Author/Book/book.epub'], primaryPath: 'Author/Book/book.epub' },
    ],
  },
  {
    id: 'book-per-folder-multi-format-folder-and-root-stray',
    mode: 'book_per_folder',
    entries: [file('Series/Book/book.epub'), file('Series/Book/book.mobi'), file('Series/Book/cover.jpg'), file('stray.cbz')],
    expected: [
      {
        folderPath: 'Series/Book',
        filePaths: ['Series/Book/book.epub', 'Series/Book/book.mobi', 'Series/Book/cover.jpg'],
        primaryPath: 'Series/Book/book.epub',
      },
      { folderPath: 'stray.cbz', filePaths: ['stray.cbz'], primaryPath: 'stray.cbz' },
    ],
  },
  {
    id: 'book-per-folder-audiobook-multipart-folder',
    mode: 'book_per_folder',
    entries: [file('Audio/track-1.mp3'), file('Audio/track-2.mp3'), file('Audio/cover.jpg')],
    expected: [
      {
        folderPath: 'Audio',
        filePaths: ['Audio/cover.jpg', 'Audio/track-1.mp3', 'Audio/track-2.mp3'],
        primaryPath: 'Audio/track-1.mp3',
      },
    ],
  },
  {
    id: 'book-per-folder-disc-folder-flattening',
    mode: 'book_per_folder',
    entries: [file('AudioBook/CD 1/01.mp3'), file('AudioBook/Disc 2/02.mp3'), file('AudioBook/cover.jpg')],
    expected: [
      {
        folderPath: 'AudioBook',
        filePaths: ['AudioBook/CD 1/01.mp3', 'AudioBook/Disc 2/02.mp3', 'AudioBook/cover.jpg'],
        primaryPath: 'AudioBook/CD 1/01.mp3',
      },
    ],
  },
  {
    id: 'book-per-folder-ebook-with-stem-audio-subfolder',
    mode: 'book_per_folder',
    entries: [file('TheBook/TheBook.epub'), file('TheBook/TheBook/01.mp3'), file('TheBook/TheBook/02.mp3')],
    expected: [
      {
        folderPath: 'TheBook',
        filePaths: ['TheBook/TheBook.epub', 'TheBook/TheBook/01.mp3', 'TheBook/TheBook/02.mp3'],
        primaryPath: 'TheBook/TheBook.epub',
      },
    ],
  },
  {
    id: 'book-per-folder-root-stem-audio-not-flattened',
    mode: 'book_per_folder',
    entries: [file('BookTitle.epub'), file('BookTitle/01.mp3'), file('BookTitle/02.mp3')],
    expected: [
      { folderPath: 'BookTitle.epub', filePaths: ['BookTitle.epub'], primaryPath: 'BookTitle.epub' },
      { folderPath: 'BookTitle', filePaths: ['BookTitle/01.mp3', 'BookTitle/02.mp3'], primaryPath: 'BookTitle/01.mp3' },
    ],
  },
  {
    id: 'book-per-folder-hidden-files-and-folders-ignored',
    mode: 'book_per_folder',
    entries: [file('.hidden/ghost.epub'), file('.root-hidden.epub'), file('Visible/book.epub')],
    expected: [{ folderPath: 'Visible', filePaths: ['Visible/book.epub'], primaryPath: 'Visible/book.epub' }],
  },
  {
    id: 'book-per-folder-exclude-patterns',
    mode: 'book_per_folder',
    entries: [file('skip-folder/book.epub'), file('keep-folder/book.epub'), file('keep-folder/cover.jpg')],
    excludePatterns: ['skip*'],
    expected: [{ folderPath: 'keep-folder', filePaths: ['keep-folder/book.epub', 'keep-folder/cover.jpg'], primaryPath: 'keep-folder/book.epub' }],
  },
  {
    id: 'book-per-folder-allowed-formats',
    mode: 'book_per_folder',
    entries: [file('book.epub'), file('book.pdf')],
    allowedFormats: ['epub'],
    expected: [{ folderPath: 'book.epub', filePaths: ['book.epub'], primaryPath: 'book.epub' }],
  },
  {
    id: 'book-per-folder-zero-byte-content-file-skipped',
    mode: 'book_per_folder',
    entries: [file('zero.epub', '')],
    expected: [{ folderPath: 'zero.epub', filePaths: [], primaryPath: null }],
  },
  {
    id: 'book-per-folder-no-primary-files',
    mode: 'book_per_folder',
    entries: [file('Only/cover.jpg'), file('Only/book.opf')],
    expected: [],
  },
  {
    id: 'book-per-folder-deep-nested-book-folder',
    mode: 'book_per_folder',
    entries: [file('A/B/C/book.epub')],
    expected: [{ folderPath: 'A/B/C', filePaths: ['A/B/C/book.epub'], primaryPath: 'A/B/C/book.epub' }],
  },
  {
    id: 'book-per-folder-same-filename-different-authors',
    mode: 'book_per_folder',
    entries: [file('Author One/Shared/book.epub'), file('Author Two/Shared/book.epub')],
    expected: [
      { folderPath: 'Author One/Shared', filePaths: ['Author One/Shared/book.epub'], primaryPath: 'Author One/Shared/book.epub' },
      { folderPath: 'Author Two/Shared', filePaths: ['Author Two/Shared/book.epub'], primaryPath: 'Author Two/Shared/book.epub' },
    ],
  },
  {
    id: 'book-per-folder-disc-name-variants-flattened',
    mode: 'book_per_folder',
    entries: [file('Saga/Disk03/03.mp3'), file('Saga/PartA/04.mp3'), file('Saga/SideB/05.mp3'), file('Saga/front.jpg')],
    expected: [
      {
        folderPath: 'Saga',
        filePaths: ['Saga/Disk03/03.mp3', 'Saga/PartA/04.mp3', 'Saga/SideB/05.mp3', 'Saga/front.jpg'],
        primaryPath: 'Saga/Disk03/03.mp3',
      },
    ],
  },
  {
    id: 'book-per-folder-stem-subfolder-case-mismatch-no-merge',
    mode: 'book_per_folder',
    entries: [file('Novel/Book.epub'), file('Novel/book/01.mp3'), file('Novel/book/02.mp3')],
    expected: [
      { folderPath: 'Novel', filePaths: ['Novel/Book.epub'], primaryPath: 'Novel/Book.epub' },
      { folderPath: 'Novel/book', filePaths: ['Novel/book/01.mp3', 'Novel/book/02.mp3'], primaryPath: 'Novel/book/01.mp3' },
    ],
  },
  {
    id: 'book-per-folder-stem-subfolder-with-disc-flattening',
    mode: 'book_per_folder',
    entries: [file('Title/Title.epub'), file('Title/Title/CD 1/01.mp3'), file('Title/Title/Disc 2/02.mp3'), file('Title/cover.jpg')],
    expected: [
      {
        folderPath: 'Title',
        filePaths: ['Title/Title.epub', 'Title/Title/CD 1/01.mp3', 'Title/Title/Disc 2/02.mp3', 'Title/cover.jpg'],
        primaryPath: 'Title/Title.epub',
      },
    ],
  },
  {
    id: 'book-per-folder-root-multi-format-files-remain-separate',
    mode: 'book_per_folder',
    entries: [file('book.epub'), file('book.mobi')],
    expected: [
      { folderPath: 'book.epub', filePaths: ['book.epub'], primaryPath: 'book.epub' },
      { folderPath: 'book.mobi', filePaths: ['book.mobi'], primaryPath: 'book.mobi' },
    ],
  },
  {
    id: 'book-per-folder-multi-book-single-folder-coalesced',
    mode: 'book_per_folder',
    entries: [file('Anthology/Book One.epub'), file('Anthology/Book Two.epub'), file('Anthology/cover.jpg')],
    expected: [{ folderPath: 'Anthology', filePaths: ['Anthology/Book One.epub', 'Anthology/Book Two.epub', 'Anthology/cover.jpg'] }],
  },
  {
    id: 'book-per-folder-allowed-formats-audio-filter',
    mode: 'book_per_folder',
    entries: [file('Audio/book.mp3'), file('Audio/book.m4b'), file('Audio/cover.jpg')],
    allowedFormats: ['m4b'],
    expected: [{ folderPath: 'Audio', filePaths: ['Audio/book.m4b', 'Audio/cover.jpg'], primaryPath: 'Audio/book.m4b' }],
  },
  {
    id: 'book-per-folder-exclude-exact-root-filename',
    mode: 'book_per_folder',
    entries: [file('skip.epub'), file('Keep/book.epub')],
    excludePatterns: ['skip.epub'],
    expected: [{ folderPath: 'Keep', filePaths: ['Keep/book.epub'], primaryPath: 'Keep/book.epub' }],
  },
  {
    id: 'book-per-folder-uppercase-extensions',
    mode: 'book_per_folder',
    entries: [file('Caps/BOOK.EPUB'), file('Caps/COVER.JPG')],
    expected: [{ folderPath: 'Caps', filePaths: ['Caps/BOOK.EPUB', 'Caps/COVER.JPG'], primaryPath: 'Caps/BOOK.EPUB' }],
  },
  {
    id: 'book-per-folder-non-disc-similar-folder-not-flattened',
    mode: 'book_per_folder',
    entries: [file('AudioBook/Discography/01.mp3'), file('AudioBook/cover.jpg')],
    expected: [{ folderPath: 'AudioBook/Discography', filePaths: ['AudioBook/Discography/01.mp3'], primaryPath: 'AudioBook/Discography/01.mp3' }],
  },
];

const bookPerFileScenarios: ScannerScenario[] = [
  {
    id: 'book-per-file-multiple-content-files',
    mode: 'book_per_file',
    entries: [file('Series/book1.epub'), file('Series/book2.epub'), file('Series/book3.mobi'), file('Series/cover.jpg')],
    expected: [
      { folderPath: 'Series/book1.epub', filePaths: ['Series/book1.epub'], primaryPath: 'Series/book1.epub' },
      { folderPath: 'Series/book2.epub', filePaths: ['Series/book2.epub'], primaryPath: 'Series/book2.epub' },
      { folderPath: 'Series/book3.mobi', filePaths: ['Series/book3.mobi'], primaryPath: 'Series/book3.mobi' },
    ],
  },
  {
    id: 'book-per-file-audio-parts',
    mode: 'book_per_file',
    entries: [file('Audio/01.mp3'), file('Audio/02.mp3')],
    expected: [
      { folderPath: 'Audio/01.mp3', filePaths: ['Audio/01.mp3'], primaryPath: 'Audio/01.mp3' },
      { folderPath: 'Audio/02.mp3', filePaths: ['Audio/02.mp3'], primaryPath: 'Audio/02.mp3' },
    ],
  },
  {
    id: 'book-per-file-ignore-non-content',
    mode: 'book_per_file',
    entries: [file('Book/cover.jpg'), file('Book/book.epub')],
    expected: [{ folderPath: 'Book/book.epub', filePaths: ['Book/book.epub'], primaryPath: 'Book/book.epub' }],
  },
  {
    id: 'book-per-file-allowed-formats-and-excludes',
    mode: 'book_per_file',
    entries: [file('keep.epub'), file('keep.pdf'), file('skip-folder/skip.epub')],
    allowedFormats: ['epub'],
    excludePatterns: ['skip*'],
    expected: [{ folderPath: 'keep.epub', filePaths: ['keep.epub'], primaryPath: 'keep.epub' }],
  },
  {
    id: 'book-per-file-deep-root-mix',
    mode: 'book_per_file',
    entries: [file('root.epub'), file('A/B/C/book.pdf'), file('A/B/C/cover.jpg')],
    expected: [
      { folderPath: 'root.epub', filePaths: ['root.epub'], primaryPath: 'root.epub' },
      { folderPath: 'A/B/C/book.pdf', filePaths: ['A/B/C/book.pdf'], primaryPath: 'A/B/C/book.pdf' },
    ],
  },
  {
    id: 'book-per-file-disc-subfolders-not-grouped',
    mode: 'book_per_file',
    entries: [file('Saga/CD 1/01.mp3'), file('Saga/Disc 2/02.mp3'), file('Saga/cover.jpg')],
    expected: [
      { folderPath: 'Saga/CD 1/01.mp3', filePaths: ['Saga/CD 1/01.mp3'], primaryPath: 'Saga/CD 1/01.mp3' },
      { folderPath: 'Saga/Disc 2/02.mp3', filePaths: ['Saga/Disc 2/02.mp3'], primaryPath: 'Saga/Disc 2/02.mp3' },
    ],
  },
  {
    id: 'book-per-file-uppercase-extensions',
    mode: 'book_per_file',
    entries: [file('Novel/Book.EPUB'), file('Novel/Book.PDF')],
    expected: [
      { folderPath: 'Novel/Book.EPUB', filePaths: ['Novel/Book.EPUB'], primaryPath: 'Novel/Book.EPUB' },
      { folderPath: 'Novel/Book.PDF', filePaths: ['Novel/Book.PDF'], primaryPath: 'Novel/Book.PDF' },
    ],
  },
  {
    id: 'book-per-file-exclude-exact-filename',
    mode: 'book_per_file',
    entries: [file('keep.epub'), file('skip.epub')],
    excludePatterns: ['skip.epub'],
    expected: [{ folderPath: 'keep.epub', filePaths: ['keep.epub'], primaryPath: 'keep.epub' }],
  },
  {
    id: 'book-per-file-allowed-formats-case-insensitive',
    mode: 'book_per_file',
    entries: [file('keep.EPUB'), file('drop.PDF')],
    allowedFormats: ['epub'],
    expected: [{ folderPath: 'keep.EPUB', filePaths: ['keep.EPUB'], primaryPath: 'keep.EPUB' }],
  },
  {
    id: 'book-per-file-hidden-and-no-extension-ignored',
    mode: 'book_per_file',
    entries: [file('.hidden/ghost.epub'), file('visible/README'), file('visible/book.mobi')],
    expected: [{ folderPath: 'visible/book.mobi', filePaths: ['visible/book.mobi'], primaryPath: 'visible/book.mobi' }],
  },
  {
    id: 'book-per-file-root-and-nested-same-name',
    mode: 'book_per_file',
    entries: [file('book.epub'), file('Series/book.epub')],
    expected: [
      { folderPath: 'book.epub', filePaths: ['book.epub'], primaryPath: 'book.epub' },
      { folderPath: 'Series/book.epub', filePaths: ['Series/book.epub'], primaryPath: 'Series/book.epub' },
    ],
  },
  {
    id: 'book-per-file-zero-byte-file-skipped',
    mode: 'book_per_file',
    entries: [file('empty.epub', ''), file('valid.epub')],
    expected: [
      { folderPath: 'empty.epub', filePaths: [], primaryPath: null },
      { folderPath: 'valid.epub', filePaths: ['valid.epub'], primaryPath: 'valid.epub' },
    ],
  },
];

function toAbsolutePath(rootPath: string, relativePath: string): string {
  return join(rootPath, relativePath);
}

function assertScenarioOutcome(rootPath: string, expected: ExpectedBook[], actual: LibraryBookState[]): void {
  const resolvedExpected = expected.map((book) => ({
    folderPath: toAbsolutePath(rootPath, book.folderPath),
    status: book.status ?? 'present',
    primaryPath: book.primaryPath === undefined ? undefined : book.primaryPath === null ? null : toAbsolutePath(rootPath, book.primaryPath),
    filePaths: book.filePaths.map((path) => toAbsolutePath(rootPath, path)).sort(),
  }));

  const expectedFolderPaths = resolvedExpected.map((book) => book.folderPath).sort();
  const actualFolderPaths = actual.map((book) => book.folderPath).sort();
  expect(actualFolderPaths).toEqual(expectedFolderPaths);

  const actualByFolderPath = new Map(actual.map((book) => [book.folderPath, book]));

  for (const expectedBook of resolvedExpected) {
    const actualBook = actualByFolderPath.get(expectedBook.folderPath);
    expect(actualBook).toBeDefined();
    expect(actualBook!.status).toBe(expectedBook.status);
    expect(actualBook!.filePaths).toEqual(expectedBook.filePaths);
    if (expectedBook.primaryPath !== undefined) {
      expect(actualBook!.primaryPath).toBe(expectedBook.primaryPath);
    }
  }
}

async function runScenario(context: ScannerE2EContext, scenario: ScannerScenario, results: ScenarioRunResult[]): Promise<void> {
  const fixture = await createFixtureTree(scenario.entries, `scanner-e2e-${scenario.id}-`);
  const startedAt = Date.now();

  try {
    const { libraryId } = await seedLibrary(context.db, {
      rootPath: fixture.rootPath,
      mode: scenario.mode,
      allowedFormats: scenario.allowedFormats,
      excludePatterns: scenario.excludePatterns,
    });

    const jobId = await triggerLibraryScan(context, libraryId);
    await waitForScanCompletion(context.db, jobId);

    const actual = await loadLibraryBookState(context.db, libraryId);
    assertScenarioOutcome(fixture.rootPath, scenario.expected, actual);
    await assertNoIntegrityViolations(context.db);

    results.push({
      id: scenario.id,
      mode: scenario.mode,
      status: 'passed',
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    results.push({
      id: scenario.id,
      mode: scenario.mode,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await fixture.cleanup();
  }
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'scanner-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      },
      null,
      2,
    ),
  );
}

describe('Scanner structures (e2e)', () => {
  let context: ScannerE2EContext | null = null;
  const scenarioResults: ScenarioRunResult[] = [];

  beforeAll(async () => {
    context = await createScannerE2EContext();
  });

  afterAll(async () => {
    if (context) {
      await assertNoIntegrityViolations(context.db);
    }
    await writeScenarioReport(scenarioResults);
    if (context) {
      await closeScannerE2EContext(context);
    }
  });

  describe('organizationMode=book_per_folder', () => {
    for (const scenario of bookPerFolderScenarios) {
      it(
        scenario.id,
        async () => {
          if (!context) throw new Error('E2E context not initialized');
          await runScenario(context, scenario, scenarioResults);
        },
        SCENARIO_TIMEOUT_MS,
      );
    }
  });

  describe('organizationMode=book_per_file', () => {
    for (const scenario of bookPerFileScenarios) {
      it(
        scenario.id,
        async () => {
          if (!context) throw new Error('E2E context not initialized');
          await runScenario(context, scenario, scenarioResults);
        },
        SCENARIO_TIMEOUT_MS,
      );
    }
  });
});
