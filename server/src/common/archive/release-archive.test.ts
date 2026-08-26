import { mkdtemp, readdir, readFile, lstat, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { deflateRawSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSevenZip } from '../sevenzip';
import { ARCHIVE_BOUNDS, createArchiveBudget, extractReleaseArchive, ReleaseArchiveError } from './release-archive';

/** The real module loads a WASM binary; only the filesystem it hands back matters here. */
vi.mock('../sevenzip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sevenzip')>()),
  getSevenZip: vi.fn(),
}));

/**
 * Zips are built by hand rather than shelled out to, because every test here is about an archive
 * a normal tool would refuse to produce: a lying size field, a traversal path, an encryption flag.
 */
interface ZipEntry {
  name: string;
  contents: Buffer;
  /** Overrides the real uncompressed size in both headers, to fake a decompression bomb. */
  declaredSize?: number;
  encrypted?: boolean;
  deflate?: boolean;
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const stored = entry.deflate ? deflateRawSync(entry.contents) : entry.contents;
    const declaredSize = entry.declaredSize ?? entry.contents.length;
    const flags = entry.encrypted ? 0x1 : 0x0;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.contents), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.contents), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBytes, end]);
}

/**
 * Every runtime bound is measured in gigabytes, which is not a thing a test can stream. The
 * constant is lowered for the case under test and restored afterwards, so what is proven is that
 * the metering happens rather than how large the number it compares against is.
 */
const mutableBounds = ARCHIVE_BOUNDS as unknown as Record<keyof typeof ARCHIVE_BOUNDS, number>;

async function withBounds(overrides: Partial<Record<keyof typeof ARCHIVE_BOUNDS, number>>, body: () => Promise<void>): Promise<void> {
  const original = { ...mutableBounds };
  Object.assign(mutableBounds, overrides);
  try {
    await body();
  } finally {
    Object.assign(mutableBounds, original);
  }
}

