import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AnnotationSyncService } from '../annotation/annotation-sync.service';
import type { PositionConverterService } from '../position-converter/position-converter.service';
import type { AnnotationExchangeAckDto, AnnotationExchangeDto } from './dto';
import { KoreaderAnnotationExchangeService } from './koreader-annotation-exchange.service';
import type { KoreaderRepository } from './koreader.repository';

const DEVICE_ID = 'device-1234';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

function makeUser(): RequestUser {
  return { id: 7, settings: {} } as unknown as RequestUser;
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
  let positionConverter: { version: number; cfiToXpointer: ReturnType<typeof vi.fn> };
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
      expect.objectContaining({ userId: 7, deviceId: DEVICE_ID, bookId: 20, presentKeys: keys }),
    );
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

  it('converts missing xpointers within the budget and defers the entry to the next exchange', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([{ annotationId: 100, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' }]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledWith({ bookFileId: 10, cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', text: 'highlighted text' });
    expect(annotationSync.upsertGeneratedPosition).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'xpointer', status: 'pending', pos0: '/body/DocFragment[1]/body/p/text().0' }),
    );
    expect(annotationSync.ensureDeviceCreatedAtMany).toHaveBeenCalledWith(7, 20, [expect.objectContaining({ id: 100 })], expect.any(Number));
    expect(response.results[0].toApply.add).toEqual([]);
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

    expect(annotationSync.upsertGeneratedPosition).toHaveBeenCalledWith(expect.objectContaining({ format: 'xpointer', status: 'failed' }));
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

  it('prefers a pdf position over an xpointer for the same annotation', async () => {
    annotationSync.computePushDown.mockResolvedValue({ adds: [makeAnnotationRow()], edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue([
      { annotationId: 100, format: 'xpointer', pos0: '/xpointer', pos1: null, status: 'pending', converterVersion: 1, extras: null },
      { annotationId: 100, format: 'pdf', pos0: 'pdf-pos', pos1: null, status: 'exact', converterVersion: null, extras: { pageno: 7 } },
    ]);

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(response.results[0].toApply.add[0]).toMatchObject({ posFormat: 'pdf', pos0: 'pdf-pos', pageno: 7 });
  });

  it('stops converting after the per-request budget and skips the rest', async () => {
    const adds = Array.from({ length: 22 }, (_, index) => makeAnnotationRow({ id: 200 + index }));
    annotationSync.computePushDown.mockResolvedValue({ adds, edits: [], deletes: [], more: false });
    annotationSync.findPositions.mockResolvedValue(
      adds.map((annotation) => ({ annotationId: annotation.id, format: 'cfi', pos0: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', status: 'exact' })),
    );

    const response = await service.exchange(makeUser(), makeExchangeDto([makeBook()]));

    expect(positionConverter.cfiToXpointer).toHaveBeenCalledTimes(20);
    expect(response.results[0].skippedNoPosition).toBe(2);
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
      expect.objectContaining({ userId: 7, deviceId: DEVICE_ID, bookFileId: 10, converterVersion: 1 }),
    );
  });
});
