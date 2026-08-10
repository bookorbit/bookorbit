import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

// Cross-device behaviour cannot be provoked with a real temp directory, so rename is
// forced to report EXDEV and the destination read is corrupted on demand.
const control = vi.hoisted(() => ({ forceExdev: false, corruptReadPath: null as string | null }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (control.forceExdev) {
        control.forceExdev = false;
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      }
      return actual.rename(from, to);
    },
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    createReadStream: (path: string, options?: unknown) => {
      if (control.corruptReadPath !== null && path === control.corruptReadPath) {
        return Readable.from([Buffer.from('bytes that do not match the source')]);
      }
      return (actual.createReadStream as (p: string, o?: unknown) => unknown)(path, options);
    },
  };
});

import {
  buildSuppressionPaths,
  computeContentHash,
  isCrossDeviceError,
  isInsideRoot,
  moveFile,
  moveFileBack,
  pathExists,
  removeEmptyDirs,
  withCollisionSuffix,
} from './book-move.utils';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'bookorbit-move-utils-'));
  control.forceExdev = false;
  control.corruptReadPath = null;
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('isInsideRoot', () => {
  it('accepts descendants of the root', () => {
    expect(isInsideRoot('/library', '/library/author/book.epub')).toBe(true);
    expect(isInsideRoot('/library/', '/library/book.epub')).toBe(true);
  });

  it('rejects the root itself, siblings, and traversal', () => {
    expect(isInsideRoot('/library', '/library')).toBe(false);
    expect(isInsideRoot('/library', '/library-other/book.epub')).toBe(false);
    expect(isInsideRoot('/library', '/library/../etc/passwd')).toBe(false);
    expect(isInsideRoot('/library', '/etc/passwd')).toBe(false);
  });
});

describe('withCollisionSuffix', () => {
  it('inserts the suffix before a file extension', () => {
    expect(withCollisionSuffix('/lib/Author/Dune.epub', 2, '.epub')).toBe('/lib/Author/Dune (2).epub');
  });

  it('appends to a directory name when there is no extension', () => {
    expect(withCollisionSuffix('/lib/Author/Dune', 3, '')).toBe('/lib/Author/Dune (3)');
  });

  it('matches the extension case-insensitively', () => {
    expect(withCollisionSuffix('/lib/Dune.EPUB', 2, '.epub')).toBe('/lib/Dune (2).EPUB');
  });

  it('leaves dots inside the stem alone', () => {
    expect(withCollisionSuffix('/lib/Vol.1.epub', 2, '.epub')).toBe('/lib/Vol.1 (2).epub');
  });
});

describe('moveFile', () => {
  it('moves a file and reports the destination stat', async () => {
    const from = join(workDir, 'src', 'book.epub');
    const to = join(workDir, 'dst', 'nested', 'book.epub');
    await mkdir(join(workDir, 'src'), { recursive: true });
    await writeFile(from, 'contents');

    const before = await stat(from, { bigint: true });
    const result = await moveFile(from, to);

    expect(result.crossDevice).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('contents');
    expect(await pathExists(from)).toBe(false);
    // A same-device rename keeps the inode, which is what the watcher matches on.
    expect(result.stat.ino).toBe(before.ino);
    expect(result.stat.sizeBytes).toBe(8);
  });

  it('creates missing destination directories', async () => {
    const from = join(workDir, 'book.epub');
    const to = join(workDir, 'a', 'b', 'c', 'book.epub');
    await writeFile(from, 'x');

    await moveFile(from, to);

    expect(await pathExists(to)).toBe(true);
  });

  it('falls back to copy and delete when rename reports EXDEV', async () => {
    const from = join(workDir, 'book.epub');
    const to = join(workDir, 'dst', 'book.epub');
    await writeFile(from, 'cross device payload');
    control.forceExdev = true;

    const result = await moveFile(from, to);

    expect(result.crossDevice).toBe(true);
    expect(await readFile(to, 'utf8')).toBe('cross device payload');
    expect(await pathExists(from)).toBe(false);
    expect(result.stat.sizeBytes).toBe('cross device payload'.length);
  });

  it('keeps the source and removes the partial copy when verification fails', async () => {
    const from = join(workDir, 'book.epub');
    const to = join(workDir, 'dst', 'book.epub');
    await writeFile(from, 'original payload');
    control.forceExdev = true;
    control.corruptReadPath = to;

    await expect(moveFile(from, to)).rejects.toThrow(/verification failed/i);

    // The source is the only good copy at that point and must survive.
    expect(await pathExists(from)).toBe(true);
    expect(await readFile(from, 'utf8')).toBe('original payload');
    expect(await pathExists(to)).toBe(false);
  });

  it('propagates non-EXDEV rename failures without copying', async () => {
    const from = join(workDir, 'missing.epub');
    const to = join(workDir, 'dst', 'missing.epub');

    await expect(moveFile(from, to)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await pathExists(to)).toBe(false);
  });
});

