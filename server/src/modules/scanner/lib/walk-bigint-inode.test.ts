/** Integration tests for exact inode handling across scanner walk entry points. */

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, stat: vi.fn() };
});

import { stat } from 'fs/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { MockedFunction } from 'vitest';

import { findBookCandidates, findLooseFileCandidates, buildSingleBookCandidate } from './walk';

const mockStat = stat as MockedFunction<typeof stat>;

// Real stat from fs/promises (before the mock replaces it) is not directly accessible here,
// so we keep FS setup minimal and return fully-shaped mocks.
function makeBigIntStatsMock(ino: bigint, size = 100n): import('fs').BigIntStats {
  return {
    ino,
    size,
    mtime: new Date('2024-01-01T00:00:00Z'),
    atime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    atimeMs: 0n,
    mtimeMs: BigInt(new Date('2024-01-01T00:00:00Z').getTime()),
    ctimeMs: 0n,
    birthtimeMs: 0n,
    blksize: 4096n,
    blocks: 8n,
    dev: 0n,
    gid: 0n,
    mode: 0o100644n,
    nlink: 1n,
    rdev: 0n,
    uid: 0n,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as import('fs').BigIntStats;
}

function makeDirStatsMock(): import('fs').Stats {
  return {
    mtimeMs: Date.now(),
    isFile: () => false,
    isDirectory: () => true,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as import('fs').Stats;
}

const OVERSIZED_INO = 17237992710316634000n; // exact value from the bug report
const UNSAFE_INO = 651896050678335552n; // issue #84: within int8 range but above Number.MAX_SAFE_INTEGER
const NORMAL_INO = 12345n;

let suiteRoot: string;
let root: string;
let caseId = 0;

beforeAll(async () => {
  suiteRoot = await mkdtemp(join(tmpdir(), 'walk-ino-clamp-'));
});

beforeEach(async () => {
  root = join(suiteRoot, `case-${caseId++}`);
  await mkdir(root, { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterAll(async () => {
  await rm(suiteRoot, { recursive: true, force: true });
});

async function touchFile(relPath: string): Promise<string> {
  const p = join(root, relPath);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, 'x');
  return p;
}

// Configure the stat mock: return BigIntStats (with given ino) for file calls,
// and a Stats-like object (for dir mtime tracking) for directory calls.
function setupStatMock(fileIno: bigint): void {
  mockStat.mockImplementation((filePath: unknown, opts?: unknown) => {
    if ((opts as { bigint?: boolean } | undefined)?.bigint === true) {
      return Promise.resolve(makeBigIntStatsMock(fileIno));
    }
    return Promise.resolve(makeDirStatsMock());
  });
}

// ── findBookCandidates ────────────────────────────────────────────────────────

describe('findBookCandidates - exact MergerFS inode', () => {
  it('preserves an inode above the JavaScript safe integer range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(UNSAFE_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files[0].ino).toBe(UNSAFE_INO);
  });

  it('preserves an unsigned inode exceeding the PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files[0].ino).toBe(OVERSIZED_INO);
  });

  it('does not warn when an unsigned 64-bit inode can be matched exactly', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const warnings: string[] = [];
    await findBookCandidates(root, [], (msg) => warnings.push(msg));

    expect(warnings).toHaveLength(0);
  });

  it('preserves normal inodes that are within PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(NORMAL_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(NORMAL_INO);
  });

  it('preserves the PostgreSQL bigint maximum inode exactly', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(9223372036854775807n);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(9223372036854775807n);
  });

  it('does not emit a warning for normal inodes', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(NORMAL_INO);

    const warnings: string[] = [];
    await findBookCandidates(root, [], (msg) => warnings.push(msg));

    expect(warnings).toHaveLength(0);
  });

  it('still discovers books correctly even when all inodes are oversized', async () => {
    await touchFile('AuthorA/Book1/book.epub');
    await touchFile('AuthorB/Book2/book.epub');
    setupStatMock(OVERSIZED_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates).toHaveLength(2);
    for (const c of candidates) {
      expect(c.files[0].ino).toBe(OVERSIZED_INO);
    }
  });

  it('preserves the maximum possible unsigned 64-bit inode', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(18446744073709551615n);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(18446744073709551615n);
  });

  it('preserves negative inode values reported by a mounted filesystem', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(-8537732241968812306n);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(-8537732241968812306n);
  });
});

// ── findLooseFileCandidates ───────────────────────────────────────────────────

describe('findLooseFileCandidates - exact MergerFS inode', () => {
  it('preserves oversized inodes in book_per_file mode', async () => {
    await touchFile('book.epub');
    setupStatMock(OVERSIZED_INO);

    const { candidates } = await findLooseFileCandidates(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files[0].ino).toBe(OVERSIZED_INO);
  });

  it('passes normal inodes through in book_per_file mode', async () => {
    await touchFile('book.epub');
    setupStatMock(NORMAL_INO);

    const { candidates } = await findLooseFileCandidates(root);

    expect(candidates[0].files[0].ino).toBe(NORMAL_INO);
  });
});

// ── buildSingleBookCandidate ──────────────────────────────────────────────────

describe('buildSingleBookCandidate - exact MergerFS inode', () => {
  it('preserves an inode exceeding the PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result).not.toBeNull();
    expect(result!.files[0].ino).toBe(OVERSIZED_INO);
  });

  it('does not warn for an exact unsigned 64-bit inode', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const warnings: string[] = [];
    await buildSingleBookCandidate(join(root, 'Book'), root, [], (msg) => warnings.push(msg));

    expect(warnings).toHaveLength(0);
  });

  it('passes normal inodes through unchanged', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(NORMAL_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result!.files[0].ino).toBe(NORMAL_INO);
  });

  it('still returns correct folderPath and file list with oversized inodes', async () => {
    await touchFile('Book/book.epub');
    await touchFile('Book/cover.jpg');
    setupStatMock(OVERSIZED_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result).not.toBeNull();
    expect(result!.folderPath).toBe(join(root, 'Book'));
    expect(result!.files).toHaveLength(2);
    expect(result!.files.every((f) => f.ino === OVERSIZED_INO)).toBe(true);
  });
});
