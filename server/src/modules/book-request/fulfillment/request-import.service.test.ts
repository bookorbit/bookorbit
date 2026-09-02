import { link, mkdir, mkdtemp, readdir, readFile, realpath, stat, symlink, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import { PathMappingService } from '../download-clients/path-mapping.service';
import { RequestImportService } from './request-import.service';

function request(overrides: Partial<BookRequestRow> = {}): BookRequestRow {
  return {
    id: 7,
    userId: 3,
    title: 'Dune',
    targetLibraryId: 2,
    targetFolderId: 5,
    ...overrides,
  } as BookRequestRow;
}

function download(contentPath: string, overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return { id: 11, requestId: 7, downloadClientId: 1, contentPath, ...overrides } as BookRequestDownloadRow;
}

async function makeHarness(options: { useHardlinks?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bookorbit-import-')));
  const bookDockPath = join(root, 'dock');
  const appDataPath = join(root, 'app-data');
  /** What a mapped download client declares, and what the import may therefore read out of. */
  const downloadsPath = join(root, 'downloads');
  /** Where a direct fetch stages, which is that download's own containment root. */
  const directDownloadsPath = join(appDataPath, 'request-downloads');
  await mkdir(bookDockPath, { recursive: true });
  await mkdir(downloadsPath, { recursive: true });
  await mkdir(directDownloadsPath, { recursive: true });

  let nextDockId = 100;
  const dockRepo = {
    create: vi.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve({ id: nextDockId++, ...data })),
    createUnit: vi.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve({ id: nextDockId++, ...data })),
    findUnitFiles: vi.fn().mockResolvedValue([]),
    deleteById: vi.fn().mockResolvedValue(undefined),
    findByAbsolutePath: vi.fn().mockResolvedValue(undefined),
    findByUnitDirectory: vi.fn().mockResolvedValue(undefined),
  };
  const downloads = {
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn(),
    findById: vi.fn().mockResolvedValue(undefined),
  };
  // Conditional like the repository it stands for, because the choice import claims the attempt
  // with it: a mock that always answers would let two passes both believe they hold the same one.
  downloads.updateIf.mockImplementation(async (id: number, expected: readonly string[], patch: Record<string, unknown>) => {
    const row = (await downloads.findById(id)) as { status: string } | undefined;
    return row && expected.includes(row.status) ? { ...row, ...patch } : undefined;
  });
  const requests = {
    findById: vi.fn().mockResolvedValue({ request: request() }),
    findRequestViewerIds: vi.fn().mockResolvedValue(new Map([[7, [3]]])),
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
  };
  const gateway = { emitProgress: vi.fn(), emitChanged: vi.fn() };
  const fulfillment = { failDownload: vi.fn().mockResolvedValue(undefined), holdForReview: vi.fn().mockResolvedValue(undefined) };
  const dockIngest = { ingestFromWatchedFolder: vi.fn().mockResolvedValue(null) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const removal = { cleanupStagedDirectDownload: vi.fn().mockResolvedValue(undefined) };
  // The real containment check over a stubbed mapping, so these tests exercise the boundary the
  // importer actually applies rather than a mock that always agrees with it.
  const pathMappings = new PathMappingService({
    findPathMappings: vi.fn().mockResolvedValue([{ remotePath: downloadsPath, localPath: downloadsPath }]),
  } as never);

  const service = new RequestImportService(
    { getOrThrow: (key: string) => (key === 'storage.appDataPath' ? appDataPath : bookDockPath) } as never,
    downloads as never,
    requests as never,
    gateway as never,
    { useHardlinks: vi.fn().mockResolvedValue(options.useHardlinks ?? true) } as never,
    pathMappings as never,
    dockRepo as never,
    dockIngest as never,
    { sanitizeFilename: (name: string) => name } as never,
    fulfillment as never,
    removal as never,
    audit as never,
  );
  await service.onApplicationBootstrap();

  return {
    service,
    dockRepo,
    downloads,
    requests,
    gateway,
    fulfillment,
    dockIngest,
    audit,
    removal,
    bookDockPath,
    appDataPath,
    downloadsPath,
    directDownloadsPath,
  };
}

/** A store-method zip, built inline so the fixture is bytes rather than a checked-in binary. */
function zipOf(entries: Array<{ name: string; contents: string | Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
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

async function makeFile(dir: string, name: string, contents = 'book'): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

describe('RequestImportService.importDownload', () => {
  it('creates the dock row before linking, carrying the request destination and uploader', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await expect(harness.service.importDownload(download(source))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLibraryId: 2,
        targetFolderId: 5,
        uploadedBy: 3,
        status: 'pending',
        format: 'epub',
        // Generic auto-finalize must skip this row: the request module verifies before filing.
        autoFinalizeSuppressed: true,
        // A lone book file is still the loose single file the dock has always handled.
        unitDirectory: null,
      }),
      [],
    );
    expect(harness.fulfillment.failDownload).not.toHaveBeenCalled();
  });

  it('hardlinks rather than copying, so the torrent keeps seeding from the same bytes', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await harness.service.importDownload(download(source));

    const dest = join(harness.bookDockPath, 'request-7-dune.epub');
    const [sourceStat, destStat] = await Promise.all([stat(source), stat(dest)]);
    expect(destStat.ino).toBe(sourceStat.ino);
    expect(destStat.nlink).toBe(2);
  });

  it('copies instead when the client has hardlinks turned off', async () => {
    const harness = await makeHarness({ useHardlinks: false });
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await harness.service.importDownload(download(source));

    const dest = join(harness.bookDockPath, 'request-7-dune.epub');
    const [sourceStat, destStat] = await Promise.all([stat(source), stat(dest)]);
    expect(destStat.ino).not.toBe(sourceStat.ino);
    expect(await readFile(dest, 'utf8')).toBe('book');
  });

  it('cleans direct-download staging after the Book Dock copy is safely in place', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.directDownloadsPath, 'abc123'), 'dune.epub');
    const direct = download(source, { source: 'direct_url' });

    await harness.service.importDownload(direct);

    expect(harness.removal.cleanupStagedDirectDownload).toHaveBeenCalledWith(direct);
    expect(await readFile(join(harness.bookDockPath, 'request-7-dune.epub'), 'utf8')).toBe('book');
  });

  /**
   * The claim has to be written before the file is placed. It is what stops the monitor's resume
   * sweep linking the same download a second time, and it has to survive a crash mid-link.
   */
  it('claims the dock row on the download before placing the file', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    const order: string[] = [];
    harness.downloads.update.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(undefined);
    });
    harness.dockRepo.createUnit.mockImplementation((data: Record<string, unknown>) => {
      order.push('dock-row');
      return Promise.resolve({ id: 100, ...data });
    });

    await harness.service.importDownload(download(source));

    expect(order).toEqual(['dock-row', 'claim']);
    expect(harness.downloads.update).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'importing', bookDockFileId: 100 }));
  });

  /**
   * Downloading and extracting a release takes minutes, and a cancellation or a manual fulfilment
   * landing inside them is a decision a person made. The import is what would silently undo it,
   * by filing a book against a request nobody wants and handing the dock a row with no owner.
   */
  describe('a request settled while the download was finishing', () => {
    async function settledHarness() {
      const harness = await makeHarness();
      const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
      harness.requests.updateIf.mockResolvedValue(undefined);
      return { harness, source };
    }

    it('leaves no dock row behind and places no file', async () => {
      const { harness, source } = await settledHarness();

      await harness.service.importDownload(download(source));

      expect(harness.dockRepo.deleteById).toHaveBeenCalledWith(100);
      expect(harness.dockIngest.ingestFromWatchedFolder).not.toHaveBeenCalled();
      await expect(readFile(join(harness.bookDockPath, 'request-7-dune.epub'), 'utf8')).rejects.toThrow();
    });

    /** Otherwise the resume sweep picks the same download up again every fifteen seconds. */
    it('settles the attempt so nothing resumes it', async () => {
      const { harness, source } = await settledHarness();

      await harness.service.importDownload(download(source));

      expect(harness.downloads.updateIf).toHaveBeenCalledWith(11, expect.anything(), expect.objectContaining({ status: 'failed' }));
      expect(harness.downloads.update).not.toHaveBeenCalledWith(11, expect.objectContaining({ status: 'importing' }));
    });

    /** Nothing went wrong with the download, so nobody is told one did. */
    it('does not report it as a download failure', async () => {
      const { harness, source } = await settledHarness();

      await expect(harness.service.importDownload(download(source))).resolves.toBe(true);
      expect(harness.fulfillment.failDownload).not.toHaveBeenCalled();
    });
  });

  it('announces the importing transition after both persisted rows have moved', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    const attempt = download(source, { progressPercent: 100, downloadedBytes: 4, totalBytes: 4 });
    const order: string[] = [];
    harness.downloads.update.mockImplementation(() => {
      order.push('download');
      return Promise.resolve(undefined);
    });
    harness.requests.updateIf.mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => {
      order.push('request');
      return Promise.resolve({ id, ...patch });
    });
    harness.gateway.emitProgress.mockImplementation(() => {
      order.push('progress');
    });
    harness.gateway.emitChanged.mockImplementation(() => {
      order.push('changed');
    });

    await harness.service.importDownload(attempt);

    expect(harness.gateway.emitProgress).toHaveBeenCalledWith(
      {
        requestId: 7,
        downloadId: 11,
        status: 'importing',
        progressPercent: 100,
        downloadedBytes: 4,
        totalBytes: 4,
      },
      [3],
    );
    expect(order.slice(0, 4)).toEqual(['request', 'download', 'progress', 'changed']);
  });

  /** Nobody clicked anything, so the actor is the instance rather than the requester. */
  it('records the import in the audit trail as a system action', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await harness.service.importDownload(download(source));

    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, actorUsername: 'system', resourceId: 7, action: 'book_request.import' }),
    );
  });

  /** A book that landed has landed whether or not the audit write went through. */
  it('does not fail the import when the audit write does', async () => {
    const harness = await makeHarness();
    harness.audit.record.mockRejectedValue(new Error('audit down'));
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await expect(harness.service.importDownload(download(source))).resolves.toBe(true);
  });

  /** The artwork and the sidecar travel with the book now instead of being left behind. */
  it('keeps a release folder together as one unit, anchored on its book file', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'Dune-release');
    await makeFile(folder, 'dune.epub');
    await makeFile(folder, 'cover.jpg');
    await makeFile(folder, 'release.nfo');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    const unitDirectory = join(harness.bookDockPath, 'request-7-Dune-release');
    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'dune.epub', absolutePath: join(unitDirectory, 'dune.epub'), unitDirectory }),
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'dune.epub', role: 'content', sortOrder: 0 }),
        expect.objectContaining({ fileName: 'cover.jpg', role: 'cover', sortOrder: null }),
        expect.objectContaining({ fileName: 'release.nfo', role: 'metadata', sortOrder: null }),
      ]),
    );
    expect((await readdir(unitDirectory)).sort()).toEqual(['cover.jpg', 'dune.epub', 'release.nfo']);
  });

  it('imports a multipart audiobook as one ordered unit', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'audiobook');
    await makeFile(folder, 'track-01.mp3');
    await makeFile(folder, 'track-02.mp3');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    const unitDirectory = join(harness.bookDockPath, 'request-7-audiobook');
    // The anchor row describes the primary file, so metadata extraction reads one track, not 31.
    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'track-01.mp3', unitDirectory }), [
      expect.objectContaining({ fileName: 'track-01.mp3', sortOrder: 0 }),
      expect.objectContaining({ fileName: 'track-02.mp3', sortOrder: 1 }),
    ]);
    expect((await readdir(unitDirectory)).sort()).toEqual(['track-01.mp3', 'track-02.mp3']);
  });

  /**
   * Every member flattened to its basename, so both discs wanted `track01.mp3` and the dock's
   * unique `absolute_path` rejected the second before a single file had been placed.
   */
  it('imports a two-disc audiobook without collapsing the discs onto each other', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'Neuromancer');
    await makeFile(join(folder, 'CD 1'), 'track01.mp3');
    await makeFile(join(folder, 'CD 1'), 'track02.mp3');
    await makeFile(join(folder, 'CD 2'), 'track01.mp3');
    await makeFile(join(folder, 'CD 2'), 'track02.mp3');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    const unitDirectory = join(harness.bookDockPath, 'request-7-Neuromancer');
    const [, children] = harness.dockRepo.createUnit.mock.calls[0] as [unknown, Array<{ absolutePath: string; sortOrder: number | null }>];
    const paths = children.map((child) => child.absolutePath);
    expect(new Set(paths).size).toBe(4);
    expect(children.filter((child) => child.sortOrder !== null).map((child) => child.absolutePath)).toEqual([
      join(unitDirectory, 'CD 1', 'track01.mp3'),
      join(unitDirectory, 'CD 1', 'track02.mp3'),
      join(unitDirectory, 'CD 2', 'track01.mp3'),
      join(unitDirectory, 'CD 2', 'track02.mp3'),
    ]);
    expect((await readdir(join(unitDirectory, 'CD 1'))).sort()).toEqual(['track01.mp3', 'track02.mp3']);
    expect((await readdir(join(unitDirectory, 'CD 2'))).sort()).toEqual(['track01.mp3', 'track02.mp3']);
  });

  /** A part-placed unit is worse than no unit: retry only after taking back what this pass linked. */
  it('retries a part-placed unit without deleting the file that caused the collision', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'audiobook');
    await makeFile(folder, 'track-01.mp3');
    await makeFile(folder, 'track-02.mp3');
    // The second link fails: the directory exists, and track one is already in it.
    harness.dockRepo.createUnit.mockImplementationOnce(async (data: Record<string, unknown>) => {
      await mkdir(join(harness.bookDockPath, 'request-7-audiobook'), { recursive: true });
      await writeFile(join(harness.bookDockPath, 'request-7-audiobook', 'track-02.mp3'), 'in the way');
      return { id: 100, ...data };
    });

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);
    expect(await readdir(join(harness.bookDockPath, 'request-7-audiobook'))).toEqual(['track-02.mp3']);
    expect(await readFile(join(harness.bookDockPath, 'request-7-audiobook', 'track-02.mp3'), 'utf8')).toBe('in the way');
    expect((await readdir(join(harness.bookDockPath, 'request-7-audiobook-2'))).sort()).toEqual(['track-01.mp3', 'track-02.mp3']);
  });

  /**
   * The download is finished by now, so failing would throw away the bytes over a question. It
   * waits with the list instead, and nothing is linked until someone answers.
   */
  it('holds a release carrying several distinct books for someone to choose between them', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'series-pack');
    await makeFile(folder, 'Mort.epub');
    await makeFile(folder, 'Small Gods.epub');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.fulfillment.failDownload).not.toHaveBeenCalled();
    expect(harness.dockRepo.createUnit).not.toHaveBeenCalled();
    expect(harness.fulfillment.holdForReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 7 }),
      'this release contains 2 separate books, so one has to be chosen',
      { releaseUnits: [expect.objectContaining({ index: 0, title: 'Mort' }), expect.objectContaining({ index: 1, title: 'Small Gods' })] },
    );
  });

  /**
   * The walk gave up silently, so a directory deeper than the ceiling looked exactly like a
   * complete release with fewer files in it. The request would go available on half a book.
   */
  it('holds a release whose directory tree runs past the depth the walk reads', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'deep');
    await makeFile(join(folder, 'a', 'b', 'c', 'd', 'e'), 'Dune.epub');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).not.toHaveBeenCalled();
    expect(harness.fulfillment.failDownload).not.toHaveBeenCalled();
    expect(harness.fulfillment.holdForReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 7 }),
      expect.stringContaining('deeper or larger than BookOrbit reads'),
    );
  });

  it('holds a release carrying more entries than the walk reads', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'wide');
    await makeFile(folder, 'Dune.epub');
    await Promise.all(Array.from({ length: 2_001 }, (_, index) => makeFile(folder, `pad-${index}.txt`)));

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).not.toHaveBeenCalled();
    expect(harness.fulfillment.holdForReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 7 }),
      expect.stringContaining('deeper or larger than BookOrbit reads'),
    );
  });

  /** An ordinary release inside both bounds is untouched by any of that. */
  it('imports a release that fits inside the walk bounds exactly as before', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'ordinary');
    await makeFile(join(folder, 'Book'), 'Dune.epub');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.fulfillment.holdForReview).not.toHaveBeenCalled();
    expect(harness.dockRepo.createUnit).toHaveBeenCalled();
  });

  /** The request's own media kind answers the question without anyone being asked. */
  it('picks the unit matching the request media kind without holding for a choice', async () => {
    const harness = await makeHarness();
    harness.requests.findById.mockResolvedValue({ request: request({ mediaKind: 'audiobook' }) });
    const folder = join(harness.bookDockPath, '..', 'downloads', 'mixed');
    await makeFile(folder, 'Dune.epub');
    await makeFile(folder, 'Dune.m4b');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.fulfillment.holdForReview).not.toHaveBeenCalled();
    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ format: 'm4b' }), []);
  });

  describe('importChosenUnit', () => {
    async function heldHarness() {
      const harness = await makeHarness();
      const folder = join(harness.bookDockPath, '..', 'downloads', 'series-pack');
      await makeFile(folder, 'Mort.epub');
      await makeFile(folder, 'Small Gods.epub');
      await harness.service.importDownload(download(folder));

      const held = download(folder, {
        status: 'needs_review',
        releaseUnits: harness.fulfillment.holdForReview.mock.calls[0][3].releaseUnits,
      });
      harness.downloads.findById.mockResolvedValue(held);
      return { harness, folder, held };
    }

    it('imports the book that was chosen and leaves the others behind', async () => {
      const { harness } = await heldHarness();

      await harness.service.importChosenUnit(7, 11, 1);

      expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'request-7-Small Gods.epub' }), []);
    });

    it('refuses an index that is not one of the books on offer', async () => {
      const { harness } = await heldHarness();

      await expect(harness.service.importChosenUnit(7, 11, 9)).rejects.toMatchObject({ status: 400 });
      expect(harness.dockRepo.createUnit).not.toHaveBeenCalled();
    });

    it('refuses a download that is not waiting on a choice', async () => {
      const harness = await makeHarness();
      harness.downloads.findById.mockResolvedValue(download('/somewhere', { status: 'imported' }));

      await expect(harness.service.importChosenUnit(7, 11, 0)).rejects.toMatchObject({ status: 400 });
    });

    /**
     * Two clicks inside the extraction window. The read the guard does cannot separate them - both
     * see `needs_review` - so the attempt is claimed instead, and the loser places nothing rather
     * than filing the book a second time under a second dock row.
     */
    it('claims the attempt so a second submission cannot import it again', async () => {
      const { harness, held } = await heldHarness();
      harness.downloads.updateIf.mockResolvedValueOnce({ ...held, status: 'importing' }).mockResolvedValueOnce(undefined);

      const [first, second] = await Promise.allSettled([harness.service.importChosenUnit(7, 11, 1), harness.service.importChosenUnit(7, 11, 1)]);

      expect(harness.downloads.updateIf).toHaveBeenCalledWith(11, ['needs_review'], { status: 'importing' });
      expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
      expect(harness.dockRepo.createUnit).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Naming a free destination is check-then-act against a unique column, so the loser of a race
   * for one name takes the next rather than failing an import a different file name satisfies.
   */
  it('takes the next free name when another import claimed the one it picked', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    harness.dockRepo.createUnit.mockRejectedValueOnce(
      new Error('Failed query', { cause: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) }),
    );

    await expect(harness.service.importDownload(download(source))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).toHaveBeenCalledTimes(2);
    expect(harness.dockRepo.createUnit).toHaveBeenLastCalledWith(expect.objectContaining({ fileName: 'request-7-dune-2.epub' }), []);
  });

  it('takes the next free name on EEXIST without deleting the file that won the race', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    const collided = join(harness.bookDockPath, 'request-7-dune.epub');
    harness.dockRepo.createUnit.mockImplementationOnce(async (data: Record<string, unknown>) => {
      await writeFile(collided, 'other import');
      return { id: 100, ...data };
    });

    await expect(harness.service.importDownload(download(source))).resolves.toBe(true);

    expect(await readFile(collided, 'utf8')).toBe('other import');
    expect(await readFile(join(harness.bookDockPath, 'request-7-dune-2.epub'), 'utf8')).toBe('book');
    expect(harness.dockRepo.createUnit).toHaveBeenCalledTimes(2);
  });

  it('gives up on a database failure that is not a name collision', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    harness.dockRepo.createUnit.mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '57P01' }));

    await expect(harness.service.importDownload(download(source))).resolves.toBe(false);
    expect(harness.dockRepo.createUnit).toHaveBeenCalledTimes(1);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('connection terminated'));
  });

  /** The sample is the whole reason this release was refused before, and it is not a second book. */
  it('imports a book that travels with a sample directory', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'with-sample');
    await makeFile(folder, 'dune.epub');
    await makeFile(join(folder, 'Sample'), 'preview.pdf');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);
    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'request-7-dune.epub', unitDirectory: null }), []);
  });

  /** RAR packaging is normal on private trackers, so a broken one must say what is actually wrong. */
  it('reports why an archive could not be opened rather than claiming it holds no book', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'packed');
    await makeFile(folder, 'dune.rar', 'not really a rar');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(false);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('RAR file could not be read'));
  });

  it('extracts a zipped release and imports the book inside it', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'packed-zip');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'Dune.zip'), zipOf([{ name: 'Dune.epub', contents: 'book bytes' }]));

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'request-7-Dune.epub' }), []);
    expect(await readFile(join(harness.bookDockPath, 'request-7-Dune.epub'), 'utf8')).toBe('book bytes');
  });

  /** Extraction is staging-only: writing into the download would corrupt what is still seeding. */
  it('leaves the downloaded archive untouched and clears its staging afterwards', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'packed-seeding');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'Dune.zip'), zipOf([{ name: 'Dune.epub', contents: 'book bytes' }]));

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(await readdir(folder)).toEqual(['Dune.zip']);
    expect(await readdir(join(harness.appDataPath, 'tmp', 'release-extract'))).toEqual([]);
  });

  /**
   * Scene ebook packaging: a zip holding a rar holding the book. One extraction pass stops on the
   * rar, which used to surface as "contains no supported book file" - a release full of books.
   */
  it('unwraps a zip holding an archive to reach the book inside', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'scene');
    await mkdir(folder, { recursive: true });
    // A nested zip stands in for the rar: the nesting is what is under test, not the format.
    const inner = zipOf([{ name: 'Dune.epub', contents: 'book bytes' }]);
    await writeFile(join(folder, 'lc000oaa.zip'), zipOf([{ name: 'lc000oal.zip', contents: inner }]));
    await writeFile(join(folder, 'libricide.nfo'), 'release notes');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);

    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'request-7-Dune.epub' }), []);
    expect(await readFile(join(harness.bookDockPath, 'request-7-Dune.epub'), 'utf8')).toBe('book bytes');
  });

  /** Two levels is packaging. Deeper is a nested-archive bomb, and it says so. */
  it('refuses an archive nested deeper than it will unwrap', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'matryoshka');
    await mkdir(folder, { recursive: true });
    const level3 = zipOf([{ name: 'Dune.epub', contents: 'book bytes' }]);
    const level2 = zipOf([{ name: 'c.zip', contents: level3 }]);
    await writeFile(join(folder, 'a.zip'), zipOf([{ name: 'b.zip', contents: level2 }]));

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(false);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(
      expect.anything(),
      'The download is an archive nested deeper than BookOrbit will unwrap',
    );
  });

  /** A .cbz is a zip, and treating it as packaging would unpack a comic into loose images. */
  it('imports a comic archive as a book rather than extracting it', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'comic');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'Saga 001.cbz'), zipOf([{ name: '01.jpg', contents: 'page' }]));

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(true);
    expect(harness.dockRepo.createUnit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'request-7-Saga 001.cbz', format: 'cbz' }), []);
  });

  it('rejects a release with no supported book file', async () => {
    const harness = await makeHarness();
    const folder = join(harness.bookDockPath, '..', 'downloads', 'junk');
    await makeFile(folder, 'readme.txt');

    await expect(harness.service.importDownload(download(folder))).resolves.toBe(false);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('no supported book file'));
  });

  it('gives a retry of the same request a fresh destination rather than colliding', async () => {
    const harness = await makeHarness();
    const first = await makeFile(join(harness.downloadsPath, 'first'), 'dune.epub');
    const second = await makeFile(join(harness.downloadsPath, 'second'), 'dune.epub');

    await harness.service.importDownload(download(first));
    await harness.service.importDownload(download(second, { id: 12 }));

    const names = (await readdir(harness.bookDockPath)).sort();
    expect(names).toEqual(['request-7-dune-2.epub', 'request-7-dune.epub']);
  });

  it('avoids a destination another dock row already claims, even if the file is gone', async () => {
    const harness = await makeHarness();
    harness.dockRepo.findByAbsolutePath.mockImplementation((path: string) =>
      Promise.resolve(basename(path) === 'request-7-dune.epub' ? { id: 1 } : undefined),
    );
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await harness.service.importDownload(download(source));
    expect(await readdir(harness.bookDockPath)).toEqual(['request-7-dune-2.epub']);
  });

  it('removes the reserved dock row when the link fails, leaving no entry pointing at nothing', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');
    // Occupy the destination behind the uniqueness check so `link` throws EEXIST.
    harness.dockRepo.createUnit.mockImplementation(async (data: Record<string, unknown>) => {
      await link(source, data.absolutePath as string);
      return { id: 100, ...data };
    });

    await expect(harness.service.importDownload(download(source))).resolves.toBe(false);
    expect(harness.dockRepo.deleteById).toHaveBeenCalledWith(100);
    expect(harness.fulfillment.failDownload).toHaveBeenCalled();
  });

  it('queues the dock row itself, so a watcher that failed to start does not strand the import', async () => {
    const harness = await makeHarness();
    const source = await makeFile(join(harness.bookDockPath, '..', 'downloads'), 'dune.epub');

    await harness.service.importDownload(download(source));

    expect(harness.dockIngest.ingestFromWatchedFolder).toHaveBeenCalledWith(join(harness.bookDockPath, 'request-7-dune.epub'));
    expect(harness.downloads.update).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'importing', bookDockFileId: 100 }));
    expect(harness.requests.updateIf).toHaveBeenCalledWith(
      7,
      expect.anything(),
      expect.objectContaining({ status: 'importing', bookDockFileId: 100 }),
    );
  });

  it('fails the attempt when the client reported no content path', async () => {
    const harness = await makeHarness();
    await expect(harness.service.importDownload(download('', { contentPath: null }))).resolves.toBe(false);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('did not report'));
  });
});

