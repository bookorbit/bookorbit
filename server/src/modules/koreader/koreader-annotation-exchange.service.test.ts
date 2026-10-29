import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AnnotationSyncService } from '../annotation/annotation-sync.service';
import type { PositionConverterService } from '../position-converter/position-converter.service';
import type { AnnotationExchangeAckDto, AnnotationExchangeDto } from './dto';
import { exchangeDeviceId } from './koreader-exchange-device';
import { KoreaderAnnotationExchangeService, parseKoreaderSourceCreatedAt } from './koreader-annotation-exchange.service';
import type { KoreaderRepository } from './koreader.repository';

const DEVICE_ID = 'device-1234';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

function makeUser(timezone = 'UTC'): RequestUser {
  return { id: 7, settings: { timezone } } as unknown as RequestUser;
}

function makeAnnotationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    userId: 7,
    bookId: 20,
    text: 'highlighted text',
    color: '#FACC15',
    style: 'squiggly',
    note: 'a note',
    chapterTitle: 'Chapter 1',
    origin: 'web',
    version: 2,
    deletedAt: null,
    deviceCreatedAt: null,
    deviceUpdatedAt: null,
    sourceCreatedAt: null,
    createdAt: new Date('2026-06-08T10:00:00Z'),
    updatedAt: new Date('2026-06-09T11:30:00Z'),
    ...overrides,
  };
}

function makeStateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    annotationId: 100,
    userId: 7,
    source: 'koreader',
    deviceId: DEVICE_ID,
    externalKey: 'c'.repeat(32),
    externalCreatedAt: '2026-06-01 21:14:03',
    lastAppliedVersion: 1,
    deleteAckedAt: null,
    ...overrides,
  };
}

function makeExchangeDto(books: AnnotationExchangeDto['books']): AnnotationExchangeDto {
  return { deviceId: DEVICE_ID, deviceModel: 'Kobo', pluginVersion: '0.4.0', books } as AnnotationExchangeDto;
}