describe('extractReleaseArchive with a ZIP', () => {
  let workspace: string;
  let target: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'bookorbit-archive-'));
    target = join(workspace, 'out');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  async function extract(entries: ZipEntry[]): Promise<void> {
    const archive = join(workspace, 'release.zip');
    await writeFile(archive, buildZip(entries));
    await extractReleaseArchive(archive, 'zip', target);
  }

  it('extracts an ordinary release into the target folder', async () => {
    await extract([
      { name: 'Dune.epub', contents: Buffer.from('book bytes') },
      { name: 'cover.jpg', contents: Buffer.from('image bytes') },
    ]);

    expect((await readdir(target)).sort()).toEqual(['Dune.epub', 'cover.jpg']);
    expect(await readFile(join(target, 'Dune.epub'), 'utf8')).toBe('book bytes');
  });

  it('keeps the folder structure inside the archive', async () => {
    await extract([{ name: 'Dune/CD 1/track-01.mp3', contents: Buffer.from('audio') }]);

    expect(await readFile(join(target, 'Dune', 'CD 1', 'track-01.mp3'), 'utf8')).toBe('audio');
  });

  it('refuses an entry that escapes the extraction folder', async () => {
    await expect(extract([{ name: '../escaped.epub', contents: Buffer.from('nope') }])).rejects.toThrow(/escapes the extraction folder/);
    await expect(readdir(join(workspace))).resolves.not.toContain('escaped.epub');
  });

  it('refuses a deeply disguised traversal', async () => {
    await expect(extract([{ name: 'a/b/../../../escaped.epub', contents: Buffer.from('nope') }])).rejects.toThrow(ReleaseArchiveError);
  });

  it('refuses an absolute path', async () => {
    await expect(extract([{ name: '/tmp/escaped.epub', contents: Buffer.from('nope') }])).rejects.toThrow(/absolute path/);
  });

  it('refuses a password protected archive rather than writing unreadable bytes', async () => {
    await expect(extract([{ name: 'Dune.epub', contents: Buffer.from('encrypted'), encrypted: true }])).rejects.toThrow(/password protected/);
  });

  /** A bomb declares its true expanded size; the ratio check catches it before anything is written. */
  it('refuses a decompression bomb before writing a byte', async () => {
    const contents = Buffer.alloc(2 * 1024 * 1024, 0);
    await expect(extract([{ name: 'bomb.epub', contents, deflate: true }])).rejects.toThrow(/compressed far beyond/);
    await expect(readdir(target)).resolves.toEqual([]);
  });

  /**
   * Each entry is individually unremarkable - exactly a megabyte, so the ratio rule does not even
   * apply to it - and it is only the sum that is refused.
   */
  it('refuses an archive whose entries add up past the total bound', async () => {
    const declaredSize = 1024 * 1024;
    const count = Math.floor(ARCHIVE_BOUNDS.maxTotalBytes / declaredSize) + 8;
    const entries = Array.from({ length: count }, (_, index) => ({ name: `part-${index}.epub`, contents: Buffer.from('x'), declaredSize }));

    await expect(extract(entries)).rejects.toThrow(/more than BookOrbit will extract/);
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('refuses an entry larger on its own than the per-entry bound', async () => {
    const declaredSize = ARCHIVE_BOUNDS.maxEntryBytes + 1;
    await expect(extract([{ name: 'huge.epub', contents: Buffer.from('x'), declaredSize }])).rejects.toThrow(/larger than BookOrbit will extract/);
  });

  it('refuses an archive with more entries than the bound', async () => {
    const entries = Array.from({ length: ARCHIVE_BOUNDS.maxEntries + 1 }, (_, index) => ({
      name: `book-${index}.epub`,
      contents: Buffer.from('x'),
    }));
    await expect(extract(entries)).rejects.toThrow(/more than 5000 files/);
  });

  it('refuses an empty archive', async () => {
    await expect(extract([])).rejects.toThrow(/empty/);
  });

  it('refuses a file that is not a readable archive', async () => {
    const archive = join(workspace, 'broken.zip');
    await writeFile(archive, Buffer.from('this is not a zip'));
    await expect(extractReleaseArchive(archive, 'zip', target)).rejects.toThrow(/could not be read/);
  });

  /** Nothing here ever calls symlink(), so a link entry lands as an ordinary file of its target. */
  it('writes a symlink entry as a plain file rather than creating a link', async () => {
    await extract([{ name: 'link', contents: Buffer.from('/etc/passwd') }]);

    const info = await lstat(join(target, 'link'));
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.isFile()).toBe(true);
  });

  /**
   * Scene ebook packaging is a zip holding a rar holding the book, so the budget has to span the
   * passes: charging each archive its own ceiling would let a two-level release spend twice.
   */
  describe('across nested extraction passes', () => {
    it('spends one budget between passes rather than one each', async () => {
      // Against the real ceiling this needed two thousand entries per pass to reach four
      // gigabytes of declarations, which is four thousand files written for an assertion about
      // arithmetic - slow enough to cross the default test deadline under load. The ceiling is
      // lowered instead: what is proven is that the budget spans the passes, not its size.
      await withBounds({ maxTotalBytes: 8 * 1024 * 1024 }, async () => {
        const declaredSize = 1024 * 1024;
        // Six megabytes of declarations fits under the ceiling; twelve, across both passes, does not.
        const entries = Array.from({ length: 6 }, (_, index) => ({
          name: `part-${index}.epub`,
          contents: Buffer.from('x'),
          declaredSize,
        }));

        const budget = createArchiveBudget();
        const first = join(workspace, 'first.zip');
        const second = join(workspace, 'second.zip');
        await writeFile(first, buildZip(entries));
        await writeFile(second, buildZip(entries));

        // Each half fits on its own; together they do not.
        await extractReleaseArchive(first, 'zip', join(target, 'a'), budget);
        await expect(extractReleaseArchive(second, 'zip', join(target, 'b'), budget)).rejects.toThrow(/more than BookOrbit will extract/);
      });
    });

    /**
     * The counter that meters bytes as they land used to be declared inside the extraction, so a
     * nested archive got a fresh one per pass and could spend the runtime ceiling once per level.
     * Only the declared sizes were shared, and those are exactly what a hostile archive lies about.
     */
    it('spends one runtime budget between passes even when every size is understated', async () => {
      await withBounds({ maxTotalBytes: 8 * 1024 }, async () => {
        const contents = Buffer.alloc(6 * 1024, 'x');
        const budget = createArchiveBudget();
        const first = join(workspace, 'first.zip');
        const second = join(workspace, 'second.zip');
        // Each declares a kilobyte and streams six, so nothing is refused while planning.
        await writeFile(first, buildZip([{ name: 'a.epub', contents, declaredSize: 1024 }]));
        await writeFile(second, buildZip([{ name: 'b.epub', contents, declaredSize: 1024 }]));

        await extractReleaseArchive(first, 'zip', join(target, 'a'), budget);
        await expect(extractReleaseArchive(second, 'zip', join(target, 'b'), budget)).rejects.toThrow(/more than BookOrbit will extract/);
      });
    });

    /** The per-entry ceiling was only ever applied to the claim, never to what actually arrived. */
    it('aborts an entry that declares a kilobyte and then streams past the per-file ceiling', async () => {
      await withBounds({ maxEntryBytes: 4 * 1024 }, async () => {
        const archive = join(workspace, 'liar.zip');
        await writeFile(archive, buildZip([{ name: 'Dune.epub', contents: Buffer.alloc(16 * 1024, 'x'), declaredSize: 1024 }]));

        await expect(extractReleaseArchive(archive, 'zip', target)).rejects.toThrow(/larger than BookOrbit will extract/);
      });
    });

    it('starts a fresh budget for an unrelated release', async () => {
      const archive = join(workspace, 'release.zip');
      await writeFile(archive, buildZip([{ name: 'Dune.epub', contents: Buffer.from('book') }]));

      await extractReleaseArchive(archive, 'zip', join(target, 'a'));
      await expect(extractReleaseArchive(archive, 'zip', join(target, 'b'))).resolves.toBeUndefined();
    });
  });
});