/**
 * A download client is a network peer that reports a string. Nothing above this point re-reads
 * that string against the directory the operator declared, so this is where the boundary is.
 */
describe('RequestImportService containment', () => {
  it('refuses a path the client reported outside its declared root, before any file is read', async () => {
    const harness = await makeHarness();
    const outside = await makeFile(join(harness.appDataPath, '..', 'elsewhere'), 'secret.epub');

    await expect(harness.service.importDownload(download(outside))).resolves.toBe(false);

    expect(harness.dockRepo.createUnit).not.toHaveBeenCalled();
    expect(await readdir(harness.bookDockPath)).toEqual([]);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('No path mapping covers'));
  });

  /** The walk skips symlinks, so this is the one the client itself points the import at. */
  it('refuses a symlink planted inside the download directory that points out of it', async () => {
    const harness = await makeHarness();
    const outside = await makeFile(join(harness.appDataPath, '..', 'elsewhere'), 'secret.epub');
    const planted = join(harness.downloadsPath, 'dune.epub');
    await symlink(outside, planted);

    await expect(harness.service.importDownload(download(planted))).resolves.toBe(false);

    expect(await readdir(harness.bookDockPath)).toEqual([]);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('resolves outside'));
  });

  /**
   * The torrent client is still writing into that directory while the plan is being built, so the
   * check that matters is the one immediately before the link, not the one when the walk ran.
   */
  it('refuses a file swapped for a symlink between planning the placement and linking it', async () => {
    const harness = await makeHarness();
    const source = await makeFile(harness.downloadsPath, 'dune.epub');
    const outside = await makeFile(join(harness.appDataPath, '..', 'elsewhere'), 'secret.epub');
    // `createUnit` runs after the placement is planned and before any file is placed.
    harness.dockRepo.createUnit.mockImplementation(async (data: Record<string, unknown>) => {
      await unlink(source);
      await symlink(outside, source);
      return { id: 100, ...data };
    });

    await expect(harness.service.importDownload(download(source))).resolves.toBe(false);

    expect(harness.dockRepo.deleteById).toHaveBeenCalledWith(100);
    expect(await readdir(harness.bookDockPath)).toEqual([]);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('outside the directory it was downloaded into'),
    );
  });

  /** A direct fetch has no client and no mapping, so its staging directory is its own root. */
  it('refuses a direct download that reports a path outside the staging root', async () => {
    const harness = await makeHarness();
    const outside = await makeFile(join(harness.appDataPath, '..', 'elsewhere'), 'secret.epub');

    await expect(harness.service.importDownload(download(outside, { source: 'direct_url' }))).resolves.toBe(false);

    expect(await readdir(harness.bookDockPath)).toEqual([]);
    expect(harness.fulfillment.failDownload).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('outside the directory it was downloaded into'),
    );
  });

  /** The single-host install, where the mapping is an identity, still imports exactly as before. */
  it('imports normally through an identity mapping', async () => {
    const harness = await makeHarness();
    const source = await makeFile(harness.downloadsPath, 'dune.epub');

    await expect(harness.service.importDownload(download(source))).resolves.toBe(true);
    expect(await readFile(join(harness.bookDockPath, 'request-7-dune.epub'), 'utf8')).toBe('book');
  });
});
