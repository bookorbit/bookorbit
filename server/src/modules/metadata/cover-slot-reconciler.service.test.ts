import { ZipArchive } from 'archiver';
import { execFile as execFileCallback } from 'child_process';
import { createWriteStream } from 'fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { promisify } from 'util';

import type { CoverMedia, CoverMedium } from '@bookorbit/types';

import type { BookCoverContext, BookCoverSlotRow, BookCoverSourceFile } from '../book-cover-store/book-cover-store.repository';
import type { CoverSlotReconciler as CoverSlotReconcilerType } from './cover-slot-reconciler.service';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);

type SourceFile = Omit<BookCoverSourceFile, 'id'> & { id?: number };
type MemoryBook = {
  libraryId: number;
  coverAspectRatio: string;
  primaryFileId: number | null;
  lockedFields: string[];
  coverSource: 'extracted' | 'custom' | null;
  coverUpdatedAt: Date | null;
  formatPriority: string[];
  files: BookCoverSourceFile[];
};

/** Holds the rows the store would keep in Postgres, so the real store and real extractors can run. */
class MemoryCoverRepository {
  readonly books = new Map<number, MemoryBook>();
  readonly slots = new Map<string, BookCoverSlotRow>();
  mutations = 0;
  private nextFileId = 1;
  private readonly helpers: typeof import('../book-cover-store/book-cover-store.repository');

  constructor(helpers: typeof import('../book-cover-store/book-cover-store.repository')) {
    this.helpers = helpers;
  }

  addBook(bookId: number, files: SourceFile[], options: Partial<MemoryBook> & { primary?: string } = {}): void {
    const withIds = files.map((file) => ({ ...file, id: file.id ?? this.nextFileId++ }));
    const primary = withIds.find((file) => file.absolutePath.endsWith(options.primary ?? '\0')) ?? withIds.find((file) => file.role === 'content');
    this.books.set(bookId, {
      libraryId: 1,
      coverAspectRatio: '2/3',
      primaryFileId: primary?.id ?? null,
      lockedFields: [],
      coverSource: null,
      coverUpdatedAt: null,
      formatPriority: ['epub', 'kepub', 'pdf', 'm4b', 'mp3'],
      ...options,
      files: withIds,
    });
  }

  setFiles(bookId: number, files: SourceFile[]): void {
    const book = this.books.get(bookId)!;
    book.files = files.map((file) => ({ ...file, id: file.id ?? this.nextFileId++ }));
  }

  slot(bookId: number, medium: CoverMedium): BookCoverSlotRow | undefined {
    return this.slots.get(`${bookId}:${medium}`);
  }

  putSlot(bookId: number, medium: CoverMedium, row: Partial<BookCoverSlotRow> = {}): void {
    this.slots.set(`${bookId}:${medium}`, {
      bookId,
      medium,
      source: 'extracted',
      origin: 'embedded',
      width: 10,
      height: 10,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      dormantSince: null,
      ...row,
    });
  }

  findContext(bookId: number): Promise<BookCoverContext | null> {
    const book = this.books.get(bookId);
    if (!book) return Promise.resolve(null);
    return Promise.resolve({
      bookId,
      libraryId: book.libraryId,
      coverAspectRatio: book.coverAspectRatio,
      primaryFileId: book.primaryFileId,
      coverSource: book.coverSource,
      coverUpdatedAt: book.coverUpdatedAt,
      metadataUpdatedAt: null,
      lockedFields: [...book.lockedFields],
      media: this.media(book),
      files: book.files.map(({ id, format, role, mediaOverlayAvailable }) => ({ id, format, role, mediaOverlayAvailable })),
      slots: this.slotsOf(bookId),
    });
  }

  findCoverSources(bookId: number) {
    const book = this.books.get(bookId);
    return Promise.resolve(book ? { formatPriority: book.formatPriority, files: book.files } : null);
  }

  slotsFor(bookIds: number[]): Promise<Map<number, BookCoverSlotRow[]>> {
    return Promise.resolve(new Map(bookIds.map((bookId) => [bookId, this.slotsOf(bookId)])));
  }

  applySlotMutation(
    bookId: number,
    medium: CoverMedium,
    media: CoverMedia,
    mutation: { kind: 'upsert'; row: Omit<BookCoverSlotRow, 'bookId' | 'medium'> } | { kind: 'delete' },
    options: { servedBytesChanged: boolean; updatedAt: Date; beforeMedia?: CoverMedia },
  ) {
    this.mutations++;
    const before = this.slotsOf(bookId);
    if (mutation.kind === 'delete') this.slots.delete(`${bookId}:${medium}`);
    else this.slots.set(`${bookId}:${medium}`, { bookId, medium, ...mutation.row });
    const after = this.slotsOf(bookId);
    const book = this.books.get(bookId)!;
    const koboCoverChanged = this.helpers.didKoboCoverChange(before, after, media, medium, options.servedBytesChanged, options.beforeMedia);
    if (koboCoverChanged) book.coverUpdatedAt = options.updatedAt;
    this.recomputeSummary(bookId, media);
    return Promise.resolve({ libraryId: book.libraryId, koboCoverChanged });
  }

