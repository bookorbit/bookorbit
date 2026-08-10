import { BookMovePlannerService } from './book-move-planner.service';
import type { BookMovePlanOutcome, PlanInput } from './book-move-planner.service';
import type { MoveBookData, MoveBookFile, MoveTargetLibrary } from './book-move.repository';

const PATTERN_PER_FOLDER = '<{authors:first}|Unknown Author>/<{title}|{originalFilename}>/<{title}|{originalFilename}>';
const PATTERN_PER_FILE = '<{authors:first}|Unknown Author>/<{title}|{originalFilename}>';

function makeFile(overrides: Partial<MoveBookFile> & { id: number; absolutePath: string }): MoveBookFile {
  return {
    relPath: null,
    role: 'content',
    format: 'epub',
    fileHash: null,
    sortOrder: null,
    ...overrides,
  };
}

function makeBook(overrides: Partial<MoveBookData> = {}): MoveBookData {
  const files = overrides.files ?? [makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub' })];
  return {
    bookId: 1,
    status: 'present',
    libraryId: 1,
    libraryFolderId: 11,
    libraryFolderPath: '/libA',
    organizationMode: 'book_per_folder',
    folderPath: '/libA/Frank Herbert/Dune',
    primaryFileId: files[0]?.id ?? null,
    title: 'Dune',
    metadata: {
      title: 'Dune',
      subtitle: null,
      publisher: null,
      language: null,
      isbn13: null,
      publishedYear: null,
      seriesName: null,
      seriesIndex: null,
    },
    authors: ['Frank Herbert'],
    ...overrides,
    files,
  };
}

function makeTarget(overrides: Partial<MoveTargetLibrary> = {}): MoveTargetLibrary {
  return {
    libraryId: 2,
    libraryName: 'Manga',
    organizationMode: 'book_per_folder',
    fileNamingPattern: PATTERN_PER_FOLDER,
    allowedFormats: [],
    folderId: 22,
    folderPath: '/libB',
    watch: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    books: [makeBook()],
    target: makeTarget(),
    pattern: PATTERN_PER_FOLDER,
    sanitizeForCrossPlatform: false,
    folderPathOwners: new Map(),
    filePathOwners: new Map(),
    hashOwners: new Map(),
    ...overrides,
  };
}

function expectReady(outcome: BookMovePlanOutcome) {
  if (outcome.kind !== 'ready') throw new Error(`expected ready outcome, got ${outcome.kind}`);
  return outcome.plan;
}

function expectCollision(outcome: BookMovePlanOutcome) {
  if (outcome.kind !== 'collision') throw new Error(`expected collision outcome, got ${outcome.kind}`);
  return outcome;
}

function expectIneligible(outcome: BookMovePlanOutcome) {
  if (outcome.kind !== 'ineligible') throw new Error(`expected ineligible outcome, got ${outcome.kind}`);
  return outcome;
}

let planner: BookMovePlannerService;

beforeEach(() => {
  planner = new BookMovePlannerService();
});

describe('eligibility', () => {
  it('refuses a book that is not present on disk', () => {
    const [outcome] = planner.plan(makeInput({ books: [makeBook({ status: 'missing' })] }));

    expect(expectIneligible(outcome)).toMatchObject({ reason: 'book_not_present', detail: 'missing' });
  });

  it('refuses a book with no content file', () => {
    const books = [makeBook({ files: [makeFile({ id: 10, absolutePath: '/libA/Dune/cover.jpg', role: 'cover', format: 'jpg' })] })];

    expect(expectIneligible(planner.plan(makeInput({ books }))[0])).toMatchObject({ reason: 'no_content_file' });
  });

  it('reports a book already sitting in the target folder', () => {
    const books = [makeBook({ libraryId: 2, libraryFolderId: 22 })];

    expect(planner.plan(makeInput({ books }))[0]).toMatchObject({ kind: 'already_in_target' });
  });

  it('refuses a multi-file book when the target stores one file per book', () => {
    const books = [
      makeBook({
        files: [makeFile({ id: 10, absolutePath: '/libA/Dune/Dune.epub' }), makeFile({ id: 11, absolutePath: '/libA/Dune/Dune.pdf', format: 'pdf' })],
      }),
    ];

    const outcome = expectIneligible(planner.plan(makeInput({ books, target: makeTarget({ organizationMode: 'book_per_file' }) }))[0]);
    expect(outcome).toMatchObject({ reason: 'multi_file_target_per_file', detail: '2' });
  });

  it('refuses a book whose sidecars cannot exist in a per-file library', () => {
    const books = [
      makeBook({
        files: [
          makeFile({ id: 10, absolutePath: '/libA/Dune/Dune.epub' }),
          makeFile({ id: 11, absolutePath: '/libA/Dune/cover.jpg', role: 'cover', format: 'jpg' }),
        ],
      }),
    ];

    expect(expectIneligible(planner.plan(makeInput({ books, target: makeTarget({ organizationMode: 'book_per_file' }) }))[0])).toMatchObject({
      reason: 'multi_file_target_per_file',
    });
  });

  it('allows a single-file book into a per-file library', () => {
    const books = [makeBook({ files: [makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub' })] })];
    const outcome = planner.plan(
      makeInput({ books, target: makeTarget({ organizationMode: 'book_per_file', fileNamingPattern: PATTERN_PER_FILE }), pattern: PATTERN_PER_FILE }),
    )[0];

    expect(expectReady(outcome).targetPath).toBe('/libB/Frank Herbert/Dune.epub');
  });

  it('refuses when no naming pattern is configured', () => {
    expect(expectIneligible(planner.plan(makeInput({ pattern: null }))[0])).toMatchObject({ reason: 'pattern_unresolved' });
  });
});

describe('cross-mode layout', () => {
  it('wraps a per-file book into its own folder in a per-folder library', () => {
    const books = [
      makeBook({
        organizationMode: 'book_per_file',
        folderPath: '/libA/Dune.epub',
        files: [makeFile({ id: 10, absolutePath: '/libA/Dune.epub' })],
      }),
    ];

    const plan = expectReady(planner.plan(makeInput({ books }))[0]);

    expect(plan.layoutChange).toBe('wrap_into_folder');
    expect(plan.targetPath).toBe('/libB/Frank Herbert/Dune/Dune.epub');
    expect(plan.targetFolderPathKey).toBe('/libB/Frank Herbert/Dune');
  });

  it('dissolves a folder book into a single file in a per-file library', () => {
    const plan = expectReady(
      planner.plan(
        makeInput({
          target: makeTarget({ organizationMode: 'book_per_file', fileNamingPattern: PATTERN_PER_FILE }),
          pattern: PATTERN_PER_FILE,
        }),
      )[0],
    );

    expect(plan.layoutChange).toBe('dissolve_folder');
    expect(plan.targetPath).toBe('/libB/Frank Herbert/Dune.epub');
    // In a per-file library the book's folderPath is the file itself.
    expect(plan.targetFolderPathKey).toBe('/libB/Frank Herbert/Dune.epub');
  });

  it('reports no layout change for same-mode moves', () => {
    expect(expectReady(planner.plan(makeInput())[0]).layoutChange).toBeNull();
  });

  it('keeps sidecars alongside the book when moving between folder libraries', () => {
    const books = [
      makeBook({
        files: [
          makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub' }),
          makeFile({ id: 11, absolutePath: '/libA/Frank Herbert/Dune/cover.jpg', role: 'cover', format: 'jpg' }),
          makeFile({ id: 12, absolutePath: '/libA/Frank Herbert/Dune/metadata.opf', role: 'metadata', format: 'opf' }),
        ],
      }),
    ];

    const plan = expectReady(planner.plan(makeInput({ books }))[0]);

    expect(plan.files.map((file) => file.to)).toEqual([
      '/libB/Frank Herbert/Dune/Dune.epub',
      '/libB/Frank Herbert/Dune/cover.jpg',
      '/libB/Frank Herbert/Dune/metadata.opf',
    ]);
  });

  it('preserves nested disc folders and track names in a multi-track audiobook', () => {
    const books = [
      makeBook({
        files: [
          makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/CD 1/01.mp3', format: 'mp3' }),
          makeFile({ id: 11, absolutePath: '/libA/Frank Herbert/Dune/CD 1/02.mp3', format: 'mp3' }),
          makeFile({ id: 12, absolutePath: '/libA/Frank Herbert/Dune/CD 2/01.mp3', format: 'mp3' }),
        ],
      }),
    ];

    const plan = expectReady(planner.plan(makeInput({ books }))[0]);

    // Track names carry the ordering the scanner sorts on, so only the primary
    // file is renamed to the target pattern.
    expect(plan.files.map((file) => file.to)).toEqual([
      '/libB/Frank Herbert/Dune/Dune.mp3',
      '/libB/Frank Herbert/Dune/CD 1/02.mp3',
      '/libB/Frank Herbert/Dune/CD 2/01.mp3',
    ]);
  });

  it('keeps a second format under its own name', () => {
    const books = [
      makeBook({
        files: [
          makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub' }),
          makeFile({ id: 11, absolutePath: '/libA/Frank Herbert/Dune/Dune.pdf', format: 'pdf' }),
        ],
      }),
    ];

    const plan = expectReady(planner.plan(makeInput({ books }))[0]);

    expect(plan.files.map((file) => file.to)).toEqual(['/libB/Frank Herbert/Dune/Dune.epub', '/libB/Frank Herbert/Dune/Dune.pdf']);
  });
});

describe('collisions', () => {
  it('flags a folder already owned by another book in the target library', () => {
    const outcome = expectCollision(planner.plan(makeInput({ folderPathOwners: new Map([['/libB/Frank Herbert/Dune', 99]]) }))[0]);

    expect(outcome.collision).toMatchObject({ kind: 'folder_path', existingBookId: 99, suggestedPolicy: 'keep_both' });
    expect(outcome.collision.keepBothPlan.targetFolderPathKey).toBe('/libB/Frank Herbert/Dune (2)');
    expect(outcome.collision.keepBothPlan.targetPath).toBe('/libB/Frank Herbert/Dune (2)/Dune.epub');
  });

  it('flags a file path already owned anywhere, since the index is global', () => {
    const outcome = expectCollision(planner.plan(makeInput({ filePathOwners: new Map([['/libB/Frank Herbert/Dune/Dune.epub', 77]]) }))[0]);

    expect(outcome.collision).toMatchObject({ kind: 'file_path', existingBookId: 77 });
  });

  it('suggests merging when identical content already exists in the target', () => {
    const books = [makeBook({ files: [makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub', fileHash: 'abc123' })] })];
    const outcome = expectCollision(planner.plan(makeInput({ books, hashOwners: new Map([['abc123', 55]]) }))[0]);

    expect(outcome.collision).toMatchObject({ kind: 'hash_duplicate', existingBookId: 55, suggestedPolicy: 'merge' });
  });

  it('prefers the merge signal over a plain path clash for the same book', () => {
    const books = [makeBook({ files: [makeFile({ id: 10, absolutePath: '/libA/Frank Herbert/Dune/Dune.epub', fileHash: 'abc123' })] })];
    const outcome = expectCollision(
      planner.plan(
        makeInput({
          books,
          hashOwners: new Map([['abc123', 55]]),
          folderPathOwners: new Map([['/libB/Frank Herbert/Dune', 55]]),
        }),
      )[0],
    );

    expect(outcome.collision.kind).toBe('hash_duplicate');
  });

  it('ignores a hash owned by the book being moved', () => {
    const books = [makeBook({ bookId: 55, files: [makeFile({ id: 10, absolutePath: '/libA/Dune/Dune.epub', fileHash: 'abc123' })] })];

    expect(planner.plan(makeInput({ books, hashOwners: new Map([['abc123', 55]]) }))[0].kind).toBe('ready');
  });

  it('escalates the suffix until a free name is found', () => {
    const outcome = expectCollision(
      planner.plan(
        makeInput({
          folderPathOwners: new Map([
            ['/libB/Frank Herbert/Dune', 91],
            ['/libB/Frank Herbert/Dune (2)', 92],
            ['/libB/Frank Herbert/Dune (3)', 93],
          ]),
        }),
      )[0],
    );

    expect(outcome.collision.keepBothPlan.targetFolderPathKey).toBe('/libB/Frank Herbert/Dune (4)');
  });

  it('suffixes the file itself when the target stores one file per book', () => {
    const outcome = expectCollision(
      planner.plan(
        makeInput({
          target: makeTarget({ organizationMode: 'book_per_file', fileNamingPattern: PATTERN_PER_FILE }),
          pattern: PATTERN_PER_FILE,
          folderPathOwners: new Map([['/libB/Frank Herbert/Dune.epub', 91]]),
        }),
      )[0],
    );

    expect(outcome.collision.keepBothPlan.targetPath).toBe('/libB/Frank Herbert/Dune (2).epub');
  });
});

describe('batch reservations', () => {
  it('treats two books resolving to the same destination as a collision', () => {
    const books = [
      makeBook({ bookId: 1, files: [makeFile({ id: 10, absolutePath: '/libA/one/Dune.epub' })], folderPath: '/libA/one' }),
      makeBook({ bookId: 2, files: [makeFile({ id: 20, absolutePath: '/libA/two/Dune.epub' })], folderPath: '/libA/two' }),
    ];

    const outcomes = planner.plan(makeInput({ books }));

    expect(outcomes[0].kind).toBe('ready');
    const second = expectCollision(outcomes[1]);
    expect(second.collision.existingBookId).toBeNull();
    expect(second.collision.keepBothPlan.targetFolderPathKey).toBe('/libB/Frank Herbert/Dune (2)');
  });

  it('does not hand the same keep-both name to two colliding books', () => {
    const books = [
      makeBook({ bookId: 1, files: [makeFile({ id: 10, absolutePath: '/libA/one/Dune.epub' })], folderPath: '/libA/one' }),
      makeBook({ bookId: 2, files: [makeFile({ id: 20, absolutePath: '/libA/two/Dune.epub' })], folderPath: '/libA/two' }),
      makeBook({ bookId: 3, files: [makeFile({ id: 30, absolutePath: '/libA/three/Dune.epub' })], folderPath: '/libA/three' }),
    ];

    const outcomes = planner.plan(makeInput({ books, folderPathOwners: new Map([['/libB/Frank Herbert/Dune', 99]]) }));

    const chosen = outcomes.map((outcome) => (outcome.kind === 'collision' ? outcome.collision.keepBothPlan.targetFolderPathKey : null));
    expect(new Set(chosen).size).toBe(chosen.length);
    expect(chosen).toEqual(['/libB/Frank Herbert/Dune (2)', '/libB/Frank Herbert/Dune (3)', '/libB/Frank Herbert/Dune (4)']);
  });

  it('treats destinations differing only by case as taken', () => {
    const books = [
      makeBook({
        bookId: 1,
        metadata: { ...makeBook().metadata, title: 'Dune' },
        files: [makeFile({ id: 10, absolutePath: '/libA/one/Dune.epub' })],
        folderPath: '/libA/one',
      }),
      makeBook({
        bookId: 2,
        metadata: { ...makeBook().metadata, title: 'DUNE' },
        files: [makeFile({ id: 20, absolutePath: '/libA/two/DUNE.epub' })],
        folderPath: '/libA/two',
      }),
    ];

    const outcomes = planner.plan(makeInput({ books }));

    expect(outcomes[0].kind).toBe('ready');
    // Postgres would allow both, but a case-insensitive filesystem would not.
    expect(outcomes[1].kind).toBe('collision');
  });
});

describe('path safety', () => {
  it('refuses a destination that escapes the target root', () => {
    const books = [makeBook({ metadata: { ...makeBook().metadata, title: '../../escape' } })];

    const outcome = planner.plan(makeInput({ books }))[0];
    expect(outcome.kind === 'ineligible' || outcome.kind === 'collision').toBe(true);
    if (outcome.kind === 'ineligible') {
      expect(outcome.reason).toBe('path_outside_target_root');
    }
  });

  it('refuses a destination longer than the filesystem limit', () => {
    // The pattern resolver caps each segment, so length is only reachable via a
    // target root that is already close to the limit.
    const deepRoot = `/libB/${'nested/'.repeat(600)}leaf`;
    const outcome = planner.plan(makeInput({ target: makeTarget({ folderPath: deepRoot }) }))[0];

    expect(expectIneligible(outcome).reason).toBe('path_too_long');
  });

  it('truncates an over-long title instead of failing', () => {
    const books = [makeBook({ metadata: { ...makeBook().metadata, title: 'x'.repeat(5000) } })];

    const plan = expectReady(planner.plan(makeInput({ books }))[0]);
    for (const segment of plan.targetPath.split('/')) {
      expect(Buffer.byteLength(segment)).toBeLessThanOrEqual(255);
    }
  });
});

describe('plan shape', () => {
  it('carries the source context the executor needs for rollback and cleanup', () => {
    const plan = expectReady(planner.plan(makeInput())[0]);

    expect(plan).toMatchObject({
      bookId: 1,
      sourceLibraryId: 1,
      sourceLibraryFolderPath: '/libA',
      sourceFolderPath: '/libA/Frank Herbert/Dune',
      sourceHasOwnFolder: true,
      currentPath: '/libA/Frank Herbert/Dune/Dune.epub',
      primaryFormat: 'epub',
    });
  });

  it('marks a root-level per-folder book as not owning its folder', () => {
    const books = [
      makeBook({
        organizationMode: 'book_per_folder',
        folderPath: '/libA/Dune.epub',
        files: [makeFile({ id: 10, absolutePath: '/libA/Dune.epub' })],
      }),
    ];

    expect(expectReady(planner.plan(makeInput({ books }))[0]).sourceHasOwnFolder).toBe(false);
  });

  it('falls back to the filename when the book has no title', () => {
    const books = [
      makeBook({
        title: null,
        metadata: { ...makeBook().metadata, title: null },
        files: [makeFile({ id: 10, absolutePath: '/libA/loose/Some File.epub' })],
      }),
    ];

    expect(planner.plan(makeInput({ books }))[0]).toMatchObject({ kind: 'ready' });
    expect(expectReady(planner.plan(makeInput({ books }))[0]).title).toBe('Some File');
  });
});
