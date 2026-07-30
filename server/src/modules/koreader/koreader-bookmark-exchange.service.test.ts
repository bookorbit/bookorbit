import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { BookmarkExchangeAckDto, BookmarkExchangeDto } from './dto';
import { KoreaderBookmarkExchangeService, buildBookmarkKey } from './koreader-bookmark-exchange.service';

const DEVICE_ID = 'device-1234';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);
const POS = '/body/DocFragment[3]/body/div/p[7]/text().0';
const DATETIME = '2026-06-08 10:11:12';

function makeUser(): RequestUser {
  return { id: 7, settings: {} } as unknown as RequestUser;
}

function makeBookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    userId: 7,
    bookId: 20,
    cfi: 'epubcfi(/6/8!/4/2/14/1:0)',
    title: 'Chapter 3',
    positionSeconds: null,
    origin: 'web',
    devicePos: null,
    pageno: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    bookmarkId: 100,
    userId: 7,
    deviceId: DEVICE_ID,
    koreaderKey: buildBookmarkKey(DATETIME, POS),
    deviceDatetime: DATETIME,
    appliedAt: new Date('2026-06-02T10:00:00Z'),
    ...overrides,
  };
}

function makeExchangeDto(books: BookmarkExchangeDto['books']): BookmarkExchangeDto {
  return { deviceId: DEVICE_ID, deviceModel: 'Kobo', pluginVersion: '0.5.0', books } as BookmarkExchangeDto;
}

function makeBook(overrides: Partial<BookmarkExchangeDto['books'][number]> = {}): BookmarkExchangeDto['books'][number] {
  return { hash: HASH_A, keys: [], keysComplete: false, changes: [], ...overrides } as BookmarkExchangeDto['books'][number];
}