  importSlotWithoutStamp(bookId: number, medium: CoverMedium, row: Omit<BookCoverSlotRow, 'bookId' | 'medium'>) {
    if (!this.slot(bookId, medium)) this.slots.set(`${bookId}:${medium}`, { bookId, medium, ...row });
    this.recomputeSummary(bookId, this.media(this.books.get(bookId)!));
    return Promise.resolve(1);
  }

  copyCoverLockToAudio(bookId: number): Promise<void> {
    const book = this.books.get(bookId)!;
    if (book.lockedFields.includes('cover') && !book.lockedFields.includes('audioCover')) book.lockedFields.push('audioCover');
    return Promise.resolve();
  }

  listBookIdsWithExpiredDormantSlots(_libraryId: number, dormantBefore: Date): Promise<number[]> {
    return Promise.resolve(
      [...this.slots.values()]
        .filter((slot) => slot.source === 'extracted' && slot.dormantSince !== null && slot.dormantSince <= dormantBefore)
        .map((slot) => slot.bookId),
    );
  }

  private media(book: MemoryBook): CoverMedia {
    return this.helpers.getCoverMediaFromDatabaseFiles(book.files);
  }

  private slotsOf(bookId: number): BookCoverSlotRow[] {
    return [...this.slots.values()].filter((slot) => slot.bookId === bookId);
  }

  private recomputeSummary(bookId: number, media: CoverMedia): void {
    const book = this.books.get(bookId)!;
    const active = this.slotsOf(bookId).filter((slot) => slot.dormantSince === null && (slot.medium === 'ebook' ? media.hasEbook : media.hasAudio));
    book.coverSource = active.some((slot) => slot.source === 'custom') ? 'custom' : active.length > 0 ? 'extracted' : null;
  }
}

