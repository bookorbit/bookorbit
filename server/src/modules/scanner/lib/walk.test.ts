import { mkdir, mkdtemp, rm, writeFile, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { findBookCandidates } from './walk';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scanner-walk-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Helpers
async function dir(...parts: string[]): Promise<string> {
  const p = join(root, ...parts);
  await mkdir(p, { recursive: true });
  return p;
}

async function file(relPath: string, content = 'x'): Promise<string> {
  const p = join(root, relPath);
  await mkdir(join(root, relPath, '..'), { recursive: true });
  await writeFile(p, content);
  return p;
}

function candidatePaths(candidates: Awaited<ReturnType<typeof findBookCandidates>>) {
  return candidates.map((c) => c.folderPath).sort();
}

function filePaths(candidate: Awaited<ReturnType<typeof findBookCandidates>>[0]) {
  return candidate.files.map((f) => f.absolutePath).sort();
}

// ── EMPTY / NO PRIMARIES ──────────────────────────────────────────────────────

describe('empty and non-primary folders', () => {
  it('returns no candidates for an empty library', async () => {
    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(0);
  });

  it('returns no candidates when only non-primary files exist', async () => {
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(0);
  });

  it('skips grouping folders that contain no primaries directly', async () => {
    await file('Author/Book/book.epub');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Author', 'Book'));
  });
});

// ── ROOT-LEVEL FILES ──────────────────────────────────────────────────────────

describe('root-level primary files', () => {
  it('each root-level primary becomes its own candidate with folderPath = absolutePath', async () => {
    await file('book1.epub');
    await file('book2.pdf');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);

    const paths = candidatePaths(candidates);
    expect(paths).toContain(join(root, 'book1.epub'));
    expect(paths).toContain(join(root, 'book2.pdf'));
  });

  it('root-level candidate contains only the primary file', async () => {
    await file('book.epub');
    const candidates = await findBookCandidates(root);
    expect(candidates[0].files).toHaveLength(1);
    expect(candidates[0].files[0].absolutePath).toBe(join(root, 'book.epub'));
  });
});

// ── SINGLE BOOK PER FOLDER ────────────────────────────────────────────────────

describe('single-book folder', () => {
  it('folderPath is the directory, all files are included', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Author', 'Book'));
    expect(candidates[0].files).toHaveLength(3);
  });

  it('multiple formats with the same stem → one candidate', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/book.mobi');
    await file('Author/Book/book.pdf');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(3);
  });

  it('relPath is relative to the library root', async () => {
    await file('Author/Book/book.epub');

    const candidates = await findBookCandidates(root);
    const epubFile = candidates[0].files.find((f) => f.absolutePath.endsWith('book.epub'))!;
    expect(epubFile.relPath).toBe('Author/Book/book.epub');
  });

  it('FileStat fields are populated from the real filesystem', async () => {
    await file('Book/book.epub', 'epub content');

    const candidates = await findBookCandidates(root);
    const f = candidates[0].files[0];
    expect(f.ino).toBeGreaterThan(0);
    expect(f.sizeBytes).toBe('epub content'.length);
    expect(f.mtime).toBeInstanceOf(Date);
  });
});

// ── SERIES FOLDER (MULTIPLE STEMS) ───────────────────────────────────────────

