vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) };
});

import { mkdtemp, readFile, rm, writeFile, symlink, mkdir, stat, open } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { audiolessEpubConfig, storageConfig } from '../../config/config';
import { AudiolessEpubService } from './audioless-epub.service';
import { FileLockService } from '../file-write/file-lock.service';
import { DeliveryArtifactRepository } from './delivery-artifact.repository';
import { DeliveryArtifactService } from './delivery-artifact.service';

async function fixture(path: string, overlay: boolean, unsafe = false): Promise<void> {
  const archive = new ZipArchive();
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>', { name: 'META-INF/container.xml' });
  archive.append(
    `<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" ${overlay ? 'media-overlay="overlay"' : ''}/>${overlay ? '<item id="overlay" href="overlay.smil" media-type="application/smil+xml"/><item id="audio" href="audio.mp3" media-type="audio/mpeg"/>' : ''}</manifest><spine><itemref idref="chapter"/></spine></package>`,
    { name: 'OPS/book.opf' },
  );
  archive.append('<html><body><span id="sentence-1">Hello</span></body></html>', { name: 'OPS/chapter.xhtml' });
  if (overlay) {
    archive.append('<smil><body><par><text src="chapter.xhtml#sentence-1"/><audio src="audio.mp3"/></par></body></smil>', {
      name: 'OPS/overlay.smil',
    });
    archive.append(Buffer.alloc(4096, 7), { name: 'OPS/audio.mp3' });
  }
  if (unsafe) archive.append('bad', { name: '%2e%2e/escape' });
  const output = createWriteStream(path);
  archive.pipe(output);
  await Promise.all([
    archive.finalize(),
    new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    }),
  ]);
}