describe('CoverSlotReconciler on real files', () => {
  let root: string;
  let dataPath: string;
  let ffmpegPath: string;
  let repository: MemoryCoverRepository;
  let reconciler: CoverSlotReconcilerType;
  let nextBookId = 1;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-cover-reconcile-'));
    ffmpegPath = (requireInstaller('@ffmpeg-installer/ffmpeg') as { path: string }).path;
    const ffprobePath = join(root, 'ffprobe');
    await copyFile((requireInstaller('@ffprobe-installer/ffprobe') as { path: string }).path, ffprobePath);
    await chmod(ffprobePath, 0o755);
    vi.stubEnv('FFMPEG_PATH', ffmpegPath);
    vi.stubEnv('FFPROBE_PATH', ffprobePath);
    vi.resetModules();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dataPath = await mkdtemp(join(root, 'data-'));
    const helpers = await import('../book-cover-store/book-cover-store.repository');
    const { BookCoverStore } = await import('../book-cover-store/book-cover-store.service');
    const { MetadataExtractionService } = await import('./metadata-extraction.service');
    const { CoverSlotReconciler } = await import('./cover-slot-reconciler.service');
    repository = new MemoryCoverRepository(helpers);
    const store = new BookCoverStore({ getOrThrow: () => dataPath } as never, repository as never, { emitChanged: vi.fn() } as never);
    reconciler = new CoverSlotReconciler(store, new MetadataExtractionService());
  });

  async function image(width: number, height: number, color = { r: 30, g: 90, b: 160 }): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: color } })
      .jpeg()
      .toBuffer();
  }

  async function epub(path: string, cover: Buffer | null): Promise<void> {
    const manifestCover = cover ? '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image" />' : '';
    const opf = `<?xml version="1.0"?><package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:test</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language></metadata>
      <manifest>${manifestCover}<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" /></manifest>
      <spine><itemref idref="c1" /></spine></package>`;
    const output = createWriteStream(path);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
      archive.append(
        Buffer.from(
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
        ),
        { name: 'META-INF/container.xml' },
      );
      archive.append(Buffer.from(opf), { name: 'OPS/content.opf' });
      archive.append(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>'), { name: 'OPS/c1.xhtml' });
      if (cover) archive.append(cover, { name: 'OPS/cover.jpg' });
      void archive.finalize();
    });
  }

  async function audio(path: string, art: { width: number; height: number } | null): Promise<void> {
    const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2'];
    if (art) {
      const artPath = `${path}.art.jpg`;
      await writeFile(artPath, await image(art.width, art.height, { r: 200, g: 40, b: 40 }));
      args.push('-i', artPath, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    }
    args.push('-c:a', path.endsWith('.mp3') ? 'libmp3lame' : 'aac', path);
    await execFile(ffmpegPath, args);
  }

  async function folder(files: Record<string, 'epub' | 'epub-no-cover' | 'kepub' | 'm4b' | 'm4b-no-art' | 'mp3' | 'square' | 'portrait'>) {
    const dir = await mkdtemp(join(root, 'book-'));
    const sources: SourceFile[] = [];
    for (const [name, kind] of Object.entries(files)) {
      const path = join(dir, name);
      if (kind === 'epub' || kind === 'kepub') await epub(path, await image(200, 300));
      else if (kind === 'epub-no-cover') await epub(path, null);
      else if (kind === 'm4b') await audio(path, { width: 300, height: 300 });
      else if (kind === 'm4b-no-art' || kind === 'mp3') await audio(path, null);
      else
        await writeFile(path, kind === 'square' ? await image(500, 500, { r: 10, g: 200, b: 10 }) : await image(400, 600, { r: 10, g: 10, b: 200 }));
      const format = name.split('.').pop()!.toLowerCase();
      const role = kind === 'square' || kind === 'portrait' ? 'cover' : 'content';
      sources.push({ absolutePath: path, format, role, sizeBytes: 1, mediaOverlayAvailable: false });
    }
    return sources;
  }

  function withOverlay(files: SourceFile[]): SourceFile[] {
    return files.map((file) => (file.format === 'epub' ? { ...file, mediaOverlayAvailable: true } : file));
  }

  function shapeOf(bookId: number, medium: CoverMedium): string | null {
    const slot = repository.slot(bookId, medium);
    if (!slot) return null;
    return `${slot.origin}:${slot.width}x${slot.height}${slot.dormantSince ? ':dormant' : ''}`;
  }

  it('fills both slots of an EPUB and M4B folder from each medium’s own embedded art', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub', 'book.m4b': 'm4b' }));

    const result = await reconciler.reconcile(bookId);

    expect(result.filled.sort()).toEqual(['audio', 'ebook']);
    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBe('embedded:300x300');
    expect(await readdir(join(dataPath, 'covers', String(bookId), 'audio'))).toEqual(expect.arrayContaining(['thumbnail.jpg']));
  });

  it('fills the ebook slot of an M4B-primary book and leaves the audio slot the scan already wrote', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.m4b': 'm4b', 'book.epub': 'epub' }), { primary: 'book.m4b' });
    repository.putSlot(bookId, 'audio', { width: 300, height: 300 });
    const before = repository.slot(bookId, 'audio');

    await reconciler.reconcile(bookId, { filesChanged: true });

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(repository.slot(bookId, 'audio')).toEqual(before);
  });

  it('reads a KEPUB as the ebook source', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.kepub': 'kepub', 'book.m4b': 'm4b' }));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBe('embedded:300x300');
  });

  it('falls back to a square folder image for multi-track mp3 with no embedded art', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub', '01.mp3': 'mp3', '02.mp3': 'mp3', 'folder.jpg': 'square' }));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBe('folder_image:500x500');
  });

  it('never puts a portrait folder image into the audio slot of a book with both media', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub-no-cover', 'book.m4b': 'm4b-no-art', 'cover.jpg': 'portrait' }));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('folder_image:400x600');
    expect(shapeOf(bookId, 'audio')).toBeNull();
  });

  it('fills a single-medium book from its folder image whatever the shape', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ '01.mp3': 'mp3', 'cover.jpg': 'portrait' }));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'audio')).toBe('folder_image:400x600');
  });

  it('keeps the audio slot of a read-along EPUB empty, because the EPUB art is the book cover', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, withOverlay(await folder({ 'book.epub': 'epub', 'cover.jpg': 'portrait' })));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBeNull();
  });

  it('fills the audio slot of a read-along EPUB from a square folder image', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, withOverlay(await folder({ 'book.epub': 'epub', 'cover.jpg': 'square' })));

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBe('folder_image:500x500');
  });

  it('puts the audio slot to sleep when an EPUB loses its read-along audio, and wakes it when it returns', async () => {
    const bookId = nextBookId++;
    const synced = withOverlay(await folder({ 'book.epub': 'epub', 'cover.jpg': 'square' }));
    repository.addBook(bookId, synced);
    await reconciler.reconcile(bookId);

    repository.setFiles(
      bookId,
      synced.map((file) => ({ ...file, mediaOverlayAvailable: false })),
    );
    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(shapeOf(bookId, 'audio')).toBe('folder_image:500x500:dormant');
    expect(repository.books.get(bookId)!.coverSource).toBe('extracted');

    repository.setFiles(bookId, synced);
    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(shapeOf(bookId, 'audio')).toBe('folder_image:500x500');
  });

  it('keeps a custom audiobook cover through a replace, where the M4B is unlinked and added again', async () => {
    const bookId = nextBookId++;
    const files = await folder({ 'book.epub': 'epub', 'book.m4b': 'm4b' });
    repository.addBook(bookId, files);
    await reconciler.reconcile(bookId);
    repository.putSlot(bookId, 'audio', { source: 'custom', origin: 'upload', width: 640, height: 640 });
    const audioDir = join(dataPath, 'covers', String(bookId), 'audio');
    await writeFile(join(audioDir, 'cover_custom.jpg'), await image(640, 640));

    repository.setFiles(
      bookId,
      files.filter((file) => file.format !== 'm4b'),
    );
    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(repository.slot(bookId, 'audio')).toMatchObject({ source: 'custom', dormantSince: expect.any(Date) });

    repository.setFiles(bookId, files);
    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(repository.slot(bookId, 'audio')).toMatchObject({ source: 'custom', origin: 'upload', width: 640, dormantSince: null });
    expect(await readdir(audioDir)).toContain('cover_custom.jpg');
  });

  it('prunes an extracted slot dormant for a day but keeps a dormant custom one', async () => {
    const bookId = nextBookId++;
    const files = await folder({ 'book.epub': 'epub' });
    repository.addBook(bookId, files);
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    repository.putSlot(bookId, 'audio', { dormantSince: longAgo });
    await mkdir(join(dataPath, 'covers', String(bookId), 'audio'), { recursive: true });

    await reconciler.reconcile(bookId);
    expect(repository.slot(bookId, 'audio')).toBeUndefined();
    await expect(readdir(join(dataPath, 'covers', String(bookId), 'audio'))).rejects.toThrow();

    repository.putSlot(bookId, 'audio', { source: 'custom', dormantSince: longAgo });
    await reconciler.reconcile(bookId);
    expect(repository.slot(bookId, 'audio')).toMatchObject({ source: 'custom' });
  });

  it('does not fill a locked slot', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub', 'book.m4b': 'm4b' }), { lockedFields: ['audioCover'] });

    await reconciler.reconcile(bookId);

    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(shapeOf(bookId, 'audio')).toBeNull();
  });

  it('replaces folder-image art with embedded art that appears later, and rewrites nothing when nothing changed', async () => {
    const bookId = nextBookId++;
    const files = await folder({ '01.mp3': 'mp3', 'folder.jpg': 'square' });
    repository.addBook(bookId, files);
    await reconciler.reconcile(bookId);
    const mutations = repository.mutations;

    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(repository.mutations).toBe(mutations);

    const tagged = files.map((file) => (file.format === 'mp3' ? { ...file, absolutePath: `${file.absolutePath}.m4b`, format: 'm4b' } : file));
    await audio(tagged[0]!.absolutePath, { width: 300, height: 300 });
    repository.setFiles(bookId, tagged);
    await reconciler.reconcile(bookId, { filesChanged: true });
    expect(shapeOf(bookId, 'audio')).toBe('embedded:300x300');
  });

  it('converts a legacy root cover before filling, so the old art is not stranded', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub', 'book.m4b': 'm4b' }), { coverSource: 'custom' });
    const legacyDir = join(dataPath, 'covers', String(bookId));
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'cover_custom.jpg'), await image(700, 700));

    await reconciler.reconcile(bookId);

    expect(repository.slot(bookId, 'audio')).toMatchObject({ source: 'custom', origin: 'legacy' });
    expect(shapeOf(bookId, 'ebook')).toBe('embedded:200x300');
    expect(await readdir(legacyDir)).toEqual(expect.not.arrayContaining(['cover_custom.jpg']));
  });

  it('runs a book once per request, and again when a request lands mid-run', async () => {
    const bookId = nextBookId++;
    repository.addBook(bookId, await folder({ 'book.epub': 'epub' }));
    const spy = vi.spyOn(reconciler, 'reconcile');

    await reconciler.enqueue([bookId, bookId]);
    expect(spy).toHaveBeenCalledTimes(1);

    const running = reconciler.enqueue([bookId]);
    const rerun = reconciler.enqueue([bookId], { filesChanged: true });
    const absorbed = reconciler.enqueue([bookId]);
    await Promise.all([running, rerun, absorbed]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenLastCalledWith(bookId, { filesChanged: true, backfill: false });
  });
});
