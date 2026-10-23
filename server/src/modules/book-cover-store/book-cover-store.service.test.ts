import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import { bookCoverDirPath, bookCoverSlotDirPath } from '../../common/book-cover-storage';
import type { BookCoverContext, BookCoverSlotRow } from './book-cover-store.repository';
import { BookCoverStore } from './book-cover-store.service';

function slot(medium: 'ebook' | 'audio', source: 'extracted' | 'custom' = 'extracted'): BookCoverSlotRow {
  return {
    bookId: 7,
    medium,
    source,
    origin: 'embedded',
    width: null,
    height: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    dormantSince: null,
  };
}

function context(overrides: Partial<BookCoverContext> = {}): BookCoverContext {
  return {
    bookId: 7,
    libraryId: 3,
    coverAspectRatio: '2/3',
    primaryFileId: 70,
    coverSource: 'extracted',
    coverUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lockedFields: [],
    media: { hasEbook: true, hasAudio: true },
    files: [
      { id: 70, format: 'epub', role: 'content', mediaOverlayAvailable: false },
      { id: 71, format: 'm4b', role: 'content', mediaOverlayAvailable: false },
    ],
    slots: [slot('ebook'), slot('audio')],
    ...overrides,
  };
}

async function image(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
}

function makeStore(root: string, current: BookCoverContext) {
  const repository = {
    findContext: vi.fn().mockResolvedValue(current),
    slotsFor: vi.fn().mockResolvedValue(new Map()),
    applySlotMutation: vi.fn().mockResolvedValue({ libraryId: current.libraryId, koboCoverChanged: true }),
    importSlotWithoutStamp: vi.fn().mockResolvedValue(current.libraryId),
    copyCoverLockToAudio: vi.fn().mockResolvedValue(undefined),
  };
  const events = { emitChanged: vi.fn() };
  const config = { getOrThrow: vi.fn().mockReturnValue(root) };
  return { store: new BookCoverStore(config as never, repository as never, events as never), repository, events };
}

/** A book with no slot rows until the store imports one, after which it has that slot. */
function makeLegacyStore(root: string, legacy: BookCoverContext) {
  const made = makeStore(root, legacy);
  made.repository.findContext.mockImplementation(() => {
    const imported = made.repository.importSlotWithoutStamp.mock.calls.map(([, medium, row]) => ({ ...row, bookId: 7, medium }) as BookCoverSlotRow);
    return Promise.resolve(imported.length > 0 ? { ...legacy, slots: imported } : legacy);
  });
  return made;
}