describe('DeliveryArtifactService', () => {
  let directory: string;
  let service: DeliveryArtifactService;
  let stripper: AudiolessEpubService;
  let repository: DeliveryArtifactRepository;
  let locks: FileLockService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'delivery-test-'));
    const module = await Test.createTestingModule({
      providers: [
        DeliveryArtifactService,
        FileLockService,
        {
          provide: DeliveryArtifactRepository,
          useValue: { findSourceRoot: vi.fn().mockResolvedValue(directory), findInspection: vi.fn(), saveInspection: vi.fn() },
        },
        AudiolessEpubService,
        { provide: storageConfig.KEY, useValue: { appDataPath: directory } },
        {
          provide: audiolessEpubConfig.KEY,
          useValue: { maxConcurrentBuilds: 2, maxSourceEntries: 100, maxMetadataBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024 },
        },
      ],
    }).compile();
    service = module.get(DeliveryArtifactService);
    stripper = module.get(AudiolessEpubService);
    repository = module.get(DeliveryArtifactRepository);
    locks = module.get(FileLockService);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('streams original bytes without invoking EPUB parsing or transformation', async () => {
    const path = join(directory, 'source.epub');
    await writeFile(path, 'original malformed publication');
    const spy = vi.spyOn(stripper, 'writeArchive');
    const artifact = await service.prepare({ id: 1, absolutePath: path, format: 'epub', mediaOverlayAvailable: true }, 'original');
    expect(artifact.path).toBe(path);
    expect(artifact.sha256).toBe(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    );
    expect(spy).not.toHaveBeenCalled();
    await artifact.release();
  });

  it('reinspects old negative detection, retains sentence anchors and deduplicates derivatives', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, true);
    const source = { id: 2, absolutePath: path, format: 'epub', mediaOverlayAvailable: false };
    const spy = vi.spyOn(stripper, 'writeArchive');
    const artifacts = await Promise.all([service.prepare(source, 'audioless_epub'), service.prepare(source, 'audioless_epub')]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(artifacts[0].sha256).toBe(artifacts[1].sha256);
    expect(artifacts[0].outcome).toBe('stripped');
    expect(artifacts[0].sizeBytes).toBeLessThan((await readFile(path)).length);
    const unzipper = await import('unzipper');
    const zip = await unzipper.Open.file(artifacts[0].path);
    expect(zip.files.some((file) => file.path.endsWith('.mp3'))).toBe(false);
    expect((await zip.files.find((file) => file.path.endsWith('.xhtml'))!.buffer()).toString()).toContain('id="sentence-1"');
    await Promise.all(artifacts.map((artifact) => artifact.release()));
  });

  it('plain EPUB text-only keeps exact bytes and distinguishes the requested policy', async () => {
    const path = join(directory, 'plain.epub');
    await fixture(path, false);
    const artifact = await service.prepare({ id: 3, absolutePath: path, format: 'epub' }, 'audioless_epub');
    expect(artifact.outcome).toBe('verified_plain');
    expect(artifact.actualVariant).toBe('original');
    expect(artifact.requestedVariant).toBe('audioless_epub');
    await artifact.release();
  });

  it('explicit text-only fails while inherited preparation preserves its original fallback', async () => {
    const path = join(directory, 'bad.epub');
    await writeFile(path, 'broken');
    const source = { id: 4, absolutePath: path, format: 'epub', mediaOverlayAvailable: true };
    await expect(service.prepare(source, 'audioless_epub')).rejects.toThrow();
    const inherited = await service.prepare(source, null);
    expect(inherited.outcome).toBe('legacy_fallback');
    await inherited.release();
  });

  it('rejects unsafe archive entries and detects a changed pinned source', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, true, true);
    const source = { id: 5, absolutePath: path, format: 'epub' };
    await expect(service.prepare(source, 'audioless_epub')).rejects.toThrow();
    const original = await service.prepare(source, 'original');
    await writeFile(path, 'replacement');
    await expect(service.prepare(source, 'original', original.sourceRevision)).rejects.toThrow();
    await original.release();
  });
  it('reuses a verified source hash while the file is unchanged and rehashes it after a write', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, false);
    const source = { id: 9, absolutePath: path, format: 'epub' };
    const first = await service.prepare(source, 'original');
    await first.release();
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    let fullReads = 0;
    vi.mocked(open).mockImplementation(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const createReadStream = handle.createReadStream.bind(handle);
      vi.spyOn(handle, 'createReadStream').mockImplementation((options) => {
        fullReads++;
        return createReadStream(options);
      });
      return handle;
    });
    try {
      const again = await service.prepare(source, 'original', first.sourceRevision);
      expect(again.sourceRevision).toBe(first.sourceRevision);
      await again.release();
      expect(fullReads).toBe(0);

      await writeFile(path, 'rewritten in place');
      await expect(service.prepare(source, 'original', first.sourceRevision)).rejects.toThrow();
      expect(fullReads).toBe(1);
    } finally {
      vi.mocked(open).mockImplementation(actual.open);
    }
  });

  it('detects external replacement from the recorded source stat', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, false);
    const info = await stat(path);
    await writeFile(path, 'external replacement');
    await expect(
      service.prepare({ id: 7, absolutePath: path, format: 'epub', mtime: new Date(Math.floor(info.mtimeMs)), sizeBytes: info.size }, 'original'),
    ).rejects.toThrow();
  });

  it('matches unchanged source inodes outside the safe integer range exactly', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, false);
    const info = await stat(path);
    const inode = 17237992710316634000n;
    vi.mocked(stat).mockResolvedValueOnce({ ...info, ino: Number(inode) } as typeof info);
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      const handle = await actual.open(...args);
      const actualStat = handle.stat.bind(handle);
      vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
        const result = await actualStat(options);
        return { ...result, ino: options?.bigint ? inode : Number(inode) } as typeof result;
      });
      return handle;
    });
    const artifact = await service.prepare(
      { id: 11, absolutePath: path, format: 'epub', mtime: new Date(Math.floor(info.mtimeMs)), sizeBytes: info.size, ino: inode },
      'original',
    );
    expect(artifact.actualVariant).toBe('original');
    await artifact.release();
  });

  it('refuses a cache root symlink and does not publish into its target', async () => {
    const target = join(directory, 'outside');
    await mkdir(target);
    await symlink(target, join(directory, '.delivery-cache'));
    const path = join(directory, 'source.epub');
    await fixture(path, true);
    await expect(service.prepare({ id: 8, absolutePath: path, format: 'epub' }, 'audioless_epub')).rejects.toThrow();
    await expect(stat(join(target, 'book.epub'))).rejects.toThrow();
  });

  it('backs off a failed inspection and reinspects a new source revision', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, true);
    const original = await service.prepare({ id: 9, absolutePath: path, format: 'epub' }, 'original');
    vi.mocked(repository.findInspection).mockResolvedValue({
      bookFileId: 9,
      sourceRevision: original.sourceRevision,
      detectorVersion: 'overlay-inspection-v3',
      state: 'failed',
      retryAt: new Date(Date.now() + 60_000),
      checkedAt: new Date(),
    });
    await expect(service.prepare({ id: 9, absolutePath: path, format: 'epub' }, 'audioless_epub')).rejects.toThrow();
    await fixture(path, false);
    const revised = await service.prepare({ id: 9, absolutePath: path, format: 'epub' }, 'audioless_epub');
    expect(revised.outcome).toBe('verified_plain');
    expect(repository.saveInspection).toHaveBeenCalledWith(expect.objectContaining({ state: 'verified_absent' }));
    await revised.release();
  });

  it('cancels a queued request and leaves capacity available for later work', async () => {
    const path = join(directory, 'source.epub');
    await fixture(path, false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(locks, 'withLock').mockImplementationOnce(async (_path, build) => {
      await gate;
      return build();
    });
    const source = { id: 10, absolutePath: path, format: 'epub' };
    const first = service.prepare(source, 'original');
    const second = service.prepare(source, 'original');
    const controller = new AbortController();
    const cancelled = service.prepare(source, 'original', undefined, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    release();
    const prepared = await Promise.all([first, second]);
    await Promise.all(prepared.map((artifact) => artifact.release()));
    await (await service.prepare(source, 'original')).release();
  });
});
