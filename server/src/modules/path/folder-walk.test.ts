import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { findBookCandidates, findLooseFileCandidates } from '../scanner/lib/walk';
import { hasListableChild, isBlockedPath, isBlockedTarget, isInsideOrAt, mapLimit, walkFolder } from './folder-walk';

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

async function files(dir: string, names: string[], size = 10) {
  await mkdir(dir, { recursive: true });
  for (const name of names) await writeFile(join(dir, name), 'x'.repeat(size));
}

const unlimited = () => ({ maxEntries: 100_000, deadline: Date.now() + 10_000 });

describe('walkFolder', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'folder-walk-'));
  });

  afterEach(async () => {
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('counts every book file directly in the folder as its own book, as the scanner does', async () => {
    await files(root, ['Dune.epub', 'Emma.pdf', 'cover.jpg', 'notes.txt.bak']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome).toMatchObject({ state: 'ok', files: 2, folderBooks: 2, formats: { epub: 1, pdf: 1 }, folders: 0, mergedFolders: 0 });
  });

  it('reads one book per folder below, through author folders', async () => {
    await files(join(root, 'Ann Leckie', 'Ancillary Justice (2013)'), ['Ancillary Justice.epub', 'Ancillary Justice.mobi']);
    await files(join(root, 'Ann Leckie', 'Provenance (2017)'), ['Provenance.epub']);
    await files(join(root, 'Martha Wells', 'All Systems Red (2017)'), ['All Systems Red.azw3']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome).toMatchObject({ files: 4, folderBooks: 3, folders: 2, mergedFolders: 0, formats: { epub: 2, mobi: 1, azw3: 1 } });
  });

  it('flags folders below that hold several differently named books, which Folder as Book merges', async () => {
    await files(join(root, 'Saga (2012)'), ['Saga 001.cbz', 'Saga 002.cbz', 'Saga 003.cbz']);
    await files(join(root, 'Watchmen (1986)'), ['Watchmen 001.cbz', 'Watchmen 002.cbz']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome).toMatchObject({ files: 5, folderBooks: 2, mergedFolders: 2, splitAudioFolders: 0 });
  });

  it('flags audiobooks in parts, which File as Book splits into one book per file', async () => {
    await files(join(root, 'Andy Weir', 'Project Hail Mary'), ['01.mp3', '02.mp3', '03.mp3']);
    await files(join(root, 'Andy Weir', 'Artemis'), ['Artemis.m4b']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome).toMatchObject({ files: 4, folderBooks: 2, mergedFolders: 0, splitAudioFolders: 1 });
  });

  it('folds disc folders and folders named after a sibling file into their parent', async () => {
    await files(join(root, 'Author', 'Long Book', 'CD 1'), ['01.mp3']);
    await files(join(root, 'Author', 'Long Book', 'CD 2'), ['01.mp3']);
    await files(join(root, 'Author', 'Story'), ['Story.epub']);
    await files(join(root, 'Author', 'Story', 'Story'), ['Story.mp3']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome.folderBooks).toBe(2);
  });

  it('folds disc folders inside a folder named after a sibling file into one book, as the scanner does', async () => {
    await files(join(root, 'Author', 'Title'), ['Title.epub']);
    await files(join(root, 'Author', 'Title', 'Title', 'CD 1'), ['01.mp3']);
    await files(join(root, 'Author', 'Title', 'Title', 'CD 2'), ['01.mp3']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome.folderBooks).toBe(1);
  });

  it('folds a folder named after a sidecar file, not only after a book file', async () => {
    await files(join(root, 'Series'), ['A.epub', 'B.opf']);
    await files(join(root, 'Series', 'B'), ['01.mp3']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome.folderBooks).toBe(1);
  });

  it('agrees with the scanner on every layout it groups', async () => {
    await files(root, ['Loose.epub', 'Loose.opf', 'Other.pdf']);
    await files(join(root, 'CD 1'), ['01.mp3', '02.mp3']);
    await files(join(root, 'Ann Leckie', 'Ancillary Justice (2013)'), ['Ancillary Justice.epub', 'Ancillary Justice.mobi', 'cover.jpg']);
    await files(join(root, 'Saga (2012)'), ['Saga 001.cbz', 'Saga 002.cbz']);
    await files(join(root, 'Andy Weir', 'Project Hail Mary', 'Disc 1'), ['01.mp3']);
    await files(join(root, 'Andy Weir', 'Project Hail Mary', 'Disc 2'), ['01.mp3']);
    await files(join(root, 'Author', 'Title'), ['Title.epub']);
    await files(join(root, 'Author', 'Title', 'Title', 'CD 1'), ['01.mp3']);
    await files(join(root, 'Author', 'Title', 'Title', 'CD 2'), ['01.mp3']);
    await files(join(root, 'Series'), ['A.epub', 'B.opf']);
    await files(join(root, 'Series', 'B'), ['01.mp3']);
    await files(join(root, 'Notes'), ['readme.txt']);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome.folderBooks).toBe((await findBookCandidates(root)).candidates.length);
    expect(outcome.files).toBe((await findLooseFileCandidates(root)).candidates.length);
  });

  it('skips hidden folders and symlinks', async () => {
    await files(join(root, '.cache'), ['Hidden.epub']);
    await files(join(root, 'Real'), ['Real.epub']);
    await symlink(join(root, 'Real'), join(root, 'Linked'));

    const outcome = await walkFolder(root, unlimited());

    expect(outcome).toMatchObject({ files: 1, folders: 1 });
  });

  it('stops at the entry cap and says the counts are a lower bound', async () => {
    for (let i = 0; i < 5; i++) await files(join(root, `Author ${i}`), [`Book ${i}.epub`]);

    const outcome = await walkFolder(root, { maxEntries: 3, deadline: Date.now() + 10_000 });

    expect(outcome.truncated).toBe(true);
    expect(outcome.files).toBeLessThan(5);
  });

  it('reads no more of a huge flat folder than the entry budget allows', async () => {
    await files(
      root,
      Array.from({ length: 50 }, (_, i) => `Book ${String(i).padStart(2, '0')}.epub`),
    );

    const outcome = await walkFolder(root, { maxEntries: 10, deadline: Date.now() + 10_000 });

    expect(outcome).toMatchObject({ truncated: true, files: 10, folderBooks: 10 });
  });

  it('stops sizing files once the deadline passes mid-folder and says the answer is partial', async () => {
    await files(root, ['A.epub', 'B.epub'], 100);
    // Time for the folder and the first file, then the deadline is behind.
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(100);

    try {
      const outcome = await walkFolder(root, { maxEntries: 100, deadline: 50, withSizes: true });

      expect(outcome).toMatchObject({ truncated: true, files: 2, bytes: 100 });
    } finally {
      now.mockRestore();
    }
  });

  it.skipIf(runningAsRoot)('says the counts are a lower bound when a folder below cannot be opened', async () => {
    await files(join(root, 'Open'), ['Open.epub']);
    await files(join(root, 'Closed'), ['Closed.epub']);
    await chmod(join(root, 'Closed'), 0o000);

    try {
      const outcome = await walkFolder(root, unlimited());

      expect(outcome).toMatchObject({ state: 'ok', files: 1, truncated: true });
    } finally {
      await chmod(join(root, 'Closed'), 0o755);
    }
  });

  it('sums sizes and returns the first files in name order when asked', async () => {
    await files(join(root, 'B'), ['Second.epub'], 30);
    await files(join(root, 'A'), ['First.epub'], 20);
    await files(root, ['Loose.pdf'], 50);

    const outcome = await walkFolder(root, { ...unlimited(), withSizes: true, samples: 2 });

    expect(outcome.bytes).toBe(100);
    expect(outcome.samples).toEqual(['Loose.pdf', 'A/First.epub']);
  });

  it('reports a missing folder instead of an empty one', async () => {
    const outcome = await walkFolder(join(root, 'nope'), unlimited());

    expect(outcome).toMatchObject({ state: 'missing', files: 0 });
  });

  it.skipIf(runningAsRoot)('reports a folder it may not read as denied', async () => {
    await chmod(root, 0o000);

    const outcome = await walkFolder(root, unlimited());

    expect(outcome.state).toBe('denied');
  });
});