const DIR_MODE = 0o040755;
const FILE_MODE = 0o100644;

/**
 * The 7z path expands into a filesystem that belongs to a single shared WASM instance, which is
 * what makes two extractions at once interesting: they are neighbours in one tree rather than
 * strangers in two.
 */
class FakeVfs {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly reads: string[] = [];
  readonly made: string[] = [];

  mkdir(path: string): void {
    if (this.dirs.has(path)) throw new Error(`EEXIST: ${path}`);
    this.dirs.add(path);
    this.made.push(path);
  }

  open(): number {
    return 1;
  }

  write(): number {
    return 0;
  }

  close(): void {}

  writeAt(path: string, contents: string): void {
    for (const parent of parentsOf(path)) this.dirs.add(parent);
    this.files.set(path, new TextEncoder().encode(contents));
  }

  readdir(path: string): string[] {
    if (!this.dirs.has(path)) throw new Error(`ENOENT: ${path}`);
    const names = new Set<string>();
    for (const candidate of [...this.files.keys(), ...this.dirs]) {
      if (!candidate.startsWith(`${path}/`)) continue;
      names.add(candidate.slice(path.length + 1).split('/')[0]!);
    }
    return ['.', '..', ...names];
  }

  stat(path: string): { mode: number; size: number } {
    const file = this.files.get(path);
    if (file) return { mode: FILE_MODE, size: file.length };
    if (this.dirs.has(path)) return { mode: DIR_MODE, size: 0 };
    throw new Error(`ENOENT: ${path}`);
  }