describe('KoreaderBookmarkExchangeService', () => {
  let koreaderRepo: { getAccessibleLibraryIds: ReturnType<typeof vi.fn>; resolveBookFilesByHashes: ReturnType<typeof vi.fn> };
  let bookmarkRepo: Record<string, ReturnType<typeof vi.fn>>;
  let bookmarkSync: Record<string, ReturnType<typeof vi.fn>>;
  let positionConverter: Record<string, ReturnType<typeof vi.fn>>;
  let service: KoreaderBookmarkExchangeService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
    };
    bookmarkRepo = {
      findLinksForBookmarks: vi.fn().mockResolvedValue([]),
      findBookmarkIdsWithLinks: vi.fn().mockResolvedValue(new Set()),
      upsertLink: vi.fn().mockResolvedValue(undefined),
      deleteLinks: vi.fn().mockResolvedValue(0),
    };
    bookmarkSync = {
      listForSync: vi.fn().mockResolvedValue([]),
      upsertFromDevice: vi.fn(),
      applyDeviceEdit: vi.fn().mockResolvedValue(null),
      tombstone: vi.fn().mockResolvedValue(0),
      listPurgeableTombstones: vi.fn().mockResolvedValue([]),
      purge: vi.fn().mockResolvedValue(0),
    };
    positionConverter = {
      xpointerPointToCfi: vi.fn().mockResolvedValue({ status: 'exact', cfi: 'epubcfi(/6/8!/4/2/14/1:0)' }),
      cfiPointToXpointer: vi.fn().mockResolvedValue({ status: 'exact', pos0: POS }),
    };

    service = new KoreaderBookmarkExchangeService(koreaderRepo as never, bookmarkRepo as never, bookmarkSync as never, positionConverter as never);
  });

  describe('exchange', () => {
    it('reports books the server cannot resolve as unmatched without touching them', async () => {
      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook({ hash: HASH_B })]));

      expect(result.unmatched).toEqual([HASH_B]);
      expect(result.results).toEqual([]);
      expect(bookmarkSync.listForSync).not.toHaveBeenCalled();
    });

    it('creates a bookmark from an unknown device key and links it', async () => {
      const created = makeBookmarkRow({ id: 101, origin: 'koreader', devicePos: POS, pageno: 42 });
      bookmarkSync.upsertFromDevice.mockResolvedValue({ row: created, outcome: 'created' });
      bookmarkSync.listForSync.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValueOnce([]).mockResolvedValueOnce([makeLinkRow({ bookmarkId: 101 })]);

      const result = await service.exchange(
        makeUser(),
        makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS, pageno: 42, chapter: 'Chapter 3' }] })]),
      );

      expect(positionConverter.xpointerPointToCfi).toHaveBeenCalledWith({ bookFileId: 10, pos: POS });
      expect(bookmarkSync.upsertFromDevice).toHaveBeenCalledWith(7, 20, {
        cfi: 'epubcfi(/6/8!/4/2/14/1:0)',
        title: 'Chapter 3',
        devicePos: POS,
        pageno: 42,
      });
      expect(bookmarkRepo.upsertLink).toHaveBeenCalledWith({
        bookmarkId: 101,
        userId: 7,
        deviceId: DEVICE_ID,
        koreaderKey: buildBookmarkKey(DATETIME, POS),
        deviceDatetime: DATETIME,
      });
      expect(result.results[0]).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
      // Already linked by the ingest, so nothing is pushed back at it.
      expect(result.results[0].toApply.add).toEqual([]);
    });

    it('prefers the device note over the chapter title, then the page label', async () => {
      bookmarkSync.upsertFromDevice.mockResolvedValue({ row: makeBookmarkRow({ id: 101 }), outcome: 'created' });

      await service.exchange(
        makeUser(),
        makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS, pageno: 42, chapter: 'Chapter 3', note: 'Look here' }] })]),
      );
      expect(bookmarkSync.upsertFromDevice).toHaveBeenLastCalledWith(7, 20, expect.objectContaining({ title: 'Look here' }));

      await service.exchange(makeUser(), makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS, pageno: 42 }] })]));
      expect(bookmarkSync.upsertFromDevice).toHaveBeenLastCalledWith(7, 20, expect.objectContaining({ title: 'p. 42' }));

      await service.exchange(makeUser(), makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS }] })]));
      expect(bookmarkSync.upsertFromDevice).toHaveBeenLastCalledWith(7, 20, expect.objectContaining({ title: 'Bookmark' }));
    });

    it('rejects a change whose position cannot be converted, leaving no CFI-less row behind', async () => {
      positionConverter.xpointerPointToCfi.mockResolvedValue({ status: 'failed', reason: 'chapter_unavailable' });

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS }] })]));

      expect(bookmarkSync.upsertFromDevice).not.toHaveBeenCalled();
      expect(result.results[0]).toMatchObject({ accepted: 0, rejected: 1 });
    });

    it('counts a bookmark another device already created as a duplicate', async () => {
      bookmarkSync.upsertFromDevice.mockResolvedValue({ row: makeBookmarkRow(), outcome: 'matched' });

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS }] })]));

      expect(result.results[0]).toMatchObject({ accepted: 0, duplicates: 1 });
      expect(bookmarkRepo.upsertLink).toHaveBeenCalledTimes(1);
    });

    it('applies a device rename to a known key without creating anything', async () => {
      const bookmark = makeBookmarkRow({ title: 'Chapter 3' });
      bookmarkSync.listForSync.mockResolvedValue([bookmark]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);

      const result = await service.exchange(
        makeUser(),
        makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS, pageno: 42, note: 'Renamed' }] })]),
      );

      expect(bookmarkSync.applyDeviceEdit).toHaveBeenCalledWith(7, 100, { title: 'Renamed', pageno: 42 });
      expect(bookmarkSync.upsertFromDevice).not.toHaveBeenCalled();
      expect(result.results[0]).toMatchObject({ accepted: 0, duplicates: 1 });
    });

    it('leaves an unchanged known key alone', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow({ title: 'Chapter 3' })]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);

      await service.exchange(makeUser(), makeExchangeDto([makeBook({ changes: [{ datetime: DATETIME, pos: POS, chapter: 'Chapter 3' }] })]));

      expect(bookmarkSync.applyDeviceEdit).not.toHaveBeenCalled();
    });

    it('pushes a live web bookmark down with a converted position', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow({ pageno: 7 })]);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(positionConverter.cfiPointToXpointer).toHaveBeenCalledWith({ bookFileId: 10, cfi: 'epubcfi(/6/8!/4/2/14/1:0)' });
      expect(result.results[0].toApply.add).toEqual([{ serverId: 100, pos: POS, pageno: 7, title: 'Chapter 3' }]);
      expect(result.results[0].skippedConversion).toBe(0);
    });

    it('returns a device-originated bookmark at its stored device position without reconverting', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow({ origin: 'koreader', devicePos: POS, pageno: 3 })]);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(positionConverter.cfiPointToXpointer).not.toHaveBeenCalled();
      expect(result.results[0].toApply.add[0]).toMatchObject({ serverId: 100, pos: POS, pageno: 3 });
    });

    it('counts an unconvertible web bookmark as skipped instead of pushing it', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);
      positionConverter.cfiPointToXpointer.mockResolvedValue({ status: 'failed', reason: 'unresolvable_structure' });

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(result.results[0].toApply.add).toEqual([]);
      expect(result.results[0].skippedConversion).toBe(1);
    });

    it('never pushes an audio bookmark or a tombstone as an add', async () => {
      bookmarkSync.listForSync.mockResolvedValue([
        makeBookmarkRow({ id: 101, cfi: null, positionSeconds: 90 }),
        makeBookmarkRow({ id: 102, deletedAt: new Date('2026-06-05T10:00:00Z') }),
      ]);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(result.results[0].toApply.add).toEqual([]);
    });

    it('pushes a delete for a tombstone this device still holds', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow({ deletedAt: new Date('2026-06-05T10:00:00Z') })]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(result.results[0].toApply.delete).toEqual([{ serverId: 100, key: buildBookmarkKey(DATETIME, POS), datetime: DATETIME }]);
    });

    it('tombstones a bookmark whose key the device no longer reports', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);
      bookmarkSync.tombstone.mockResolvedValue(1);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [], keysComplete: true })]));

      expect(bookmarkSync.tombstone).toHaveBeenCalledWith(7, [100]);
      expect(bookmarkRepo.deleteLinks).toHaveBeenCalledWith(7, DEVICE_ID, [100]);
      expect(result.results[0].deviceDeleted).toBe(1);
    });

    it('skips deletion detection when the device could not report a complete key set', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);

      const result = await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [], keysComplete: false })]));

      expect(bookmarkSync.tombstone).not.toHaveBeenCalled();
      expect(result.results[0].deviceDeleted).toBe(0);
    });

    it('keeps a bookmark whose key is still present', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);
      bookmarkRepo.findLinksForBookmarks.mockResolvedValue([makeLinkRow()]);

      await service.exchange(
        makeUser(),
        makeExchangeDto([makeBook({ keys: [{ k: buildBookmarkKey(DATETIME, POS), dt: DATETIME }], keysComplete: true })]),
      );

      expect(bookmarkSync.tombstone).not.toHaveBeenCalled();
    });

    it('purges only expired tombstones no device still holds', async () => {
      bookmarkSync.listPurgeableTombstones.mockResolvedValue([201, 202]);
      bookmarkRepo.findBookmarkIdsWithLinks.mockResolvedValue(new Set([202]));
      bookmarkSync.purge.mockResolvedValue(1);

      await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(bookmarkSync.purge).toHaveBeenCalledWith(7, [201]);
    });

    it('does not purge when every expired tombstone is still linked', async () => {
      bookmarkSync.listPurgeableTombstones.mockResolvedValue([201]);
      bookmarkRepo.findBookmarkIdsWithLinks.mockResolvedValue(new Set([201]));

      await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

      expect(bookmarkSync.purge).not.toHaveBeenCalled();
    });
  });

  describe('exchangeAck', () => {
    function makeAckDto(books: BookmarkExchangeAckDto['books']): BookmarkExchangeAckDto {
      return { deviceId: DEVICE_ID, deviceModel: 'Kobo', pluginVersion: '0.5.0', books } as BookmarkExchangeAckDto;
    }

    it('links an applied bookmark under the identity the device reported', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);

      const result = await service.exchangeAck(
        makeUser(),
        makeAckDto([{ hash: HASH_A, applied: [{ serverId: 100, status: 'applied', key: 'f'.repeat(32), datetime: DATETIME }], deleted: [] }]),
      );

      expect(bookmarkRepo.upsertLink).toHaveBeenCalledWith({
        bookmarkId: 100,
        userId: 7,
        deviceId: DEVICE_ID,
        koreaderKey: 'f'.repeat(32),
        deviceDatetime: DATETIME,
      });
      expect(result.results).toEqual([{ hash: HASH_A, acked: 1 }]);
    });

    it('derives the identity from datetime and position when the device omits the key', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);

      await service.exchangeAck(
        makeUser(),
        makeAckDto([{ hash: HASH_A, applied: [{ serverId: 100, status: 'applied', datetime: DATETIME, pos: POS }], deleted: [] }]),
      );

      expect(bookmarkRepo.upsertLink).toHaveBeenCalledWith(expect.objectContaining({ koreaderKey: buildBookmarkKey(DATETIME, POS) }));
    });

    it('ignores a failed apply and an apply with no usable identity', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);

      await service.exchangeAck(
        makeUser(),
        makeAckDto([
          {
            hash: HASH_A,
            applied: [
              { serverId: 100, status: 'failed', key: 'f'.repeat(32) },
              { serverId: 100, status: 'applied' },
            ],
            deleted: [],
          },
        ]),
      );

      expect(bookmarkRepo.upsertLink).not.toHaveBeenCalled();
    });

    it('ignores a serverId that does not belong to this user and book', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow()]);

      await service.exchangeAck(
        makeUser(),
        makeAckDto([{ hash: HASH_A, applied: [{ serverId: 999, status: 'applied', key: 'f'.repeat(32) }], deleted: [] }]),
      );

      expect(bookmarkRepo.upsertLink).not.toHaveBeenCalled();
    });

    it('drops the link once the device confirms the delete', async () => {
      bookmarkSync.listForSync.mockResolvedValue([makeBookmarkRow({ deletedAt: new Date('2026-06-05T10:00:00Z') })]);
      bookmarkRepo.deleteLinks.mockResolvedValue(1);

      const result = await service.exchangeAck(
        makeUser(),
        makeAckDto([{ hash: HASH_A, applied: [], deleted: [{ serverId: 100, status: 'applied' }] }]),
      );

      expect(bookmarkRepo.deleteLinks).toHaveBeenCalledWith(7, DEVICE_ID, [100]);
      expect(result.results).toEqual([{ hash: HASH_A, acked: 1 }]);
    });

    it('reports unresolved hashes as unmatched', async () => {
      const result = await service.exchangeAck(makeUser(), makeAckDto([{ hash: HASH_B, applied: [], deleted: [] }]));

      expect(result.unmatched).toEqual([HASH_B]);
      expect(result.results).toEqual([]);
    });
  });

  it('builds the same identity key the plugin computes', () => {
    expect(buildBookmarkKey('2026-06-08 10:11:12', 'pos')).toHaveLength(32);
    expect(buildBookmarkKey('2026-06-08 10:11:12', 'pos')).not.toBe(buildBookmarkKey('2026-06-08 10:11:13', 'pos'));
  });
});