describe('moveFileBack', () => {
  it('restores a file to its original path', async () => {
    const original = join(workDir, 'src', 'book.epub');
    const moved = join(workDir, 'dst', 'book.epub');
    await mkdir(join(workDir, 'dst'), { recursive: true });
    await writeFile(moved, 'payload');

    await moveFileBack(moved, original);

    expect(await readFile(original, 'utf8')).toBe('payload');
    expect(await pathExists(moved)).toBe(false);
  });
});

describe('removeEmptyDirs', () => {
  it('removes an empty book folder and its now-empty parent', async () => {
    const root = join(workDir, 'library');
    const bookDir = join(root, 'Author', 'Book');
    await mkdir(bookDir, { recursive: true });

    await removeEmptyDirs(bookDir, root);

    expect(await pathExists(bookDir)).toBe(false);
    expect(await pathExists(join(root, 'Author'))).toBe(false);
    expect(await pathExists(root)).toBe(true);
  });

  it('stops at a directory that still has files', async () => {
    const root = join(workDir, 'library');
    const bookDir = join(root, 'Author', 'Book');
    await mkdir(bookDir, { recursive: true });
    await writeFile(join(root, 'Author', 'keep.txt'), 'x');

    await removeEmptyDirs(bookDir, root);

    expect(await pathExists(bookDir)).toBe(false);
    expect(await pathExists(join(root, 'Author'))).toBe(true);
  });

  it('never removes the library root itself', async () => {
    const root = join(workDir, 'library');
    await mkdir(root, { recursive: true });

    await removeEmptyDirs(root, root);

    expect(await pathExists(root)).toBe(true);
  });

  it('does not climb outside the library root', async () => {
    const root = join(workDir, 'library');
    const bookDir = join(root, 'Book');
    await mkdir(bookDir, { recursive: true });

    await removeEmptyDirs(bookDir, root);

    expect(await pathExists(root)).toBe(true);
    expect(await readdir(workDir)).toContain('library');
  });
});

describe('buildSuppressionPaths', () => {
  it('covers both library roots with every ancestor directory', () => {
    const paths = buildSuppressionPaths({
      sourcePaths: ['/libA/Author/Book/book.epub'],
      targetPaths: ['/libB/Other/Book/book.epub'],
      sourceFolderPath: '/libA/Author/Book',
      targetFolderPath: '/libB/Other/Book',
      roots: ['/libA', '/libB'],
    });

    expect(paths).toEqual(
      expect.arrayContaining([
        '/libA/Author/Book/book.epub',
        '/libA/Author/Book',
        '/libA/Author',
        '/libB/Other/Book/book.epub',
        '/libB/Other/Book',
        '/libB/Other',
      ]),
    );
  });

  it('excludes the roots themselves and anything outside them', () => {
    const paths = buildSuppressionPaths({
      sourcePaths: ['/libA/book.epub', '/elsewhere/book.epub'],
      targetPaths: ['/libB/book.epub'],
      sourceFolderPath: '/libA/book.epub',
      targetFolderPath: '/libB/book.epub',
      roots: ['/libA', '/libB'],
    });

    expect(paths).not.toContain('/libA');
    expect(paths).not.toContain('/libB');
    expect(paths).not.toContain('/elsewhere/book.epub');
    expect(paths).toContain('/libA/book.epub');
    expect(paths).toContain('/libB/book.epub');
  });

  it('deduplicates shared ancestors', () => {
    const paths = buildSuppressionPaths({
      sourcePaths: ['/lib/Author/a.epub', '/lib/Author/b.epub'],
      targetPaths: [],
      sourceFolderPath: '/lib/Author',
      targetFolderPath: '/lib/Author',
      roots: ['/lib'],
    });

    expect(paths.filter((path) => path === '/lib/Author')).toHaveLength(1);
  });
});

describe('computeContentHash', () => {
  it('distinguishes files that differ only late in the stream', async () => {
    const filler = 'a'.repeat(200_000);
    const first = join(workDir, 'first.bin');
    const second = join(workDir, 'second.bin');
    await writeFile(first, `${filler}TAIL-ONE`);
    await writeFile(second, `${filler}TAIL-TWO`);

    // The scanner's sampled hash can miss tail-only differences; verification must not.
    expect(await computeContentHash(first)).not.toBe(await computeContentHash(second));
  });

  it('is stable for identical content', async () => {
    const first = join(workDir, 'a.bin');
    const second = join(workDir, 'b.bin');
    await writeFile(first, 'same bytes');
    await writeFile(second, 'same bytes');

    expect(await computeContentHash(first)).toBe(await computeContentHash(second));
  });
});

describe('isCrossDeviceError', () => {
  it('detects EXDEV only', () => {
    expect(isCrossDeviceError(Object.assign(new Error('x'), { code: 'EXDEV' }))).toBe(true);
    expect(isCrossDeviceError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
    expect(isCrossDeviceError(new Error('x'))).toBe(false);
    expect(isCrossDeviceError(null)).toBe(false);
  });
});
