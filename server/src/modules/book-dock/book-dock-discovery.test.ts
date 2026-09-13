import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { watch } from 'chokidar';
import type { BookDockFileRow, NewBookDockFileRow, NewBookDockUnitFileRow } from '../../db/schema';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { BookDockIngestService } from './book-dock-ingest.service';
import { waitForDirectoryStability } from '../scanner/lib/stability';

vi.mock('../scanner/lib/stability', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
  waitForDirectoryStability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('chokidar', () => ({ watch: vi.fn() }));

type UnitFile = Omit<NewBookDockUnitFileRow, 'dockFileId'>;

// Keep discovery, classification, grouping and persistence interactions real. Only the DB,
// external watcher and elapsed stability time are controlled by this test.
describe('Book Dock filesystem discovery', () => {
  let root: string;
  let module: TestingModule;
  let watcher: BookDockWatcherService;
  let rows: BookDockFileRow[];
  let members: Map<number, UnitFile[]>;
  let events: EventEmitter;
  let paused: boolean;

  async function put(path: string): Promise<string> {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, 'discovery fixture');
    return full;
  }

  function create(data: NewBookDockFileRow): BookDockFileRow {
    expect(rows.some((row) => row.absolutePath === data.absolutePath)).toBe(false);
    if (data.unitDirectory) expect(rows.some((row) => row.unitDirectory === data.unitDirectory)).toBe(false);
    const row = { id: rows.length + 1, unitDirectory: null, autoFinalizeSuppressed: false, ...data } as BookDockFileRow;
    rows.push(row);
    return row;
  }

  const paths = () => rows.map((row) => relative(root, row.absolutePath)).sort();
  const contentPaths = (id: number) =>
    (members.get(id) ?? []).filter((file) => file.role === 'content').map((file) => relative(root, file.absolutePath));

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'book-dock-discovery-'));
    // Canonical root spelling matters on platforms whose temp directory is a symlink.
    root = await realpath(root);
    rows = [];
    members = new Map();
    paused = false;
    events = new EventEmitter();
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(watch).mockImplementation(() => {
      queueMicrotask(() => events.emit('ready'));
      return Object.assign(events, { close }) as unknown as ReturnType<typeof watch>;
    });
    const repo = {
      findByAbsolutePath: vi.fn((path: string) => Promise.resolve(rows.find((row) => row.absolutePath === path))),
      findByUnitDirectory: vi.fn((path: string) => Promise.resolve(rows.find((row) => row.unitDirectory === path))),
      findClaimedPaths: vi.fn((inputs: string[]) => {
        const claimed = new Set([...rows.map((row) => row.absolutePath), ...[...members.values()].flat().map((file) => file.absolutePath)]);
        return Promise.resolve(new Set(inputs.filter((path) => claimed.has(path))));
      }),
      create: vi.fn((data: NewBookDockFileRow) => Promise.resolve(create(data))),
      createUnit: vi.fn((data: NewBookDockFileRow, files: UnitFile[]) => {
        const existing = new Set([...members.values()].flat().map((file) => file.absolutePath));
        expect(files.some((file) => existing.has(file.absolutePath))).toBe(false);
        const row = create(data);
        members.set(row.id, files);
        return Promise.resolve(row);
      }),
    };
    const config = { get: (key: string) => (key === 'storage.bookDockPath' ? root : undefined) };
    // Discovery runs while the metadata queue remains paused to avoid unrelated provider work.
    const processing = { isPaused: () => Promise.resolve(paused), getCachedPaused: () => true };
    const gateway = { emitChanged: vi.fn() };
    module = await Test.createTestingModule({
      providers: [
        {
          provide: BookDockIngestService,
          useFactory: () =>
            new BookDockIngestService(
              config as never,
              repo as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              processing as never,
              gateway as never,
            ),
        },
        {
          provide: BookDockWatcherService,
          inject: [BookDockIngestService],
          useFactory: (ingest: BookDockIngestService) =>
            new BookDockWatcherService(config as never, ingest, repo as never, gateway as never, processing as never),
        },
      ],
    }).compile();
    watcher = module.get(BookDockWatcherService);
  });

  afterEach(async () => {
    await module?.close();
    await rm(root, { recursive: true, force: true });
    vi.mocked(waitForDirectoryStability).mockReset().mockResolvedValue(undefined);
  });

  it('rescans nested ebooks and audiobooks alongside root files, without duplicates', async () => {
    const expected = ['root.epub', 'ebooks/Author/Title/book.epub', 'audiobooks/Author/Title/book.m4b'];
    for (const path of expected) await put(path);
    await watcher.rescan();
    await watcher.rescan();
    expect(paths()).toEqual(expected.sort());
  });

  it('discovers nested books at startup and through debounced file events', async () => {
    await put('ebooks/Author/First/first.epub');
    await watcher.onApplicationBootstrap();
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Author/First/first.epub']);
    const second = await put('ebooks/Author/Second/second.epub');
    events.emit('all', 'add', second);
    await vi.waitFor(() => expect(paths()).toContain('ebooks/Author/Second/second.epub'), { timeout: 2500 });
  });

  it('groups nested multidisc tracks once and preserves covers and playback order', async () => {
    const book = 'audiobooks/Author/Title';
    for (const path of ['CD 1/01.mp3', 'CD 1/02.mp3', 'CD 2/01.mp3', 'cover.jpg']) await put(`${book}/${path}`);
    await watcher.rescan();
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(contentPaths(rows[0].id)).toEqual([`${book}/CD 1/01.mp3`, `${book}/CD 1/02.mp3`, `${book}/CD 2/01.mp3`]);
    expect(members.get(rows[0].id)?.map((file) => file.sortOrder)).toEqual([0, 1, 2, null]);
    expect(rows[0].unitDirectory).toBe(join(root, book));
  });

  it('discovers new siblings and nested books despite an existing watched directory claim', async () => {
    await put('ebooks/first.epub');
    await watcher.rescan();
    const originalId = rows[0].id;
    expect(rows[0].unitDirectory).toBe(join(root, 'ebooks'));
    await put('ebooks/second.epub');
    await put('ebooks/Author/third.epub');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Author/third.epub', 'ebooks/first.epub', 'ebooks/second.epub']);
    expect(rows.find((row) => row.id === originalId)?.unitDirectory).toBe(join(root, 'ebooks'));
    expect(rows.find((row) => row.fileName === 'second.epub')?.unitDirectory).toBeNull();
  });

  it('preserves stem-folded audio and discovers unrelated children of the same directory', async () => {
    for (const path of ['Title/book.epub', 'Title/book/01.mp3', 'Title/book/02.mp3', 'Title/book/Other/other.epub']) await put(path);
    await watcher.rescan();
    await watcher.rescan();
    expect(paths()).toEqual(['Title/book.epub', 'Title/book/01.mp3', 'Title/book/Other/other.epub']);
    const audio = rows.find((row) => row.format === 'mp3')!;
    expect(contentPaths(audio.id)).toEqual(['Title/book/01.mp3', 'Title/book/02.mp3']);
  });

  it('keeps comic issues separate and alternative ebook formats together', async () => {
    for (const path of ['comics/Series/Issue 001.cbz', 'comics/Series/Issue 002.cbz', 'ebooks/Title/book.epub', 'ebooks/Title/book.mobi'])
      await put(path);
    await watcher.rescan();
    expect(rows).toHaveLength(3);
    const ebook = rows.find((row) => row.format === 'epub')!;
    expect(contentPaths(ebook.id)).toEqual(['ebooks/Title/book.epub', 'ebooks/Title/book.mobi']);
  });

  it('does not descend into request-import claims or capture partial request files', async () => {
    const path = await put('request-book/CD 1/01.mp3');
    create({ fileName: '01.mp3', absolutePath: path, unitDirectory: join(root, 'request-book'), autoFinalizeSuppressed: true });
    await put('request-book/CD 2/01.mp3');
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(waitForDirectoryStability).not.toHaveBeenCalled();
  });

  it('rechecks a request claim acquired while waiting for stability', async () => {
    const path = await put('request-book/CD 1/01.mp3');
    await put('request-book/CD 2/01.mp3');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(() => {
      create({ fileName: '01.mp3', absolutePath: path, unitDirectory: join(root, 'request-book'), autoFinalizeSuppressed: true });
      return Promise.resolve();
    });
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(members.size).toBe(0);
  });

  it('rereads a growing audiobook after settling and serializes concurrent rescans', async () => {
    await put('Audio/01.mp3');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(async () => {
      await put('Audio/02.mp3');
    });
    await Promise.all([watcher.rescan(), watcher.rescan()]);
    expect(rows).toHaveLength(1);
    expect(contentPaths(rows[0].id)).toEqual(['Audio/01.mp3', 'Audio/02.mp3']);
  });

  it('stops before ingestion when paused during settling and recovers on rescan', async () => {
    await put('ebooks/Title/book.epub');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(() => {
      paused = true;
      return Promise.resolve();
    });
    await watcher.rescan();
    expect(rows).toHaveLength(0);
    paused = false;
    await watcher.rescan();
    expect(rows).toHaveLength(1);
  });

  it('stops between book folders during shutdown and permits a later manual rescan', async () => {
    await put('First/book.epub');
    await put('Second/book.epub');
    let release!: () => void;
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scanning = watcher.rescan();
    await vi.waitFor(() => expect(waitForDirectoryStability).toHaveBeenCalledTimes(1));
    const stopping = watcher.onModuleDestroy();
    release();
    await Promise.all([scanning, stopping]);
    expect(rows).toHaveLength(1);
    await watcher.rescan();
    expect(rows).toHaveLength(2);
  });

  it('retains events arriving during discovery without creating duplicate rows', async () => {
    await watcher.onApplicationBootstrap();
    await watcher.rescan();
    const first = await put('ebooks/first.epub');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(async () => {
      const second = await put('ebooks/Author/second.epub');
      events.emit('all', 'add', second);
    });
    events.emit('all', 'add', first);
    await watcher.rescan();
    await vi.waitFor(() => expect(paths()).toEqual(['ebooks/Author/second.epub', 'ebooks/first.epub']), { timeout: 2500 });
    await watcher.rescan();
    expect(rows).toHaveLength(2);
  });

  it('applies the release limit per folder, not to the entire category tree', async () => {
    const books = Array.from({ length: 2002 }, (_, index) => `ebooks/Author-${index % 2}/Book-${index}.epub`);
    for (let offset = 0; offset < books.length; offset += 50) {
      await Promise.all(books.slice(offset, offset + 50).map(put));
    }
    await watcher.rescan();
    expect(paths()).toEqual(books.sort());
  });

  it('refuses an oversized audiobook without importing its discs as partial books', async () => {
    const tracks = Array.from({ length: 2001 }, (_, index) => `Audio/CD 1/${index}.mp3`);
    for (let offset = 0; offset < tracks.length; offset += 50) {
      await Promise.all(tracks.slice(offset, offset + 50).map(put));
    }
    await put('ebooks/Title/book.epub');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Title/book.epub']);
  });

  it('skips internal covers and symlinked trees but allows a nested book named covers', async () => {
    await put('covers/ignored.epub');
    await put('ebooks/covers/book.epub');
    await symlink(join(root, 'ebooks'), join(root, 'linked'), 'dir');
    await symlink(root, join(root, 'ebooks', 'loop'), 'dir');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/covers/book.epub']);
  });
});