describe('KoreaderAnnotationExchangeService', () => {
  let koreaderRepo: { getAccessibleLibraryIds: ReturnType<typeof vi.fn>; resolveBookFilesByHashes: ReturnType<typeof vi.fn> };
  // Loose mock typing: format-dependent mockImplementations return promises.
  let annotationSync: Record<string, any>;
  let positionConverter: { version: number; cfiToXpointer: ReturnType<typeof vi.fn>; xpointerToCfi: ReturnType<typeof vi.fn> };
  let service: KoreaderAnnotationExchangeService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
    };
    annotationSync = {
      ingestDeviceAnnotations: vi.fn().mockResolvedValue({ created: 0, updated: 0, moved: 0, unchanged: 0, skippedDeleted: 0 }),
      detectDeviceDeletions: vi.fn().mockResolvedValue(0),
      isLostDeviceCopy: vi.fn().mockResolvedValue(false),
      reofferDeviceCopy: vi.fn().mockResolvedValue(0),
      computePushDown: vi.fn().mockResolvedValue({ adds: [], edits: [], deletes: [], more: false }),
      ensureDeviceCreatedAtMany: vi
        .fn()
        .mockImplementation((_userId: number, _bookId: number, rows: { id: number }[]) =>
          Promise.resolve(new Map(rows.map((row) => [row.id, '2026-06-08 10:00:00']))),
        ),
      findPositions: vi.fn().mockResolvedValue([]),
      upsertGeneratedPosition: vi.fn().mockResolvedValue(undefined),
      applyExchangeAck: vi.fn().mockResolvedValue({ acked: 0 }),
    };
    positionConverter = {
      version: 1,
      xpointerToCfi: vi.fn().mockResolvedValue({ status: 'failed' }),
      cfiToXpointer: vi.fn().mockResolvedValue({
        status: 'exact',
        pos0: '/body/DocFragment[1]/body/p/text().0',
        pos1: '/body/DocFragment[1]/body/p/text().5',
        chapterIndex: 0,
      }),
    };

    service = new KoreaderAnnotationExchangeService(
      koreaderRepo as unknown as KoreaderRepository,
      annotationSync as unknown as AnnotationSyncService,
      positionConverter as unknown as PositionConverterService,
    );
  });

  function makeBook(overrides: Partial<AnnotationExchangeDto['books'][number]> = {}): AnnotationExchangeDto['books'][number] {
    return { hash: HASH_A, keys: [], keysComplete: true, changes: [], ...overrides } as AnnotationExchangeDto['books'][number];
  }

  it('converts KOReader wall-clock dates with the user timezone, including historical DST', () => {
    expect(parseKoreaderSourceCreatedAt('2026-01-15 09:30:00', 'America/Denver')).toEqual(new Date('2026-01-15T16:30:00.000Z'));
    expect(parseKoreaderSourceCreatedAt('2026-07-15 09:30:00', 'America/Denver')).toEqual(new Date('2026-07-15T15:30:00.000Z'));
  });

  it('defers historical hashes whose current source bytes cannot safely resolve positions', async () => {
    koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, progressCompatible: false }]]));

    const result = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));
    const ack = await service.exchangeAck(makeUser(), {
      deviceId: DEVICE_ID,
      deviceModel: 'QA',
      pluginVersion: '1.7.0',
      books: [{ hash: HASH_A, applied: [], deleted: [] }],
    });

    // Reported apart from `unmatched`: plugins drop the match of a book listed there.
    expect(result).toEqual({ results: [], unmatched: [], positionIncompatible: [HASH_A] });
    expect(ack).toEqual({ results: [], unmatched: [], positionIncompatible: [HASH_A] });
    expect(annotationSync.ingestDeviceAnnotations).not.toHaveBeenCalled();
    expect(annotationSync.applyExchangeAck).not.toHaveBeenCalled();
  });

  it('rejects impossible or nonexistent KOReader wall-clock dates', () => {
    expect(parseKoreaderSourceCreatedAt('2026-02-30 09:30:00', 'UTC')).toBeNull();
    expect(parseKoreaderSourceCreatedAt('2026-03-08 02:30:00', 'America/Denver')).toBeNull();
  });

  it('passes the normalized source date into annotation ingest', async () => {
    const change = {
      datetime: '2026-01-15 09:30:00',
      drawer: 'lighten',
      posFormat: 'xpointer',
      pos0: '/body/DocFragment[1]',
    } as AnnotationExchangeDto['books'][number]['changes'][number];

    await service.exchange(makeUser('America/Denver'), makeExchangeDto([makeBook({ changes: [change] })]));

    expect(annotationSync.ingestDeviceAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        annotations: [expect.objectContaining({ datetime: change.datetime, sourceCreatedAt: new Date('2026-01-15T16:30:00.000Z') })],
      }),
    );
  });

  it('places device edit times on the server clock from the reported device time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T03:56:00Z'));
    try {
      const localEdit = {
        datetime: '2026-10-17 21:16:06',
        datetimeUpdated: '2026-10-17 21:55:47',
        drawer: 'lighten',
        posFormat: 'xpointer',
        pos0: '/body/DocFragment[1]',
      } as AnnotationExchangeDto['books'][number]['changes'][number];
      const koboMade = {
        datetime: '2026-10-18 03:29:51',
        drawer: 'lighten',
        posFormat: 'xpointer',
        pos0: '/body/DocFragment[2]',
      } as AnnotationExchangeDto['books'][number]['changes'][number];

      await service.exchange(makeUser('America/Denver'), {
        ...makeExchangeDto([makeBook({ changes: [localEdit, koboMade] })]),
        deviceTime: '2026-10-17 21:56:00',
      } as AnnotationExchangeDto);
      await service.exchange(makeUser('America/Denver'), makeExchangeDto([makeBook({ changes: [localEdit] })]));

      const [withClock] = annotationSync.ingestDeviceAnnotations.mock.calls[0];
      expect(withClock.annotations[0].editedAt).toEqual(new Date('2026-10-18T03:55:47Z'));
      expect(withClock.annotations[1].editedAt).toBeNull();
      const [withoutClock] = annotationSync.ingestDeviceAnnotations.mock.calls[1];
      expect(withoutClock.annotations[0].editedAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports unmatched hashes without processing them', async () => {
    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook({ hash: HASH_B })]));

    expect(response.unmatched).toEqual([HASH_B]);
    expect(response.results).toEqual([]);
    expect(annotationSync.ingestDeviceAnnotations).not.toHaveBeenCalled();
  });

  it('rejects requests with too many changes', async () => {
    const changes = Array.from({ length: 51 }, (_, i) => ({
      datetime: '2026-06-01 21:14:03',
      drawer: 'lighten',
      posFormat: 'xpointer',
      pos0: `/pos-${i}`,
    })) as AnnotationExchangeDto['books'][number]['changes'];

    await expect(service.exchange(makeUser(), makeExchangeDto([makeBook({ changes })]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips deletion detection when the key set is incomplete', async () => {
    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keysComplete: false })]));

    expect(annotationSync.detectDeviceDeletions).not.toHaveBeenCalled();
    expect(annotationSync.computePushDown).toHaveBeenCalled();
  });

  it('runs deletion detection on complete key sets', async () => {
    const keys = [{ k: 'd'.repeat(32), dt: '2026-06-01 21:14:03' }];
    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys })]));

    expect(annotationSync.detectDeviceDeletions).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        deviceId: exchangeDeviceId(DEVICE_ID, HASH_A),
        bookId: 20,
        presentKeys: [expect.objectContaining({ ...keys[0], sourceCreatedAt: new Date('2026-06-01T21:14:03.000Z') })],
      }),
    );
  });

  it('re-offers a sidecar the device reports as new and deletes nothing', async () => {
    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [], keysComplete: true, sidecarState: 'new' })]));

    expect(annotationSync.reofferDeviceCopy).toHaveBeenCalledWith({
      userId: 7,
      source: 'koreader',
      deviceId: exchangeDeviceId(DEVICE_ID, HASH_A),
      bookId: 20,
    });
    expect(annotationSync.isLostDeviceCopy).not.toHaveBeenCalled();
    expect(annotationSync.detectDeviceDeletions).not.toHaveBeenCalled();
    expect(annotationSync.computePushDown).toHaveBeenCalled();
  });

  it('judges an older plugin by its key set before ingest and re-offers a lost copy instead of deleting', async () => {
    annotationSync.isLostDeviceCopy.mockResolvedValue(true);
    const change = {
      datetime: '2026-06-01 21:14:03',
      drawer: 'lighten',
      posFormat: 'xpointer',
      pos0: '/body/DocFragment[1]',
    } as AnnotationExchangeDto['books'][number]['changes'][number];

    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [{ k: 'd'.repeat(32), dt: change.datetime }], changes: [change] })]));

    expect(annotationSync.isLostDeviceCopy.mock.invocationCallOrder[0]).toBeLessThan(
      annotationSync.ingestDeviceAnnotations.mock.invocationCallOrder[0],
    );
    expect(annotationSync.reofferDeviceCopy).toHaveBeenCalled();
    expect(annotationSync.detectDeviceDeletions).not.toHaveBeenCalled();
  });

  it('trusts a known sidecar: an empty complete key set still deletes', async () => {
    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [], keysComplete: true, sidecarState: 'known' })]));

    expect(annotationSync.isLostDeviceCopy).not.toHaveBeenCalled();
    expect(annotationSync.reofferDeviceCopy).not.toHaveBeenCalled();
    expect(annotationSync.detectDeviceDeletions).toHaveBeenCalled();
  });

  it('does not consult the lost-copy rule for an incomplete key set', async () => {
    await service.exchange(makeUser(), makeExchangeDto([makeBook({ keys: [], keysComplete: false })]));

    expect(annotationSync.isLostDeviceCopy).not.toHaveBeenCalled();
    expect(annotationSync.reofferDeviceCopy).not.toHaveBeenCalled();
  });

  describe('pending books', () => {
    it('asks once for every matched hash under its rendition id and names the pending ones', async () => {
      const USER = makeUser();
      koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(
        new Map([
          [HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }],
          [HASH_B, { bookFileId: 11, bookId: 21, libraryId: 1, progressCompatible: false }],
        ]),
      );
      annotationSync.findPendingDeviceBooks = vi.fn().mockResolvedValue(new Set([`${exchangeDeviceId('device-1', HASH_A)}:20`]));

      const result = await service.pendingBooks(USER, {
        deviceId: 'device-1',
        deviceModel: 'Kobo',
        pluginVersion: '0.4.0',
        hashes: [HASH_A.toUpperCase(), HASH_B, 'c'.repeat(32)],
      });

      expect(result).toEqual({ pending: [HASH_A] });
      expect(koreaderRepo.resolveBookFilesByHashes).toHaveBeenCalledWith([HASH_A, HASH_B, 'c'.repeat(32)], [1], USER.id);
      expect(annotationSync.findPendingDeviceBooks).toHaveBeenCalledWith(
        USER.id,
        'koreader',
        [{ deviceId: exchangeDeviceId('device-1', HASH_A), bookId: 20 }],
        'xpointer',
        positionConverter.version,
      );
    });
  });

  describe('device clock frame of pushed-down times', () => {
    const DEVICE_TIME = '2026-10-18 09:00:00';
    const NOW = new Date('2026-10-18T15:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      annotationSync.findPositions.mockResolvedValue([
        {
          annotationId: 100,
          format: 'xpointer',
          pos0: '/body/p/text().0',
          pos1: '/body/p/text().5',
          status: 'exact',
          bookFileId: 10,
          converterVersion: 1,
        },
      ]);
    });

    afterEach(() => vi.useRealTimers());

    async function pushAdd(annotation: ReturnType<typeof makeAnnotationRow>, identity: string, withClock = true) {
      annotationSync.ensureDeviceCreatedAtMany.mockResolvedValue(new Map([[annotation.id, identity]]));
      annotationSync.computePushDown.mockResolvedValue({ adds: [annotation], edits: [], deletes: [], more: false });
      const dto = makeExchangeDto([makeBook()]);
      const response = await service.exchange(makeUser(), withClock ? ({ ...dto, deviceTime: DEVICE_TIME } as AnnotationExchangeDto) : dto);
      return response.results[0].toApply.add[0];
    }

    it('replaces a Kobo UTC edit time that sits ahead of the device with one in its own clock', async () => {
      const annotation = makeAnnotationRow({
        deviceUpdatedAt: '2026-10-18 14:57:31',
        contentUpdatedAt: new Date('2026-10-18T14:57:39Z'),
      });

      const add = await pushAdd(annotation, '2026-10-18 08:52:14');

      expect(add.datetimeUpdated).toBe('2026-10-18 08:57:39');
    });

    it('gives a Kobo-minted identity an edit time in the device clock so it is not re-sent', async () => {
      const annotation = makeAnnotationRow({ deviceUpdatedAt: null, contentUpdatedAt: new Date('2026-10-18T14:52:14Z') });

      const add = await pushAdd(annotation, '2026-10-18 14:52:14');

      expect(add.datetime).toBe('2026-10-18 14:52:14');
      expect(add.datetimeUpdated).toBe('2026-10-18 08:52:14');
    });

    it('keeps an edit time that is already in the device clock', async () => {
      const annotation = makeAnnotationRow({ deviceUpdatedAt: '2026-10-18 08:30:00' });

      expect((await pushAdd(annotation, '2026-10-18 08:00:00')).datetimeUpdated).toBe('2026-10-18 08:30:00');
      expect((await pushAdd(makeAnnotationRow({ deviceUpdatedAt: null }), '2026-10-18 08:00:00')).datetimeUpdated).toBeNull();
    });

    it('leaves plugins that report no clock as they were', async () => {
      const annotation = makeAnnotationRow({ deviceUpdatedAt: '2026-10-18 14:57:31' });

      expect((await pushAdd(annotation, '2026-10-18 14:52:14', false)).datetimeUpdated).toBe('2026-10-18 14:57:31');
    });

    it('does not bump an edit time past a stored stamp from another clock', async () => {
      annotationSync.computePushDown.mockResolvedValue({
        adds: [],
        edits: [
          {
            state: makeStateRow(),
            annotation: makeAnnotationRow({
              deviceCreatedAt: '2026-10-18 08:52:14',
              deviceUpdatedAt: '2026-10-18 14:57:31',
              updatedAt: new Date('2026-10-18T14:58:39Z'),
            }),
          },
        ],
        deletes: [],
        more: false,
      });
      annotationSync.findPositions.mockResolvedValue([]);

      const response = await service.exchange(makeUser(), { ...makeExchangeDto([makeBook()]), deviceTime: DEVICE_TIME } as AnnotationExchangeDto);

      expect(response.results[0].toApply.edit[0].datetimeUpdated).toBe('2026-10-18 08:58:39');
    });
  });

  it('builds add entries with projected drawer, named color and minted datetime', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        format: 'xpointer',
        pos0: '/body/DocFragment[1]/body/p/text().0',
        pos1: '/body/DocFragment[1]/body/p/text().5',
        status: 'pending',
        converterVersion: 1,
        extras: { pageno: 3 },
      },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    const add = response.results[0].toApply.add[0];
    expect(add).toMatchObject({
      serverId: 100,
      version: 2,
      datetime: '2026-06-08 10:00:00',
      drawer: 'underscore',
      color: 'yellow',
      text: 'highlighted text',
      note: 'a note',
      posFormat: 'xpointer',
      pos0: '/body/DocFragment[1]/body/p/text().0',
      pageno: 3,
    });
  });

  it('retries an unverified sidecar delivery as a complete add rather than editing a possibly missing entry', async () => {
    annotationSync.computePushDown.mockResolvedValue({
      adds: [],
      edits: [{ state: makeStateRow({ lastAppliedVersion: 0 }), annotation: makeAnnotationRow() }],
      deletes: [],
      more: false,
    });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        format: 'xpointer',
        pos0: '/body/p/text().0',
        pos1: '/body/p/text().16',
        status: 'exact',
        converterVersion: 1,
      },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(response.results[0].toApply.edit).toEqual([]);
    expect(response.results[0].toApply.add).toEqual([
      expect.objectContaining({
        serverId: 100,
        version: 2,
        posFormat: 'xpointer',
        pos0: '/body/p/text().0',
        pos1: '/body/p/text().16',
      }),
    ]);
  });

  it('converts missing xpointers within the budget and delivers them in the same exchange', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([{ annotationId: 100, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' }]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledWith({ bookFileId: 10, cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', text: 'highlighted text' });
    expect(annotationSync.upsertGeneratedPosition).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'xpointer', status: 'pending', pos0: '/body/DocFragment[1]/body/p/text().0' }),
    );
    expect(annotationSync.ensureDeviceCreatedAtMany).toHaveBeenCalledWith(7, 20, [expect.objectContaining({ id: 100 })], expect.any(Number));
    expect(response.results[0].toApply.add).toEqual([expect.objectContaining({ serverId: 100, pos0: '/body/DocFragment[1]/body/p/text().0' })]);
    expect(response.results[0].skippedNoPosition).toBe(0);
  });

  it('marks conversion failures and counts them as skipped without retrying at current version', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      { annotationId: 100, format: 'xpointer', pos0: null, pos1: null, status: 'failed', converterVersion: 1, extras: null },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).not.toHaveBeenCalled();
    expect(response.results[0].skippedNoPosition).toBe(1);
  });

  it('does not mint a device datetime for an annotation whose conversion failed', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([{ annotationId: 100, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' }]);
    positionConverter.cfiToXpointer.mockResolvedValue({ status: 'failed', reason: 'chapter_unavailable' });

    await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(annotationSync.upsertGeneratedPosition).not.toHaveBeenCalled();
    expect(annotationSync.ensureDeviceCreatedAtMany).toHaveBeenCalledWith(7, 20, [], expect.any(Number));
  });

  it('reads every push-down position in one query and mints identities in one batch', async () => {
    const adds = Array.from({ length: 3 }, (_, index) => makeAnnotationRow({ id: 100 + index }));
    annotationSync.computePushDown.mockResolvedValue({ adds, edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue(
      adds.map((annotation) => ({
        annotationId: annotation.id,
        format: 'xpointer',
        pos0: '/body/DocFragment[1]/body/p/text().0',
        pos1: '/body/DocFragment[1]/body/p/text().5',
        status: 'pending',
        converterVersion: 1,
        extras: null,
      })),
    );

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(annotationSync.findPositions).toHaveBeenCalledTimes(1);
    expect(annotationSync.findPositions).toHaveBeenCalledWith([100, 101, 102], ['pdf', 'xpointer', 'cfi']);
    expect(annotationSync.ensureDeviceCreatedAtMany).toHaveBeenCalledTimes(1);
    expect(response.results[0].toApply.add.map((entry) => entry.serverId)).toEqual([100, 101, 102]);
  });

  it('skips a PDF-only web highlight instead of pushing it to KOReader', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        format: 'pdf',
        pos0: '{"page":0,"rect":{"x":1,"y":2,"width":3,"height":4},"rects":[]}',
        pos1: null,
        status: 'exact',
        converterVersion: null,
        extras: { pageno: 7 },
      },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(response.results[0].toApply.add).toEqual([]);
    expect(response.results[0].skippedNoPosition).toBe(1);
    expect(positionConverter.cfiToXpointer).not.toHaveBeenCalled();
    expect(annotationSync.upsertGeneratedPosition).not.toHaveBeenCalled();
  });

  it('converts a mixed PDF+CFI annotation via its CFI instead of skipping it', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        format: 'pdf',
        pos0: '{"page":0,"rect":{"x":1,"y":2,"width":3,"height":4},"rects":[]}',
        pos1: null,
        status: 'exact',
        converterVersion: null,
        extras: { pageno: 7 },
      },
      { annotationId: 100, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', pos1: null, status: 'exact', converterVersion: null, extras: null },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledWith({ bookFileId: 10, cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', text: 'highlighted text' });
    expect(annotationSync.upsertGeneratedPosition).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'xpointer', status: 'pending', pos0: '/body/DocFragment[1]/body/p/text().0' }),
    );
    expect(response.results[0].toApply.add).toEqual([expect.objectContaining({ serverId: 100, pos0: '/body/DocFragment[1]/body/p/text().0' })]);
    expect(response.results[0].skippedNoPosition).toBe(0);
  });

  it('requests another exchange when successful conversion exhausts the budget', async () => {
    const adds = Array.from({ length: 22 }, (_, index) => makeAnnotationRow({ id: 200 + index }));
    annotationSync.computePushDown.mockResolvedValue({ adds, edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue(
      adds.map((annotation) => ({ annotationId: annotation.id, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' })),
    );

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledTimes(20);
    expect(response.results[0].skippedNoPosition).toBe(2);
    expect(response.results[0].more).toBe(true);
  });

  it('builds edit entries with a datetime_updated ahead of the last device edit', async () => {
    annotationSync.computePushDown.mockResolvedValue({
      adds: [],
      edits: [
        { state: makeStateRow(), annotation: makeAnnotationRow({ deviceCreatedAt: '2026-06-01 21:14:03', deviceUpdatedAt: '2026-06-10 09:00:00' }) },
      ],
      deletes: [],
      more: false,
    });

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    const edit = response.results[0].toApply.edit[0];
    expect(edit).toMatchObject({ serverId: 100, key: 'c'.repeat(32), datetime: '2026-06-01 21:14:03' });
    expect(edit.datetimeUpdated).toBe('2026-06-10 09:00:01');
  });

  it.each(['add', 'edit'] as const)('projects a sibling-file xpointer before %s delivery', async (kind) => {
    const annotation = makeAnnotationRow();
    annotationSync.computePushDown.mockResolvedValue({
      adds: kind === 'add' ? [annotation] : [],
      edits: kind === 'edit' ? [{ state: makeStateRow(), annotation }] : [],
      deletes: [],
      more: false,
    });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        bookFileId: 99,
        format: 'xpointer',
        pos0: '/body/foreign/text().0',
        pos1: '/body/foreign/text().5',
        status: 'exact',
        converterVersion: 1,
      },
      { annotationId: 100, bookFileId: 99, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 10, text: annotation.text }));
    expect(response.results[0].toApply[kind]).toEqual([
      expect.objectContaining({
        serverId: 100,
        pos0: '/body/DocFragment[1]/body/p/text().0',
        pos1: '/body/DocFragment[1]/body/p/text().5',
      }),
    ]);
  });

  it('withholds an unconvertible sibling edit without replacing its canonical anchor', async () => {
    annotationSync.computePushDown.mockResolvedValue({
      adds: [],
      edits: [{ state: makeStateRow(), annotation: makeAnnotationRow() }],
      deletes: [],
      more: false,
    });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        bookFileId: 99,
        format: 'xpointer',
        pos0: '/body/foreign/text().0',
        pos1: '/body/foreign/text().5',
        status: 'exact',
        converterVersion: 1,
      },
      { annotationId: 100, bookFileId: 99, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' },
    ]);
    positionConverter.cfiToXpointer.mockResolvedValue({ status: 'failed' });

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(response.results[0].toApply.edit).toEqual([]);
    expect(response.results[0].skippedNoPosition).toBe(1);
    expect(annotationSync.upsertGeneratedPosition).not.toHaveBeenCalled();
  });

  it('converts a device-only source range before delivering to a structurally different sibling', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      {
        annotationId: 100,
        bookFileId: 99,
        format: 'xpointer',
        pos0: '/body/source/text().0',
        pos1: '/body/source/text().5',
        status: 'exact',
        converterVersion: 1,
      },
    ]);
    positionConverter.xpointerToCfi.mockResolvedValue({ status: 'exact', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)' });

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.xpointerToCfi).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 99, pos0: '/body/source/text().0' }));
    expect(positionConverter.cfiToXpointer).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 10 }));
    expect(response.results[0].toApply.add).toHaveLength(1);
  });

  it('builds delete entries from sync state identity', async () => {
    annotationSync.computePushDown.mockResolvedValue({
      adds: [],
      edits: [],
      deletes: [{ state: makeStateRow(), annotation: makeAnnotationRow({ deletedAt: new Date() }) }],
      more: false,
    });

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(response.results[0].toApply.delete[0]).toEqual({
      serverId: 100,
      key: 'c'.repeat(32),
      datetime: '2026-06-01 21:14:03',
    });
  });

  it('routes acks per matched book into the sync service', async () => {
    annotationSync.applyExchangeAck.mockResolvedValue({ acked: 2 });
    const dto = {
      deviceId: DEVICE_ID,
      deviceModel: 'Kobo',
      pluginVersion: '0.4.0',
      books: [
        {
          hash: HASH_A,
          applied: [{ serverId: 100, version: 2, status: 'applied', verified: true }],
          deleted: [{ serverId: 101, status: 'applied' }],
        },
        { hash: HASH_B, applied: [], deleted: [] },
      ],
    } as unknown as AnnotationExchangeAckDto;

    const response = await service.exchangeAck(makeUser(), dto);

    expect(response.results).toEqual([{ hash: HASH_A, acked: 2 }]);
    expect(response.unmatched).toEqual([HASH_B]);
    expect(annotationSync.applyExchangeAck).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, deviceId: exchangeDeviceId(DEVICE_ID, HASH_A), bookFileId: 10, converterVersion: 1 }),
    );
  });
});