  isDir(mode: number): boolean {
    return mode === DIR_MODE;
  }

  readFile(path: string): Uint8Array {
    const file = this.files.get(path);
    if (!file) throw new Error(`ENOENT: ${path}`);
    this.reads.push(path);
    return file;
  }

  unlink(path: string): void {
    if (!this.files.delete(path)) throw new Error(`EISDIR: ${path}`);
  }

  rmdir(path: string): void {
    this.dirs.delete(path);
  }
}

function parentsOf(path: string): string[] {
  const segments = path.split('/').slice(1, -1);
  return segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);
}

describe('extractReleaseArchive with a 7z', () => {
  let workspace: string;
  let vfs: FakeVfs;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'bookorbit-7z-'));
    vfs = new FakeVfs();
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    vi.mocked(getSevenZip).mockReset();
  });

  /** `x` writes the payload wherever the caller asked for it, which is what the real one does. */
  function mountSevenZip(payload: Record<string, string>): void {
    const callMain = vi.fn((args: string[]) => {
      const outDir = args.find((arg) => arg.startsWith('-o'))!.slice(2);
      for (const [name, contents] of Object.entries(payload)) vfs.writeAt(`${outDir}/${name}`, contents);
    });
    vi.mocked(getSevenZip).mockResolvedValue({ FS: vfs, callMain } as never);
  }

  async function archiveAt(name: string): Promise<string> {
    const path = join(workspace, name);
    await writeFile(path, Buffer.from('7z\xbc\xaf\x27\x1c'));
    return path;
  }

  it('writes what the archive held into the target folder', async () => {
    mountSevenZip({ 'Dune.epub': 'book bytes', 'art/cover.jpg': 'image bytes' });

    await extractReleaseArchive(await archiveAt('release.7z'), '7z', join(workspace, 'out'));

    expect(await readFile(join(workspace, 'out', 'Dune.epub'), 'utf8')).toBe('book bytes');
    expect(await readFile(join(workspace, 'out', 'art', 'cover.jpg'), 'utf8')).toBe('image bytes');
  });

  /**
   * The working directory used to be named from the clock, so two extractions starting in the same
   * millisecond took the same path: one failed to create it and the other's `finally` deleted the
   * tree the survivor was still reading.
   */
  it('gives two concurrent extractions separate trees', async () => {
    mountSevenZip({});
    const callMain = vi.fn((args: string[]) => {
      const outDir = args.find((arg) => arg.startsWith('-o'))!.slice(2);
      vfs.writeAt(`${outDir}/book.epub`, outDir);
    });
    vi.mocked(getSevenZip).mockResolvedValue({ FS: vfs, callMain } as never);

    const [first, second] = [join(workspace, 'a'), join(workspace, 'b')];
    await Promise.all([
      extractReleaseArchive(await archiveAt('first.7z'), '7z', first),
      extractReleaseArchive(await archiveAt('second.7z'), '7z', second),
    ]);

    const landed = await Promise.all([readFile(join(first, 'book.epub'), 'utf8'), readFile(join(second, 'book.epub'), 'utf8')]);
    expect(landed[0]).not.toBe(landed[1]);
    expect(new Set(vfs.made).size).toBe(vfs.made.length);
  });

  /**
   * Sizes come from the expanded tree's own metadata, so a release past a bound is refused while
   * its bytes are still only in the WASM heap rather than also copied into ours.
   */
  it('refuses an oversized expansion before reading a single entry', async () => {
    await withBounds({ maxTotalBytes: 8 }, async () => {
      mountSevenZip({ 'Dune.epub': 'far more than eight bytes' });

      await expect(extractReleaseArchive(await archiveAt('release.7z'), '7z', join(workspace, 'out'))).rejects.toThrow(
        /more than BookOrbit will extract/,
      );
      expect(vfs.reads).toHaveLength(0);
    });
  });
});
