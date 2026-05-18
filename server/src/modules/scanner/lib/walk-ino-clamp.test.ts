/**
 * Integration tests verifying that oversized MergerFS inodes are clamped before storage.
 *
 * These tests mock `fs/promises.stat` to inject synthetic BigInt inode values that would
 * otherwise overflow PostgreSQL's bigint column and crash the scanner.
 */

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
const NORMAL_INO = 12345n;
const PG_BIGINT_MAX_INO = 9223372036854775807n;

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

describe('findBookCandidates — oversized MergerFS inode', () => {
  it('sets ino=0 when stat returns an inode exceeding PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files[0].ino).toBe(0);
  });

  it('emits a logger warning that mentions the oversized inode value', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const warnings: string[] = [];
    await findBookCandidates(root, [], (msg) => warnings.push(msg));

    expect(warnings.some((w) => w.includes(String(OVERSIZED_INO)))).toBe(true);
    expect(warnings.some((w) => w.includes('rename detection disabled'))).toBe(true);
  });

  it('preserves normal inodes that are within PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(NORMAL_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(Number(NORMAL_INO));
  });

  it('preserves the PostgreSQL bigint maximum inode without clamping', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(PG_BIGINT_MAX_INO);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).not.toBe(0);
    expect(candidates[0].files[0].ino).toBeGreaterThan(0);
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
      expect(c.files[0].ino).toBe(0);
    }
  });

  it('sets ino=0 for the maximum possible unsigned 64-bit inode', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(18446744073709551615n);

    const { candidates } = await findBookCandidates(root);

    expect(candidates[0].files[0].ino).toBe(0);
  });
});

// ── findLooseFileCandidates ───────────────────────────────────────────────────

describe('findLooseFileCandidates — oversized MergerFS inode', () => {
  it('sets ino=0 for oversized inodes in book_per_file mode', async () => {
    await touchFile('book.epub');
    setupStatMock(OVERSIZED_INO);

    const { candidates } = await findLooseFileCandidates(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files[0].ino).toBe(0);
  });

  it('passes normal inodes through in book_per_file mode', async () => {
    await touchFile('book.epub');
    setupStatMock(NORMAL_INO);

    const { candidates } = await findLooseFileCandidates(root);

    expect(candidates[0].files[0].ino).toBe(Number(NORMAL_INO));
  });
});

// ── buildSingleBookCandidate ──────────────────────────────────────────────────

describe('buildSingleBookCandidate — oversized MergerFS inode', () => {
  it('sets ino=0 when stat returns an inode exceeding PostgreSQL bigint range', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result).not.toBeNull();
    expect(result!.files[0].ino).toBe(0);
  });

  it('emits a logger warning for oversized inodes', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(OVERSIZED_INO);

    const warnings: string[] = [];
    await buildSingleBookCandidate(join(root, 'Book'), root, [], (msg) => warnings.push(msg));

    expect(warnings.some((w) => w.includes(String(OVERSIZED_INO)))).toBe(true);
    expect(warnings.some((w) => w.includes('rename detection disabled'))).toBe(true);
  });

  it('passes normal inodes through unchanged', async () => {
    await touchFile('Book/book.epub');
    setupStatMock(NORMAL_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result!.files[0].ino).toBe(Number(NORMAL_INO));
  });

  it('still returns correct folderPath and file list with oversized inodes', async () => {
    await touchFile('Book/book.epub');
    await touchFile('Book/cover.jpg');
    setupStatMock(OVERSIZED_INO);

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);

    expect(result).not.toBeNull();
    expect(result!.folderPath).toBe(join(root, 'Book'));
    expect(result!.files).toHaveLength(2);
    expect(result!.files.every((f) => f.ino === 0)).toBe(true);
  });
});