describe('series folder', () => {
  it('creates one candidate per primary stem', async () => {
    await file('Series/book1.epub');
    await file('Series/book2.epub');
    await file('Series/book3.pdf');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(3);
  });

  it('virtual folderPath is join(dir, origStem), preserving original casing', async () => {
    await file('Series/Book1.epub');
    await file('Series/Book2.epub');

    const candidates = await findBookCandidates(root);
    const paths = candidatePaths(candidates);
    expect(paths).toContain(join(root, 'Series', 'Book1'));
    expect(paths).toContain(join(root, 'Series', 'Book2'));
  });

  it('sidecar files are matched to their primary by stem', async () => {
    await file('Series/book1.epub');
    await file('Series/book1.jpg'); // not a cover basename — supplementary matched by stem
    await file('Series/book2.epub');
    await file('Series/book2.jpg');

    const candidates = await findBookCandidates(root);
    const book1 = candidates.find((c) => c.folderPath.endsWith('book1'))!;
    expect(book1).toBeDefined();
    expect(filePaths(book1)).toContain(join(root, 'Series', 'book1.epub'));
    expect(filePaths(book1)).toContain(join(root, 'Series', 'book1.jpg'));

    const book2 = candidates.find((c) => c.folderPath.endsWith('book2'))!;
    expect(filePaths(book2)).not.toContain(join(root, 'Series', 'book1.jpg'));
  });

  it('case-insensitive stem matching links cover.jpg to Book.epub in series folder', async () => {
    await file('Series/Book1.epub');
    await file('Series/book1.jpg'); // lowercase stem matches uppercase primary stem
    await file('Series/Book2.epub');

    const candidates = await findBookCandidates(root);
    const book1 = candidates.find((c) => c.folderPath.endsWith('Book1'))!;
    expect(book1).toBeDefined();
    const paths = filePaths(book1);
    expect(paths).toContain(join(root, 'Series', 'book1.jpg'));
  });

  it('original casing of folderPath is stable across scans (regression guard)', async () => {
    // Ensures the lowercase-for-comparison change does not alter the DB key
    await file('Series/MyBook.epub');
    await file('Series/OtherBook.epub');

    const first = await findBookCandidates(root);
    const second = await findBookCandidates(root);

    const firstPaths = candidatePaths(first);
    const secondPaths = candidatePaths(second);
    expect(firstPaths).toEqual(secondPaths);
    expect(firstPaths).toContain(join(root, 'Series', 'MyBook'));
    expect(firstPaths).toContain(join(root, 'Series', 'OtherBook'));
  });
});

// ── DEEP NESTING ──────────────────────────────────────────────────────────────

describe('deep nesting', () => {
  it('discovers books in arbitrarily deep subdirectories', async () => {
    await file('A/B/C/D/E/book.epub');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'A', 'B', 'C', 'D', 'E'));
  });
});

// ── HIDDEN FILES / FOLDERS ────────────────────────────────────────────────────

describe('hidden files and folders', () => {
  it('skips files starting with a dot', async () => {
    await file('Book/.DS_Store');
    await file('Book/book.epub');

    const candidates = await findBookCandidates(root);
    const f = candidates[0].files;
    expect(f.some((x) => x.absolutePath.includes('.DS_Store'))).toBe(false);
  });

  it('does not recurse into dot-prefixed directories', async () => {
    await file('.calibre/book.epub');
    await file('Book/book.epub');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
  });
});

// ── EXCLUDE PATTERNS ─────────────────────────────────────────────────────────

describe('excludePatterns', () => {
  it('excludes directories matching an exact pattern', async () => {
    await file('#recycle/book.epub');
    await file('Books/book.epub');

    const candidates = await findBookCandidates(root, ['#recycle']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Books'));
  });

  it('excludes files matching a wildcard pattern', async () => {
    await file('Book/book.epub');
    await file('Book/backup.bak');

    const candidates = await findBookCandidates(root, ['*.bak']);
    const files = candidates[0].files;
    expect(files.some((f) => f.absolutePath.endsWith('.bak'))).toBe(false);
    expect(files).toHaveLength(1);
  });

  it('excludes directories matching a wildcard pattern', async () => {
    await file('@eaDir/book.epub');
    await file('Normal/book.epub');

    const candidates = await findBookCandidates(root, ['@*']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Normal'));
  });

  it('returns all candidates when excludePatterns is empty', async () => {
    await file('#recycle/book.epub');
    await file('Books/book.epub');

    const candidates = await findBookCandidates(root, []);
    expect(candidates).toHaveLength(2);
  });

  it('passes logger warnings on permission-denied directories', async () => {
    if (process.getuid?.() === 0) return; // skip when running as root

    await dir('restricted');
    await file('Books/book.epub');

    // Make restricted unreadable
    await chmod(join(root, 'restricted'), 0o000);

    const warnings: string[] = [];
    const candidates = await findBookCandidates(root, [], (msg) => warnings.push(msg));

    // Restore before assert so cleanup works
    await chmod(join(root, 'restricted'), 0o755);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('restricted'))).toBe(true);
    expect(candidates).toHaveLength(1);
  });
});

// ── MULTIPLE LIBRARIES IN SAME SCAN ──────────────────────────────────────────

describe('mixed root structure', () => {
  it('handles root-level files and subdirectory books together', async () => {
    await file('standalone.epub');
    await file('Author/Book/book.epub');

    const candidates = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);
  });
});