describe('BookCoverStore', () => {
  describe('faceOf', () => {
    const { store } = makeStore(join(tmpdir(), 'unused-cover-store'), context());
    const ebook = slot('ebook');
    const audio = { ...slot('audio'), updatedAt: new Date('2026-02-01T00:00:00.000Z') };
    const both = { hasEbook: true, hasAudio: true };
    const face = (overrides: Partial<Parameters<BookCoverStore['faceOf']>[0]>) =>
      store.faceOf({
        libraryCoverAspectRatio: '2/3',
        primaryFormat: 'epub',
        media: both,
        slots: [ebook, audio],
        legacyVersion: 'legacy-stamp',
        ...overrides,
      });

    it("follows the primary file's medium in either library shape", () => {
      expect(face({ primaryFormat: 'm4b' })).toEqual({
        coverAspectRatio: '1/1',
        coverVersion: 'audio:2026-02-01T00:00:00.000Z:2026-01-01T00:00:00.000Z',
      });
      expect(face({ libraryCoverAspectRatio: '1/1', primaryFormat: 'EPUB' })).toEqual({
        coverAspectRatio: '2/3',
        coverVersion: 'ebook:2026-01-01T00:00:00.000Z:2026-02-01T00:00:00.000Z',
      });
    });

    it('takes the library shape only for a book with no content file', () => {
      const none = { hasEbook: false, hasAudio: false };
      expect(face({ libraryCoverAspectRatio: '1/1', primaryFormat: null, media: none, slots: [] })).toEqual({
        coverAspectRatio: '1/1',
        coverVersion: 'legacy:legacy-stamp',
      });
      expect(face({ primaryFormat: undefined, media: none, slots: [] }).coverAspectRatio).toBe('2/3');
    });

    it('frames the slot it falls back to when the preferred one is empty, keeping the preferred medium in the version', () => {
      expect(face({ primaryFormat: 'm4b', slots: [ebook] })).toEqual({ coverAspectRatio: '2/3', coverVersion: 'audio:-:2026-01-01T00:00:00.000Z' });
      expect(face({ primaryFormat: 'm4b', slots: [ebook, { ...audio, dormantSince: new Date('2026-03-01T00:00:00.000Z') }] }).coverAspectRatio).toBe(
        '2/3',
      );
      expect(face({ primaryFormat: 'm4b', media: { hasEbook: false, hasAudio: true }, slots: [] }).coverAspectRatio).toBe('1/1');
    });

    it('keeps a read-along EPUB on the ebook side', () => {
      expect(face({ primaryFormat: 'epub', media: { hasEbook: true, hasAudio: true }, slots: [ebook, audio] }).coverAspectRatio).toBe('2/3');
    });
  });

  it('gives cards the face of their primary file and replaces the library shape they arrive with', async () => {
    const { store, repository } = makeStore(join(tmpdir(), 'unused-cover-store'), context());
    repository.slotsFor.mockResolvedValue(new Map([[7, [slot('ebook'), slot('audio')]]]));
    const card = {
      id: 7,
      coverAspectRatio: '2/3',
      addedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
      coverVersion: 'legacy:x',
      files: [
        { id: 70, format: 'epub', role: 'content', sizeBytes: null },
        { id: 71, format: 'm4b', role: 'primary', sizeBytes: null },
      ],
    };

    await store.enrichCardFaces([card as never]);

    expect(card).toMatchObject({ coverAspectRatio: '1/1', coverVersion: 'audio:2026-01-01T00:00:00.000Z:2026-01-01T00:00:00.000Z' });
  });

  it('resolves faces for rows with no files of their own from one row and one slot query', async () => {
    const { store, repository } = makeStore(join(tmpdir(), 'unused-cover-store'), context());
    const findFaceRows = vi
      .fn()
      .mockResolvedValue([
        { bookId: 7, libraryCoverAspectRatio: '2/3', primaryFormat: 'm4b', media: { hasEbook: true, hasAudio: true }, legacyVersion: 'x' },
      ]);
    Object.assign(repository, { findFaceRows });
    repository.slotsFor.mockResolvedValue(new Map([[7, [slot('ebook'), slot('audio')]]]));

    const faces = await store.facesFor([7, 7]);

    expect(findFaceRows).toHaveBeenCalledWith([7]);
    expect(faces.get(7)?.coverAspectRatio).toBe('1/1');
  });

  it("resolves the primary file's face and honors explicit strict and fallback reads", async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-resolve-'));
    try {
      const ebookDir = bookCoverSlotDirPath(root, 7, 'ebook');
      const audioDir = bookCoverSlotDirPath(root, 7, 'audio');
      await Promise.all([mkdir(ebookDir, { recursive: true }), mkdir(audioDir, { recursive: true })]);
      await Promise.all([writeFile(join(ebookDir, 'cover_extracted.jpg'), 'ebook'), writeFile(join(audioDir, 'cover_extracted.jpg'), 'audio')]);
      const { store } = makeStore(root, context({ primaryFileId: 71 }));

      await expect(store.resolve(7, { variant: 'cover' })).resolves.toBe(join(audioDir, 'cover_extracted.jpg'));
      await expect(store.resolve(7, { medium: 'ebook', variant: 'cover', strict: true })).resolves.toBe(join(ebookDir, 'cover_extracted.jpg'));
      await rm(join(ebookDir, 'cover_extracted.jpg'));
      await expect(store.resolve(7, { medium: 'ebook', variant: 'cover' })).resolves.toBe(join(audioDir, 'cover_extracted.jpg'));
      await expect(store.resolve(7, { medium: 'ebook', variant: 'cover', strict: true })).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('converts a legacy root cover on first read and serves it from its slot, even with no coverSource', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-legacy-'));
    try {
      const legacyDir = bookCoverDirPath(root, 7);
      await mkdir(legacyDir, { recursive: true });
      const portrait = await image(60, 90);
      await writeFile(join(legacyDir, 'cover.jpg'), portrait);
      const { store, repository } = makeLegacyStore(root, context({ coverSource: null, slots: [] }));

      const ebookDir = bookCoverSlotDirPath(root, 7, 'ebook');
      await expect(store.resolve(7, { variant: 'cover' })).resolves.toBe(join(ebookDir, 'cover_extracted.jpg'));
      expect(repository.importSlotWithoutStamp).toHaveBeenCalledWith(7, 'ebook', expect.objectContaining({ source: 'extracted', origin: 'legacy' }));
      await expect(readFile(join(ebookDir, 'cover_extracted.jpg'))).resolves.toEqual(portrait);
      await expect(readFile(join(legacyDir, 'cover.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('joins a conversion already running, so a cover and a thumbnail read do not race over the root files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-legacy-join-'));
    try {
      const legacyDir = bookCoverDirPath(root, 7);
      await mkdir(legacyDir, { recursive: true });
      await writeFile(join(legacyDir, 'cover_extracted.jpg'), await image(60, 90));
      await writeFile(join(legacyDir, 'thumbnail.jpg'), await image(20, 30));
      const { store, repository } = makeLegacyStore(root, context({ slots: [] }));

      const ebookDir = bookCoverSlotDirPath(root, 7, 'ebook');
      await expect(Promise.all([store.resolve(7, { variant: 'cover' }), store.resolve(7, { variant: 'thumbnail' })])).resolves.toEqual([
        join(ebookDir, 'cover_extracted.jpg'),
        join(ebookDir, 'thumbnail.jpg'),
      ]);
      expect(repository.importSlotWithoutStamp).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serves no cover, and never the root file, when a read cannot convert it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-legacy-fail-'));
    try {
      const legacyDir = bookCoverDirPath(root, 7);
      await mkdir(legacyDir, { recursive: true });
      await writeFile(join(legacyDir, 'cover_custom.jpg'), await image(60, 90));
      const { store, repository } = makeLegacyStore(root, context({ slots: [] }));
      repository.importSlotWithoutStamp.mockRejectedValue(new Error('database unavailable'));

      await expect(store.resolve(7, { variant: 'cover' })).resolves.toBeNull();
      await expect(readFile(join(legacyDir, 'cover_custom.jpg'))).resolves.toBeInstanceOf(Buffer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe('thumbnail repair', () => {
    const ebookOnly = () => context({ media: { hasEbook: true, hasAudio: false }, slots: [slot('ebook')] });

    async function withSlot(cover: Buffer | null, run: (store: BookCoverStore, dir: string) => Promise<void>): Promise<void> {
      const root = await mkdtemp(join(tmpdir(), 'cover-store-thumbnail-'));
      try {
        const dir = bookCoverSlotDirPath(root, 7, 'ebook');
        if (cover) {
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, 'cover_custom.jpg'), cover);
        }
        await run(makeStore(root, ebookOnly()).store, dir);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }

    it('rebuilds a thumbnail missing beside an intact cover and leaves no temporary file', async () => {
      await withSlot(await image(800, 1200), async (store, dir) => {
        await expect(store.resolve(7, { variant: 'thumbnail' })).resolves.toBe(join(dir, 'thumbnail.jpg'));

        expect(await sharp(await readFile(join(dir, 'thumbnail.jpg'))).metadata()).toMatchObject({ format: 'jpeg', width: 400, height: 600 });
        expect((await readdir(dir)).sort()).toEqual(['cover_custom.jpg', 'thumbnail.jpg']);
      });
    });

    it('keeps a thumbnail written while the repair was in flight', async () => {
      await withSlot(await image(800, 1200), async (store, dir) => {
        const existing = Buffer.from('thumbnail written by a concurrent cover update');

        const repair = store.resolve(7, { variant: 'thumbnail' });
        await writeFile(join(dir, 'thumbnail.jpg'), existing);

        await expect(repair).resolves.toBe(join(dir, 'thumbnail.jpg'));
        await expect(readFile(join(dir, 'thumbnail.jpg'))).resolves.toEqual(existing);
      });
    });

    it('resolves null instead of throwing when the cover cannot be decoded', async () => {
      await withSlot(Buffer.alloc(0), async (store) => {
        await expect(store.resolve(7, { variant: 'thumbnail' })).resolves.toBeNull();
      });
    });

    it('resolves null when the slot directory is gone', async () => {
      await withSlot(null, async (store) => {
        await expect(store.resolve(7, { variant: 'thumbnail' })).resolves.toBeNull();
      });
    });
  });

  it('keeps an extracted fallback when a custom cover is reverted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-revert-'));
    try {
      const ebookDir = bookCoverSlotDirPath(root, 7, 'ebook');
      await mkdir(ebookDir, { recursive: true });
      const extracted = await image(60, 90);
      await writeFile(join(ebookDir, 'cover_extracted.jpg'), extracted);
      const current = context({ media: { hasEbook: true, hasAudio: false }, slots: [slot('ebook')] });
      const { store, repository, events } = makeStore(root, current);

      await expect(store.saveCustom(7, 'ebook', await image(90, 90))).resolves.toBe(true);
      await expect(store.revert(7, 'ebook')).resolves.toBe('extracted');

      expect(repository.applySlotMutation).toHaveBeenLastCalledWith(
        7,
        'ebook',
        current.media,
        expect.objectContaining({ kind: 'upsert', row: expect.objectContaining({ source: 'extracted' }) }),
        expect.objectContaining({ bumpBook: true, servedBytesChanged: true }),
      );
      expect(events.emitChanged).toHaveBeenCalledTimes(2);
      expect(await readFile(join(ebookDir, 'cover_extracted.jpg'))).toEqual(extracted);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes a square legacy cover to audio and copies the cover lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-backfill-'));
    try {
      const legacyDir = bookCoverDirPath(root, 7);
      await mkdir(legacyDir, { recursive: true });
      const square = await image(80, 80);
      await writeFile(join(legacyDir, 'cover_custom.jpg'), square);
      const current = context({ coverSource: 'custom', lockedFields: ['cover'], slots: [] });
      const { store, repository } = makeStore(root, current);

      await expect(store.convertLegacy(7)).resolves.toEqual({ converted: true, libraryId: 3 });

      expect(repository.importSlotWithoutStamp).toHaveBeenCalledWith(
        7,
        'audio',
        expect.objectContaining({ source: 'custom', origin: 'legacy', updatedAt: current.coverUpdatedAt }),
      );
      expect(repository.copyCoverLockToAudio).toHaveBeenCalledWith(7);
      await expect(readFile(join(bookCoverSlotDirPath(root, 7, 'audio'), 'cover_custom.jpg'))).resolves.toEqual(square);
      await expect(readFile(join(legacyDir, 'cover_custom.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes a generic legacy custom cover so reverting removes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-generic-legacy-'));
    try {
      const legacyDir = bookCoverDirPath(root, 7);
      await mkdir(legacyDir, { recursive: true });
      const portrait = await image(60, 90);
      await writeFile(join(legacyDir, 'cover.jpg'), portrait);
      const current = context({
        coverSource: 'custom',
        media: { hasEbook: true, hasAudio: false },
        slots: [],
      });
      const { store, repository } = makeStore(root, current);

      await expect(store.convertLegacy(7)).resolves.toEqual({ converted: true, libraryId: 3 });
      const ebookDir = bookCoverSlotDirPath(root, 7, 'ebook');
      await expect(readFile(join(ebookDir, 'cover_custom.jpg'))).resolves.toEqual(portrait);
      await expect(readFile(join(ebookDir, 'cover.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });

      await expect(store.revert(7, 'ebook')).resolves.toBeNull();
      await expect(readFile(join(ebookDir, 'cover_custom.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(repository.applySlotMutation).toHaveBeenLastCalledWith(
        7,
        'ebook',
        current.media,
        { kind: 'delete' },
        expect.objectContaining({ servedBytesChanged: true }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not mutate a locked slot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-lock-'));
    try {
      const { store, repository, events } = makeStore(root, context({ lockedFields: ['audioCover'] }));

      await expect(store.saveExtracted(7, 'audio', await image(80, 80), { origin: 'embedded' })).resolves.toBe(false);
      expect(repository.applySlotMutation).not.toHaveBeenCalled();
      expect(events.emitChanged).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fills only an empty slot or one that came from a folder image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-fill-'));
    try {
      const folderImageSlot = { ...slot('audio'), origin: 'folder_image' };
      const { store, repository } = makeStore(root, context({ slots: [slot('ebook'), folderImageSlot] }));
      const fill = { replaceOrigins: ['folder_image'] as const };

      await expect(store.saveExtracted(7, 'ebook', await image(60, 90), { origin: 'folder_image', fill })).resolves.toBe(false);
      await expect(store.saveExtracted(7, 'audio', await image(80, 80), { origin: 'embedded', fill })).resolves.toBe(true);
      expect(repository.applySlotMutation).toHaveBeenCalledOnce();
      expect(repository.applySlotMutation.mock.calls[0]?.[1]).toBe('audio');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks a slot dormant with the medium it had, so a Kobo cover switch moves the stamp', async () => {
    const { store, repository } = makeStore(join(tmpdir(), 'unused-cover-store'), context({ media: { hasEbook: false, hasAudio: true } }));

    await expect(store.markDormant(7, 'ebook')).resolves.toBe(true);

    const [, medium, media, mutation, options] = repository.applySlotMutation.mock.calls[0]!;
    expect(medium).toBe('ebook');
    expect(media).toEqual({ hasEbook: false, hasAudio: true });
    expect(mutation).toMatchObject({ kind: 'upsert', row: { dormantSince: expect.any(Date), source: 'extracted' } });
    expect(options).toMatchObject({ beforeMedia: { hasEbook: true, hasAudio: true }, servedBytesChanged: false });
  });

  it('routes a sidecar cover by shape, but keeps it on the ebook side of a read-along EPUB', async () => {
    const both = makeStore(join(tmpdir(), 'unused-cover-store'), context());
    await expect(both.store.chooseSidecarMedium(7, await image(80, 80))).resolves.toBe('audio');
    await expect(both.store.chooseSidecarMedium(7, await image(60, 90))).resolves.toBe('ebook');
    await expect(both.store.chooseSidecarMedium(7, await image(160, 90))).resolves.toBe('ebook');

    const readAlong = makeStore(
      join(tmpdir(), 'unused-cover-store'),
      context({ files: [{ id: 70, format: 'epub', role: 'content', mediaOverlayAvailable: true }] }),
    );
    await expect(readAlong.store.chooseSidecarMedium(7, await image(80, 80))).resolves.toBe('ebook');
  });

  it("writes image bytes by shape, and a write with no image to the face slot of the primary file's medium", async () => {
    const ebookFirst = makeStore(join(tmpdir(), 'unused-cover-store'), context({ coverAspectRatio: '1/1' }));
    await expect(ebookFirst.store.chooseWriteMedium(7, await image(80, 80))).resolves.toBe('audio');
    await expect(ebookFirst.store.chooseWriteMedium(7)).resolves.toBe('ebook');

    const audioFirst = makeStore(join(tmpdir(), 'unused-cover-store'), context({ primaryFileId: 71 }));
    await expect(audioFirst.store.chooseWriteMedium(7)).resolves.toBe('audio');
  });

  it('hands a merged book’s slot to the target only for a medium the target has no cover for', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cover-store-adopt-'));
    try {
      const target = context({ bookId: 8, slots: [{ ...slot('ebook'), bookId: 8 }] });
      const { store, repository } = makeStore(root, target);
      for (const medium of ['ebook', 'audio'] as const) {
        const dir = bookCoverSlotDirPath(root, 7, medium);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'cover_extracted.jpg'), await image(80, 80));
      }

      await expect(store.adoptSlots(7, [slot('ebook'), slot('audio', 'custom')], 8)).resolves.toEqual(['audio']);

      expect(await readFile(join(bookCoverSlotDirPath(root, 8, 'audio'), 'cover_extracted.jpg'))).toBeInstanceOf(Buffer);
      expect(repository.applySlotMutation).toHaveBeenCalledOnce();
      expect(repository.applySlotMutation.mock.calls[0]?.slice(0, 2)).toEqual([8, 'audio']);
      expect(repository.applySlotMutation.mock.calls[0]?.[3]).toMatchObject({ kind: 'upsert', row: { source: 'custom', dormantSince: null } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports each slot a fetch may fill, sorting a legacy cover into its slot first', async () => {
    const withAudioOnlyEmpty = makeStore(join(tmpdir(), 'unused-cover-store'), context({ slots: [slot('ebook')], lockedFields: ['audioCover'] }));
    await expect(withAudioOnlyEmpty.store.fetchState(7)).resolves.toEqual({
      media: { hasEbook: true, hasAudio: true },
      filled: { ebook: true, audio: false },
      locked: ['audio'],
    });

    const root = await mkdtemp(join(tmpdir(), 'cover-store-fetch-legacy-'));
    try {
      await mkdir(bookCoverDirPath(root, 7), { recursive: true });
      await writeFile(join(bookCoverDirPath(root, 7), 'cover_custom.jpg'), await image(80, 80));
      const legacy = makeLegacyStore(root, context({ slots: [], coverSource: 'custom' }));
      await expect(legacy.store.fetchState(7)).resolves.toMatchObject({ filled: { ebook: false, audio: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const summaryOnly = makeStore(join(tmpdir(), 'unused-cover-store'), context({ slots: [], coverSource: 'custom' }));
    await expect(summaryOnly.store.fetchState(7)).resolves.toMatchObject({ filled: { ebook: false, audio: false } });

    const dormant = makeStore(
      join(tmpdir(), 'unused-cover-store'),
      context({ slots: [{ ...slot('audio'), dormantSince: new Date() }], media: { hasEbook: true, hasAudio: true } }),
    );
    await expect(dormant.store.fetchState(7)).resolves.toMatchObject({ filled: { ebook: false, audio: false } });
  });

  it('calls a slot empty only when it holds nothing, a dormant custom cover counting as something', async () => {
    const root = join(tmpdir(), 'unused-cover-store');
    const ebookOnly = makeStore(root, context({ slots: [slot('ebook')], media: { hasEbook: true, hasAudio: true } }));
    await expect(ebookOnly.store.slotIsEmpty(7, 'audio')).resolves.toBe(true);
    await expect(ebookOnly.store.slotIsEmpty(7, 'ebook')).resolves.toBe(false);

    const dormantCustom = makeStore(
      root,
      context({ slots: [{ ...slot('audio', 'custom'), dormantSince: new Date() }], media: { hasEbook: true, hasAudio: true } }),
    );
    await expect(dormantCustom.store.slotIsEmpty(7, 'audio')).resolves.toBe(false);
  });
});
