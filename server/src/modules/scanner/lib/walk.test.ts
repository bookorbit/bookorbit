import { mkdir, mkdtemp, rm, writeFile, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { findBookCandidates, buildSingleBookCandidate, findLooseFileCandidates, clampIno, BookCandidate } from './walk';

let suiteRoot: string;
let root: string;
let caseId = 0;

beforeAll(async () => {
  suiteRoot = await mkdtemp(join(tmpdir(), 'scanner-walk-suite-'));
});

beforeEach(async () => {
  root = join(suiteRoot, `case-${caseId++}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(suiteRoot, { recursive: true, force: true });
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

function candidatePaths(candidates: BookCandidate[]) {
  return candidates.map((c) => c.folderPath).sort();
}

function filePaths(candidate: BookCandidate) {
  return candidate.files.map((f) => f.absolutePath).sort();
}

// ── EMPTY / NO PRIMARIES ──────────────────────────────────────────────────────

describe('empty and non-primary folders', () => {
  it('returns no candidates for an empty library', async () => {
    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(0);
  });

  it('returns no candidates when only non-primary files exist', async () => {
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(0);
  });

  it('skips grouping folders that contain no primaries directly', async () => {
    await file('Author/Book/book.epub');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Author', 'Book'));
  });
});

// ── ROOT-LEVEL FILES ──────────────────────────────────────────────────────────

describe('root-level primary files', () => {
  it('each root-level primary becomes its own candidate with folderPath = absolutePath', async () => {
    await file('book1.epub');
    await file('book2.pdf');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);

    const paths = candidatePaths(candidates);
    expect(paths).toContain(join(root, 'book1.epub'));
    expect(paths).toContain(join(root, 'book2.pdf'));
  });

  it('root-level candidate contains only the primary file when no sidecars share its stem', async () => {
    await file('book.epub');
    const { candidates } = await findBookCandidates(root);
    expect(candidates[0].files).toHaveLength(1);
    expect(candidates[0].files[0].absolutePath).toBe(join(root, 'book.epub'));
  });

  it('root-level candidate includes sidecar files that share its stem', async () => {
    await file('book.epub');
    await file('book.opf');
    await file('book.jpg');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    const paths = candidates[0].files.map((f) => f.absolutePath).sort();
    expect(paths).toEqual([join(root, 'book.epub'), join(root, 'book.jpg'), join(root, 'book.opf')]);
  });

  it('root-level: each primary pulls in only sidecars with its own stem', async () => {
    await file('A.epub');
    await file('A.opf');
    await file('B.epub');
    await file('B.jpg');
    await file('orphan.txt');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);
    const byPrimary = new Map(candidates.map((c) => [c.folderPath, c.files.map((f) => f.absolutePath).sort()]));
    expect(byPrimary.get(join(root, 'A.epub'))).toEqual([join(root, 'A.epub'), join(root, 'A.opf')]);
    expect(byPrimary.get(join(root, 'B.epub'))).toEqual([join(root, 'B.epub'), join(root, 'B.jpg')]);
  });
});

// ── SINGLE BOOK PER FOLDER ────────────────────────────────────────────────────

describe('single-book folder', () => {
  it('folderPath is the directory, all files are included', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Author', 'Book'));
    expect(candidates[0].files).toHaveLength(3);
  });

  it('multiple formats with the same stem → one candidate', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/book.mobi');
    await file('Author/Book/book.pdf');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(3);
  });

  it('relPath is relative to the library root', async () => {
    await file('Author/Book/book.epub');

    const { candidates } = await findBookCandidates(root);
    const epubFile = candidates[0].files.find((f) => f.absolutePath.endsWith('book.epub'))!;
    expect(epubFile.relPath).toBe('Author/Book/book.epub');
  });

  it('FileStat fields are populated from the real filesystem', async () => {
    await file('Book/book.epub', 'epub content');

    const { candidates } = await findBookCandidates(root);
    const f = candidates[0].files[0];
    expect(f.ino).toBeGreaterThan(0);
    expect(f.sizeBytes).toBe('epub content'.length);
    expect(f.mtime).toBeInstanceOf(Date);
  });
});

// ── SERIES FOLDER (MULTIPLE STEMS) ───────────────────────────────────────────

describe('series folder', () => {
  it('multiple primary files in one folder produce a single candidate', async () => {
    await file('Series/book1.epub');
    await file('Series/book2.epub');
    await file('Series/book3.pdf');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Series'));
  });

  it('all primary and sidecar files are bundled into the single candidate', async () => {
    await file('Series/book1.epub');
    await file('Series/book1.jpg');
    await file('Series/book2.epub');
    await file('Series/book2.jpg');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    const paths = filePaths(candidates[0]);
    expect(paths).toContain(join(root, 'Series', 'book1.epub'));
    expect(paths).toContain(join(root, 'Series', 'book1.jpg'));
    expect(paths).toContain(join(root, 'Series', 'book2.epub'));
    expect(paths).toContain(join(root, 'Series', 'book2.jpg'));
  });

  it('folderPath is the real directory path, stable across scans', async () => {
    await file('Series/MyBook.epub');
    await file('Series/OtherBook.epub');

    const { candidates: first } = await findBookCandidates(root);
    const { candidates: second } = await findBookCandidates(root);

    expect(candidatePaths(first)).toEqual(candidatePaths(second));
    expect(candidatePaths(first)).toEqual([join(root, 'Series')]);
  });
});

// ── DEEP NESTING ──────────────────────────────────────────────────────────────

describe('deep nesting', () => {
  it('discovers books in arbitrarily deep subdirectories', async () => {
    await file('A/B/C/D/E/book.epub');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'A', 'B', 'C', 'D', 'E'));
  });
});

// ── HIDDEN FILES / FOLDERS ────────────────────────────────────────────────────

describe('hidden files and folders', () => {
  it('skips files starting with a dot', async () => {
    await file('Book/.DS_Store');
    await file('Book/book.epub');

    const { candidates } = await findBookCandidates(root);
    const f = candidates[0].files;
    expect(f.some((x) => x.absolutePath.includes('.DS_Store'))).toBe(false);
  });

  it('does not recurse into dot-prefixed directories', async () => {
    await file('.calibre/book.epub');
    await file('Book/book.epub');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
  });
});

// ── EXCLUDE PATTERNS ─────────────────────────────────────────────────────────

describe('excludePatterns', () => {
  it('excludes directories matching an exact pattern', async () => {
    await file('#recycle/book.epub');
    await file('Books/book.epub');

    const { candidates } = await findBookCandidates(root, ['#recycle']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Books'));
  });

  it('excludes files matching a wildcard pattern', async () => {
    await file('Book/book.epub');
    await file('Book/backup.bak');

    const { candidates } = await findBookCandidates(root, ['*.bak']);
    const files = candidates[0].files;
    expect(files.some((f) => f.absolutePath.endsWith('.bak'))).toBe(false);
    expect(files).toHaveLength(1);
  });

  it('excludes directories matching a wildcard pattern', async () => {
    await file('@eaDir/book.epub');
    await file('Normal/book.epub');

    const { candidates } = await findBookCandidates(root, ['@*']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Normal'));
  });

  it('returns all candidates when excludePatterns is empty', async () => {
    await file('#recycle/book.epub');
    await file('Books/book.epub');

    const { candidates } = await findBookCandidates(root, []);
    expect(candidates).toHaveLength(2);
  });

  it('passes logger warnings on permission-denied directories', async () => {
    if (process.getuid?.() === 0) return; // skip when running as root

    await dir('restricted');
    await file('Books/book.epub');

    // Make restricted unreadable
    await chmod(join(root, 'restricted'), 0o000);

    const warnings: string[] = [];
    const { candidates } = await findBookCandidates(root, [], (msg) => warnings.push(msg));

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

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);
  });
});

// ── AUDIO FOLDER GROUPING ─────────────────────────────────────────────────────

describe('audio folder — single candidate', () => {
  it('treats a folder with only MP3 files as one audiobook', async () => {
    await file('Book/chapter-01.mp3');
    await file('Book/chapter-02.mp3');
    await file('Book/chapter-03.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
  });

  it('includes all files (primary + non-primary) in the audio candidate', async () => {
    await file('Book/chapter-01.mp3');
    await file('Book/cover.jpg');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    const paths = filePaths(candidates[0]);
    expect(paths).toContain(join(root, 'Book', 'chapter-01.mp3'));
    expect(paths).toContain(join(root, 'Book', 'cover.jpg'));
  });

  it('natural-sorts audio files by basename', async () => {
    await file('Book/track-10.mp3');
    await file('Book/track-2.mp3');
    await file('Book/track-1.mp3');

    const { candidates } = await findBookCandidates(root);
    const paths = candidates[0].files.map((f) => f.absolutePath);
    expect(paths).toEqual([join(root, 'Book', 'track-1.mp3'), join(root, 'Book', 'track-2.mp3'), join(root, 'Book', 'track-10.mp3')]);
  });

  it('treats an m4b file as a single audio candidate', async () => {
    await file('Book/book.m4b');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
  });
});

describe('mixed epub + audio folder', () => {
  it('treats a folder with epub AND mp3 as one book (audio branch)', async () => {
    await file('Book/book.epub');
    await file('Book/chapter-01.mp3');
    await file('Book/chapter-02.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
  });
});

// ── DISC FOLDER FLATTENING ────────────────────────────────────────────────────

describe('disc folder flattening', () => {
  it('flattens "CD 1" subdir files into parent and produces one candidate', async () => {
    await file('Book/CD 1/chapter-01.mp3');
    await file('Book/CD 1/chapter-02.mp3');
    await file('Book/CD 2/chapter-03.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Book'));
    expect(candidates[0].files).toHaveLength(3);
  });

  it('flattens Disc, Disk, Part, Side patterns', async () => {
    await file('MultiDisc/Disc 1/track-01.mp3');
    await file('MultiDisc/Disk 2/track-02.mp3');
    await file('MultiDisc/Part 3/track-03.mp3');
    await file('MultiDisc/Side A/track-04.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(4);
  });

  it('does NOT flatten directories that do not match the disc pattern', async () => {
    await file('Library/BookA/chapter-01.mp3');
    await file('Library/BookB/chapter-01.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);
  });

  it('does NOT treat names like "Discography" as disc directories', async () => {
    await file('AudioBook/Discography/01.mp3');
    await file('AudioBook/cover.jpg');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'AudioBook', 'Discography'));
  });
});

// ── STEM-NAMED AUDIO SUBFOLDER FLATTENING ────────────────────────────────────

describe('stem-named audio subfolder flattening', () => {
  it('merges audio subfolder into parent when subfolder name matches sibling file stem', async () => {
    await file('The Three-Body Problem/The Three-Body Problem (Liu Cixin).epub');
    await file('The Three-Body Problem/The Three-Body Problem (Liu Cixin).mobi');
    await file('The Three-Body Problem/The Three-Body Problem (Liu Cixin)/01-chapter.mp3');
    await file('The Three-Body Problem/The Three-Body Problem (Liu Cixin)/02-chapter.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'The Three-Body Problem'));
    const paths = candidates[0].files.map((f) => f.absolutePath);
    expect(paths).toContain(join(root, 'The Three-Body Problem', 'The Three-Body Problem (Liu Cixin).epub'));
    expect(paths).toContain(join(root, 'The Three-Body Problem', 'The Three-Body Problem (Liu Cixin)', '01-chapter.mp3'));
  });

  it('does not flatten a subfolder whose name does not match any sibling stem', async () => {
    await file('Series/Book1.epub');
    await file('Series/AudioStuff/track-01.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(2);
  });

  it('does not flatten a stem-named subfolder when the parent is the library root', async () => {
    await file('BookTitle.epub');
    await file('BookTitle/01.mp3');
    await file('BookTitle/02.mp3');

    const { candidates } = await findBookCandidates(root);
    // BookTitle.epub is a root-level file (its own candidate); BookTitle/ is a separate audiobook
    expect(candidates).toHaveLength(2);
  });

  it('still produces one candidate when the parent already only has same-stem ebooks', async () => {
    await file('Book/book.epub');
    await file('Book/book.mobi');
    await file('Book/book/01.mp3');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(3);
  });
});

// ── EBOOK STEM GROUPING UNCHANGED BY AUDIO CHANGES ───────────────────────────

describe('ebook stem grouping — unaffected by audio support', () => {
  it('still groups epub + mobi with same stem as one book', async () => {
    await file('Book/book.epub');
    await file('Book/book.mobi');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
  });

  it('different stems in one folder still produce a single candidate', async () => {
    await file('Series/BookOne.epub');
    await file('Series/BookTwo.epub');

    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'Series'));
  });
});

// ── buildSingleBookCandidate ───────────────────────────────────────────────────

describe('buildSingleBookCandidate', () => {
  it('returns null for a folder with no primary-format files', async () => {
    await file('Book/cover.jpg');
    await file('Book/book.opf');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    expect(result).toBeNull();
  });

  it('returns null when the folder does not exist', async () => {
    const result = await buildSingleBookCandidate(join(root, 'nonexistent'), root);
    expect(result).toBeNull();
  });

  it('returns one candidate with folderPath equal to the book folder', async () => {
    await file('Book/book.epub');
    await file('Book/book.mobi');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    expect(result).not.toBeNull();
    expect(result!.folderPath).toBe(join(root, 'Book'));
  });

  it('bundles all files (primary + sidecar) into the single candidate', async () => {
    await file('Book/book.epub');
    await file('Book/book.mobi');
    await file('Book/cover.jpg');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    const paths = result!.files.map((f) => f.absolutePath).sort();
    expect(paths).toContain(join(root, 'Book', 'book.epub'));
    expect(paths).toContain(join(root, 'Book', 'book.mobi'));
    expect(paths).toContain(join(root, 'Book', 'cover.jpg'));
    expect(result!.files).toHaveLength(3);
  });

  it('bundles all files even when stems differ (no stem-split)', async () => {
    await file('Book/TitleOne.epub');
    await file('Book/TitleTwo.epub');
    await file('Book/TitleThree.mobi');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    expect(result!.folderPath).toBe(join(root, 'Book'));
    expect(result!.files).toHaveLength(3);
  });

  it('relPath is relative to libraryFolderPath, not to bookFolderPath', async () => {
    await file('Author/Book/book.epub');

    const result = await buildSingleBookCandidate(join(root, 'Author', 'Book'), root);
    expect(result!.files[0].relPath).toBe(join('Author', 'Book', 'book.epub'));
  });

  it('flattens disc subdirectories into the candidate', async () => {
    await file('Book/CD 1/chapter-01.mp3');
    await file('Book/CD 2/chapter-02.mp3');
    await file('Book/cover.jpg');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    const paths = result!.files.map((f) => f.absolutePath);
    expect(paths).toContain(join(root, 'Book', 'CD 1', 'chapter-01.mp3'));
    expect(paths).toContain(join(root, 'Book', 'CD 2', 'chapter-02.mp3'));
    expect(paths).toContain(join(root, 'Book', 'cover.jpg'));
  });

  it('does not recurse into non-disc, non-stem subdirectories', async () => {
    await file('Book/book.epub');
    await file('Book/Extras/bonus.epub');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    const paths = result!.files.map((f) => f.absolutePath);
    expect(paths).toContain(join(root, 'Book', 'book.epub'));
    expect(paths).not.toContain(join(root, 'Book', 'Extras', 'bonus.epub'));
  });

  it('includes files from a stem-named audio subfolder (parent has ebooks + same-named audio subdir)', async () => {
    await file('Book/The Three-Body Problem.epub');
    await file('Book/The Three-Body Problem.mobi');
    await file('Book/The Three-Body Problem/01-chapter.mp3');
    await file('Book/The Three-Body Problem/02-chapter.mp3');
    await file('Book/The Three-Body Problem/cover.jpg');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    expect(result).not.toBeNull();
    expect(result!.folderPath).toBe(join(root, 'Book'));
    const paths = result!.files.map((f) => f.absolutePath);
    expect(paths).toContain(join(root, 'Book', 'The Three-Body Problem.epub'));
    expect(paths).toContain(join(root, 'Book', 'The Three-Body Problem', '01-chapter.mp3'));
    expect(paths).toContain(join(root, 'Book', 'The Three-Body Problem', 'cover.jpg'));
    expect(result!.files).toHaveLength(5);
  });

  it('returns null when folder is empty', async () => {
    await dir('EmptyBook');

    const result = await buildSingleBookCandidate(join(root, 'EmptyBook'), root);
    expect(result).toBeNull();
  });

  it('excludes dotfiles', async () => {
    await file('Book/book.epub');
    await file('Book/.DS_Store');

    const result = await buildSingleBookCandidate(join(root, 'Book'), root);
    const paths = result!.files.map((f) => f.absolutePath);
    expect(paths).not.toContain(join(root, 'Book', '.DS_Store'));
    expect(paths).toContain(join(root, 'Book', 'book.epub'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// findLooseFileCandidates
// ══════════════════════════════════════════════════════════════════════════════

describe('findLooseFileCandidates — empty / no primaries', () => {
  it('returns no candidates for an empty library', async () => {
    expect((await findLooseFileCandidates(root)).candidates).toHaveLength(0);
  });

  it('returns no candidates when only non-primary files exist', async () => {
    await file('cover.jpg');
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');
    expect((await findLooseFileCandidates(root)).candidates).toHaveLength(0);
  });
});

describe('findLooseFileCandidates — one candidate per primary file', () => {
  it('root-level primary files each get their own candidate', async () => {
    await file('book1.epub');
    await file('book2.pdf');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.folderPath).sort();
    expect(paths).toContain(join(root, 'book1.epub'));
    expect(paths).toContain(join(root, 'book2.pdf'));
  });

  it('each candidate contains exactly one file and folderPath equals that file path', async () => {
    await file('book1.epub');
    await file('book2.pdf');

    const { candidates } = await findLooseFileCandidates(root);
    for (const c of candidates) {
      expect(c.files).toHaveLength(1);
      expect(c.folderPath).toBe(c.files[0].absolutePath);
    }
  });

  it('files in subdirectories each get their own candidate', async () => {
    await file('Author/BookA/book.epub');
    await file('Author/BookB/book.pdf');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.folderPath).sort();
    expect(paths).toContain(join(root, 'Author', 'BookA', 'book.epub'));
    expect(paths).toContain(join(root, 'Author', 'BookB', 'book.pdf'));
  });

  it('multiple primary files in the same folder each become separate candidates', async () => {
    await file('Series/book1.epub');
    await file('Series/book2.epub');
    await file('Series/book3.mobi');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(3);
    const paths = candidates.map((c) => c.folderPath).sort();
    expect(paths).toContain(join(root, 'Series', 'book1.epub'));
    expect(paths).toContain(join(root, 'Series', 'book2.epub'));
    expect(paths).toContain(join(root, 'Series', 'book3.mobi'));
  });

  it('works across deep nested paths', async () => {
    await file('A/B/C/D/deep.epub');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'A', 'B', 'C', 'D', 'deep.epub'));
  });

  it('non-primary files are not included even if siblings exist', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/cover.jpg');
    await file('Author/Book/book.opf');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(1);
    expect(candidates[0].files[0].absolutePath).toBe(join(root, 'Author', 'Book', 'book.epub'));
  });

  it('mix of root and nested files', async () => {
    await file('root.epub');
    await file('Sub/nested.pdf');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.folderPath).sort();
    expect(paths).toContain(join(root, 'root.epub'));
    expect(paths).toContain(join(root, 'Sub', 'nested.pdf'));
  });
});

describe('findLooseFileCandidates — excludePatterns', () => {
  it('skips files and directories matching exclude patterns', async () => {
    await file('book.epub');
    await file('samples/sample.epub');
    await file('Author/.hidden/book.epub');

    const { candidates } = await findLooseFileCandidates(root, ['samples']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'book.epub'));
  });

  it('wildcard pattern skips matching files', async () => {
    await file('book.epub');
    await file('book_sample.epub');

    const { candidates } = await findLooseFileCandidates(root, ['*_sample*']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'book.epub'));
  });

  it('skips hidden files (dot-prefixed)', async () => {
    await file('.hidden.epub');
    await file('visible.epub');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'visible.epub'));
  });

  it('skips hidden directories', async () => {
    await file('.hiddendir/book.epub');
    await file('visible/book.epub');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe(join(root, 'visible', 'book.epub'));
  });
});

describe('findLooseFileCandidates — FileStat fields', () => {
  it('candidate file has correct relPath relative to library root', async () => {
    await file('Author/Book/book.epub');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates[0].files[0].relPath).toBe(join('Author', 'Book', 'book.epub'));
  });

  it('candidate file has non-zero sizeBytes and valid mtime', async () => {
    await file('book.epub', 'content');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates[0].files[0].sizeBytes).toBeGreaterThan(0);
    expect(candidates[0].files[0].mtime).toBeInstanceOf(Date);
  });

  it('candidate file has a numeric inode', async () => {
    await file('book.epub');

    const { candidates } = await findLooseFileCandidates(root);
    expect(typeof candidates[0].files[0].ino).toBe('number');
  });
});

describe('findLooseFileCandidates — audio files', () => {
  it('each audio file becomes its own candidate (no folder grouping)', async () => {
    await file('Audiobook/chapter1.mp3');
    await file('Audiobook/chapter2.mp3');
    await file('Audiobook/chapter3.m4a');

    const { candidates } = await findLooseFileCandidates(root);
    expect(candidates).toHaveLength(3);
    for (const c of candidates) {
      expect(c.files).toHaveLength(1);
    }
  });
});

// ── WalkResult.skippedDirs ────────────────────────────────────────────────────

describe('WalkResult.skippedDirs', () => {
  it('returns empty skippedDirs when all directories are readable', async () => {
    await file('Author/Book/book.epub');
    const { skippedDirs } = await findBookCandidates(root);
    expect(skippedDirs.size).toBe(0);
  });

  it('includes directories that cannot be read due to permissions', async () => {
    if (process.getuid?.() === 0) return; // skip when running as root

    await dir('Author/NoAccess');
    await file('Author/NoAccess/book.epub');
    await chmod(join(root, 'Author/NoAccess'), 0o000);

    const { skippedDirs } = await findBookCandidates(root);
    expect(skippedDirs.has(join(root, 'Author', 'NoAccess'))).toBe(true);

    await chmod(join(root, 'Author/NoAccess'), 0o755);
  });
});

// ── Cached format/role on FileStat ────────────────────────────────────────────

describe('FileStat cached classification', () => {
  it('populates format and role on FileStat for recognized book files', async () => {
    await file('Author/Book/book.epub');
    const { candidates } = await findBookCandidates(root);
    expect(candidates).toHaveLength(1);
    const bookFile = candidates[0].files[0];
    expect(bookFile.format).toBe('epub');
    expect(bookFile.role).toBe('content');
  });

  it('populates format and role for cover images', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/cover.jpg');
    const { candidates } = await findBookCandidates(root);
    const cover = candidates[0].files.find((f) => f.absolutePath.endsWith('cover.jpg'));
    expect(cover?.format).toBe('jpg');
    expect(cover?.role).toBe('cover');
  });

  it('sets format to extension and role to supplement for unrecognized files', async () => {
    await file('Author/Book/book.epub');
    await file('Author/Book/readme.txt');
    const { candidates } = await findBookCandidates(root);
    const txt = candidates[0].files.find((f) => f.absolutePath.endsWith('readme.txt'));
    expect(txt).toBeDefined();
    expect(txt!.format).toBe('txt');
    expect(txt!.role).toBe('supplement');
  });
});

// ── Incremental scan (dir mtime skip) ──────────────────────────────────────

describe('incremental scan — findBookCandidates', () => {
  it('populates dirMtimes on first scan (no knownDirMtimes)', async () => {
    await file('Author/Book/book.epub');
    const result = await findBookCandidates(root);
    expect(result.dirMtimes.size).toBeGreaterThan(0);
    expect(result.unchangedDirs.size).toBe(0);
    expect(result.candidates).toHaveLength(1);
  });

  it('skips unchanged leaf dir on second scan (returns no candidates for it)', async () => {
    await file('Author/Book/book.epub');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);

    // Second scan with same dir mtimes - unchanged dir should be skipped
    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    // Unchanged dirs should be populated and no candidates emitted for those dirs
    expect(second.unchangedDirs.size).toBeGreaterThan(0);
    expect(second.candidates).toHaveLength(0);
    // dirMtimes should still be populated for state persistence
    expect(second.dirMtimes.size).toBeGreaterThan(0);
  });

  it('rescans dir when its mtime changes (new file added)', async () => {
    await file('Author/Book/book.epub');
    const first = await findBookCandidates(root);

    // Add a new file to the book dir, changing its mtime
    await new Promise((r) => setTimeout(r, 50));
    await file('Author/Book/book.pdf');

    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    // The book dir changed, so it should produce a candidate
    expect(second.candidates).toHaveLength(1);
    expect(second.candidates[0].files).toHaveLength(2);
  });

  it('never skips disc directories even when unchanged', async () => {
    await file('Author/Audiobook/CD 1/track01.mp3');
    await file('Author/Audiobook/CD 1/track02.mp3');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);

    // Second scan: disc dir should still be fully scanned (files present)
    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    // The parent Audiobook dir is unchanged and IS the candidate dir;
    // disc dirs are flattened into parent. Since Audiobook dir itself
    // is unchanged, it will be in unchangedDirs. But the disc dir
    // always provides its files. The parent being unchanged means
    // the parent's OWN files are skipped, but disc children are always scanned.
    // Result: if the parent is unchanged, the disc dir files are still in the candidate.
    // Since there are no direct files in Audiobook/ and disc dir is always scanned,
    // the Audiobook/ dir is not in byDir (no direct files), so it won't be in unchangedDirs.
    // The disc dir provides the files to the parent candidate.
    // On second scan, the disc dir is never skipped, so files appear.
    // But Audiobook/ has no direct files, so it's not a skip candidate.
    // This means candidates should still be present.
    expect(second.candidates.length).toBeGreaterThanOrEqual(1);
    if (second.candidates.length > 0) {
      expect(second.candidates[0].files.length).toBeGreaterThan(0);
    }
  });

  it('forces child rescan when parent dir mtime changes', async () => {
    await file('Author/Book/book.epub');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);

    // Change the parent dir (Author/) by adding a new subdir
    await new Promise((r) => setTimeout(r, 50));
    await dir('Author', 'NewBook');

    // Even though Book/ dir is unchanged, Author/ changed so Book/ is rescanned
    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    expect(second.candidates).toHaveLength(1);
    expect(second.candidates[0].files).toHaveLength(1);
  });

  it('skips root directory when its mtime is unchanged', async () => {
    await file('book.epub');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);

    // Second scan: root mtime unchanged — root-level files should be skipped
    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    expect(second.candidates).toHaveLength(0);
    expect(second.unchangedDirs.has(root)).toBe(true);
  });

  it('rescans root directory when a new root-level file is added', async () => {
    await file('book1.epub');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);

    // Add a new file to root — root mtime changes
    await new Promise((r) => setTimeout(r, 50));
    await file('book2.epub');

    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    expect(second.candidates).toHaveLength(2);
    expect(second.unchangedDirs.has(root)).toBe(false);
  });

  it('never skips parent dir that has disc subdirs (prevents partial candidates)', async () => {
    // Parent has direct files AND disc subdirs - both contribute to the same candidate
    await file('Author/Audiobook/cover.jpg');
    await file('Author/Audiobook/CD 1/track01.mp3');
    await file('Author/Audiobook/CD 1/track02.mp3');
    const first = await findBookCandidates(root);
    expect(first.candidates).toHaveLength(1);
    const firstFiles = first.candidates[0].files.map((f) => f.path).sort();
    expect(firstFiles).toHaveLength(3);

    // Second scan: Audiobook/ has disc subdirs, so it must NOT be skipped
    // even though its mtime is unchanged - otherwise cover.jpg would be lost
    const second = await findBookCandidates(root, [], undefined, first.dirMtimes);
    expect(second.candidates).toHaveLength(1);
    const secondFiles = second.candidates[0].files.map((f) => f.path).sort();
    expect(secondFiles).toEqual(firstFiles);
  });
});

describe('incremental scan — findLooseFileCandidates', () => {
  it('skips unchanged leaf dirs in book_per_file mode', async () => {
    await file('Author/book1.epub');
    await file('Author/book2.epub');
    const first = await findLooseFileCandidates(root);
    expect(first.candidates).toHaveLength(2);

    const second = await findLooseFileCandidates(root, [], undefined, first.dirMtimes);
    // Author/ dir is unchanged - no candidates
    expect(second.candidates).toHaveLength(0);
    expect(second.unchangedDirs.size).toBeGreaterThan(0);
  });
});

// ── clampIno ─────────────────────────────────────────────────────────────────

describe('clampIno', () => {
  it('passes through zero unchanged', () => {
    expect(clampIno(0n)).toBe(0);
  });

  it('passes through typical small filesystem inodes', () => {
    expect(clampIno(1n)).toBe(1);
    expect(clampIno(12345n)).toBe(12345);
    expect(clampIno(1000000n)).toBe(1000000);
  });

  it('passes through the maximum safe JS integer', () => {
    expect(clampIno(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('clamps values one above the maximum safe JS integer to 0', () => {
    expect(clampIno(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe(0);
  });

  it('clamps in-range 64-bit inodes that are precision-unsafe in JavaScript', () => {
    // Exact inode reported in issue #84 on Unraid shfs
    expect(clampIno(651896050678335552n)).toBe(0);
  });

  it('clamps the exact MergerFS inode from the bug report to 0', () => {
    // 17237992710316634000 is the unsigned 64-bit inode reported in the MergerFS issue
    expect(clampIno(17237992710316634000n)).toBe(0);
  });

  it('clamps the maximum unsigned 64-bit inode (2^64 - 1) to 0', () => {
    expect(clampIno(18446744073709551615n)).toBe(0);
  });

  it('returns a number type', () => {
    expect(typeof clampIno(1n)).toBe('number');
    expect(typeof clampIno(17237992710316634000n)).toBe('number');
  });
});