describe('folder-walk helpers', () => {
  it('knows the blocked system paths and their children', () => {
    expect(isBlockedPath('/proc')).toBe(true);
    expect(isBlockedPath('/proc/1')).toBe(true);
    expect(isBlockedPath('/procedures')).toBe(false);
  });

  it('refuses a symlink into a blocked system path like the path itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folder-walk-'));
    try {
      await symlink('/dev', join(root, 'dev-link'));
      await mkdir(join(root, 'plain'));

      expect(await isBlockedTarget(join(root, 'dev-link'))).toBe(true);
      expect(await isBlockedTarget(join(root, 'plain'))).toBe(false);
      expect(await isBlockedTarget(join(root, 'missing'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats a folder as inside itself and its ancestors only', () => {
    expect(isInsideOrAt('/books/Ebooks', '/books')).toBe(true);
    expect(isInsideOrAt('/books', '/books')).toBe(true);
    expect(isInsideOrAt('/bookshelf', '/books')).toBe(false);
    expect(isInsideOrAt('/anything', '/')).toBe(true);
  });

  it('finds whether a folder has a listable folder inside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'folder-walk-'));
    try {
      await files(join(root, 'empty'), []);
      await files(join(root, 'files-only'), ['a.epub']);
      await files(join(root, 'nested', 'inner'), []);
      await files(join(root, 'hidden-only', '.git'), []);

      expect(await hasListableChild(join(root, 'empty'))).toBe(false);
      expect(await hasListableChild(join(root, 'files-only'))).toBe(false);
      expect(await hasListableChild(join(root, 'nested'))).toBe(true);
      expect(await hasListableChild(join(root, 'hidden-only'))).toBe(false);
      expect(await hasListableChild(join(root, 'missing'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the input order while limiting concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight -= 1;
      return ms * 2;
    });

    expect(results).toEqual([60, 20, 40, 10]);
    expect(peak).toBe(2);
  });
});
