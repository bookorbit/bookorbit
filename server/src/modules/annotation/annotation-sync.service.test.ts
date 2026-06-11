import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationSyncRepository } from './annotation-sync.repository';
import { AnnotationSyncService, buildAnnotationKey, type IncomingDeviceAnnotation } from './annotation-sync.service';

const USER_ID = 7;
const BOOK_ID = 20;
const BOOK_FILE_ID = 10;
const DEVICE_ID = 'device-aaaa-bbbb';
const TX = Symbol('tx');

function makeIncoming(overrides: Partial<IncomingDeviceAnnotation> = {}): IncomingDeviceAnnotation {
  return {
    datetime: '2026-06-01 21:14:03',
    datetimeUpdated: null,
    drawer: 'lighten',
    color: 'yellow',
    text: 'highlighted text',
    note: null,
    chapter: 'Chapter 1',
    pageno: 12,
    posFormat: 'xpointer',
    pos0: '/body/DocFragment[8]/body/p[12]/text().0',
    pos1: '/body/DocFragment[8]/body/p[12]/text().57',
    ...overrides,
  };
}

function makeAnnotationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    userId: USER_ID,
    bookId: BOOK_ID,
    text: 'highlighted text',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Chapter 1',
    origin: 'koreader',
    version: 1,
    deletedAt: null,
    deviceCreatedAt: '2026-06-01 21:14:03',
    deviceUpdatedAt: null,
    createdAt: new Date('2026-06-01T21:14:03Z'),
    updatedAt: new Date('2026-06-01T21:14:03Z'),
    ...overrides,
  };
}

function makePositionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 500,
    annotationId: 100,
    userId: USER_ID,
    bookFileId: BOOK_FILE_ID,
    format: 'xpointer',
    pos0: '/body/DocFragment[8]/body/p[12]/text().0',
    pos1: '/body/DocFragment[8]/body/p[12]/text().57',
    status: 'exact',
    converterVersion: null,
    extras: { pageno: 12 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    annotationId: 100,
    userId: USER_ID,
    source: 'koreader',
    deviceId: DEVICE_ID,
    externalKey: buildAnnotationKey('2026-06-01 21:14:03', '/body/DocFragment[8]/body/p[12]/text().0'),
    externalCreatedAt: '2026-06-01 21:14:03',
    lastAppliedVersion: 1,
    deleteAckedAt: null,
    firstSyncedAt: new Date(),
    lastSyncedAt: new Date(),
    ...overrides,
  };
}

type RepoMock = Record<keyof AnnotationSyncRepository, ReturnType<typeof vi.fn>>;

function makeRepo(): RepoMock {
  return {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
    findStateByDeviceKey: vi.fn().mockResolvedValue(null),
    findStateByKeyAnyDevice: vi.fn().mockResolvedValue(null),
    findAnnotationById: vi.fn().mockResolvedValue(null),
    findDevicePosition: vi.fn().mockResolvedValue(null),
    findCanonicalByDeviceDatetime: vi.fn().mockResolvedValue([]),
    insertState: vi.fn().mockImplementation((state: Record<string, unknown>) => Promise.resolve(makeStateRow(state))),
    updateState: vi.fn().mockResolvedValue(undefined),
    touchState: vi.fn().mockResolvedValue(undefined),
    createCanonical: vi.fn().mockImplementation((annotation: Record<string, unknown>) => Promise.resolve(makeAnnotationRow(annotation))),
    applyContentPatch: vi.fn().mockResolvedValue(2),
    updatePosition: vi.fn().mockResolvedValue(undefined),
    markPositionPending: vi.fn().mockResolvedValue(undefined),
    findStatesForDeviceBook: vi.fn().mockResolvedValue([]),
    findAddCandidates: vi.fn().mockResolvedValue([]),
    findEditCandidates: vi.fn().mockResolvedValue([]),
    findDeleteCandidates: vi.fn().mockResolvedValue([]),
    listDeviceCreatedAtsForBook: vi.fn().mockResolvedValue(new Set<string>()),
    setDeviceIdentitySilent: vi.fn().mockResolvedValue(undefined),
    setDeviceUpdatedAtSilent: vi.fn().mockResolvedValue(undefined),
    bumpVersion: vi.fn().mockResolvedValue(5),
    softDeleteById: vi.fn().mockResolvedValue(undefined),
    setDeleteAcked: vi.fn().mockResolvedValue(undefined),
    findStateByAnnotationAndDevice: vi.fn().mockResolvedValue(null),
    upsertPosition: vi.fn().mockResolvedValue(undefined),
    findPositionsByAnnotationIds: vi.fn().mockResolvedValue([]),
    findExternalKeyForAnnotation: vi.fn().mockResolvedValue(null),
    findStatesBySourceForBook: vi.fn().mockResolvedValue([]),
    findBookIdsWithPendingKoboChanges: vi.fn().mockResolvedValue([]),
  } as unknown as RepoMock;
}

function makeService(repo: RepoMock) {
  return new AnnotationSyncService(repo as unknown as AnnotationSyncRepository);
}

function ingest(service: AnnotationSyncService, annotations: IncomingDeviceAnnotation[]) {
  return service.ingestDeviceAnnotations({
    userId: USER_ID,
    source: 'koreader',
    deviceId: DEVICE_ID,
    bookId: BOOK_ID,
    bookFileId: BOOK_FILE_ID,
    annotations,
  });
}

describe('AnnotationSyncService', () => {
  let repo: RepoMock;
  let service: AnnotationSyncService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repo = makeRepo();
    service = makeService(repo);
  });

  describe('buildAnnotationKey', () => {
    it('is stable and sensitive to both datetime and pos0', () => {
      const key = buildAnnotationKey('2026-06-01 21:14:03', '/pos');
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(buildAnnotationKey('2026-06-01 21:14:03', '/pos')).toBe(key);
      expect(buildAnnotationKey('2026-06-01 21:14:04', '/pos')).not.toBe(key);
      expect(buildAnnotationKey('2026-06-01 21:14:03', '/other')).not.toBe(key);
    });
  });

  describe('create path', () => {
    it('creates canonical row, device position and sync state for an unknown annotation', async () => {
      const result = await ingest(service, [makeIncoming({ color: 'olive', drawer: 'underscore' })]);

      expect(result).toMatchObject({ created: 1, updated: 0, moved: 0, unchanged: 0, skippedDeleted: 0 });
      const [annotation, position, state] = repo.createCanonical.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(annotation).toMatchObject({
        userId: USER_ID,
        bookId: BOOK_ID,
        origin: 'koreader',
        style: 'underline',
        color: '#84CC16',
        version: 1,
        deviceCreatedAt: '2026-06-01 21:14:03',
      });
      expect(position).toMatchObject({
        bookFileId: BOOK_FILE_ID,
        format: 'xpointer',
        pos0: '/body/DocFragment[8]/body/p[12]/text().0',
        status: 'exact',
        extras: { pageno: 12 },
      });
      expect(state).toMatchObject({ source: 'koreader', deviceId: DEVICE_ID, lastAppliedVersion: 1 });
    });

    it('dedupes identical keys within one batch', async () => {
      const result = await ingest(service, [makeIncoming({ note: 'first' }), makeIncoming({ note: 'second' })]);

      expect(result.created).toBe(1);
      expect(repo.createCanonical).toHaveBeenCalledTimes(1);
      const [annotation] = repo.createCanonical.mock.calls[0] as [Record<string, unknown>];
      expect(annotation.note).toBe('second');
    });
  });

  describe('device-key match path', () => {
    it('treats a re-upload with no new edit as unchanged and only touches state', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow());
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming()]);

      expect(result).toMatchObject({ unchanged: 1, updated: 0, created: 0 });
      expect(repo.touchState).toHaveBeenCalled();
      expect(repo.applyContentPatch).not.toHaveBeenCalled();
    });

    it('does not clobber web edits when the device re-sends an old payload', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ note: 'web note', color: '#FACC15' }));
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming({ note: null, color: 'yellow' })]);

      expect(result.unchanged).toBe(1);
      expect(repo.applyContentPatch).not.toHaveBeenCalled();
    });

    it('applies a newer device edit with projected style and color', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ style: 'squiggly', color: '#FACC15' }));
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [
        makeIncoming({ datetimeUpdated: '2026-06-02 08:00:00', note: 'device note', drawer: 'underscore', color: 'yellow' }),
      ]);

      expect(result.updated).toBe(1);
      const patch = repo.applyContentPatch.mock.calls[0][1] as Record<string, unknown>;
      expect(patch).toMatchObject({ note: 'device note', deviceUpdatedAt: '2026-06-02 08:00:00' });
      // projection: underscore echoes squiggly, yellow echoes #FACC15 - neither overwrites
      expect(patch).not.toHaveProperty('style');
      expect(patch).not.toHaveProperty('color');
      expect(repo.updateState).toHaveBeenCalledWith(900, { lastAppliedVersion: 2 }, TX);
    });

    it('updates pos1 and marks the cfi position pending on highlight extension with same pos0', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow());
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming({ pos1: '/body/DocFragment[8]/body/p[13]/text().20' })]);

      expect(result.updated).toBe(1);
      expect(repo.updatePosition).toHaveBeenCalledWith(
        100,
        'xpointer',
        expect.objectContaining({ pos1: '/body/DocFragment[8]/body/p[13]/text().20' }),
        TX,
      );
      expect(repo.markPositionPending).toHaveBeenCalledWith(100, 'cfi', TX);
    });

    it('skips tombstoned annotations without resurrecting them', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ deletedAt: new Date() }));

      const result = await ingest(service, [makeIncoming({ datetimeUpdated: '2026-06-05 10:00:00', note: 'edit after delete' })]);

      expect(result.skippedDeleted).toBe(1);
      expect(repo.applyContentPatch).not.toHaveBeenCalled();
      expect(repo.createCanonical).not.toHaveBeenCalled();
    });
  });

  describe('cross-device and derived matches', () => {
    it('links a second device to an existing annotation via the shared key', async () => {
      repo.findStateByKeyAnyDevice.mockResolvedValue({
        state: makeStateRow({ deviceId: 'other-device' }),
        annotation: makeAnnotationRow({ version: 3 }),
      });
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming()]);

      expect(result.unchanged).toBe(1);
      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ deviceId: DEVICE_ID, lastAppliedVersion: 3 }), TX);
      expect(repo.createCanonical).not.toHaveBeenCalled();
    });

    it('arms deletion push for a tombstone matched cross-device', async () => {
      repo.findStateByKeyAnyDevice.mockResolvedValue({
        state: makeStateRow({ deviceId: 'other-device' }),
        annotation: makeAnnotationRow({ deletedAt: new Date(), version: 4 }),
      });

      const result = await ingest(service, [makeIncoming()]);

      expect(result.skippedDeleted).toBe(1);
      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ deviceId: DEVICE_ID }), TX);
    });

    it('reconnects a migrated annotation by datetime plus pos0 without creating a duplicate', async () => {
      repo.findCanonicalByDeviceDatetime.mockResolvedValue([{ annotation: makeAnnotationRow(), position: makePositionRow() }]);
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming()]);

      expect(result.unchanged).toBe(1);
      expect(repo.createCanonical).not.toHaveBeenCalled();
      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ deviceId: DEVICE_ID, lastAppliedVersion: 1 }), TX);
    });

    it('treats a known datetime with a different pos0 as a move, not a delete or duplicate', async () => {
      const oldPos = makePositionRow();
      repo.findCanonicalByDeviceDatetime.mockResolvedValue([{ annotation: makeAnnotationRow(), position: oldPos }]);
      repo.findDevicePosition.mockResolvedValue(makePositionRow({ pos0: '/body/DocFragment[8]/body/p[14]/text().5' }));
      const moved = makeIncoming({ pos0: '/body/DocFragment[8]/body/p[14]/text().5', pos1: '/body/DocFragment[8]/body/p[15]/text().9' });

      const result = await ingest(service, [moved]);

      expect(result.moved).toBe(1);
      expect(repo.updatePosition).toHaveBeenCalledWith(
        100,
        'xpointer',
        expect.objectContaining({ pos0: '/body/DocFragment[8]/body/p[14]/text().5', status: 'exact' }),
        TX,
      );
      expect(repo.markPositionPending).toHaveBeenCalledWith(100, 'cfi', TX);
      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ externalKey: buildAnnotationKey(moved.datetime, moved.pos0) }), TX);
      expect(repo.createCanonical).not.toHaveBeenCalled();
    });

    it('creates a new annotation when multiple same-datetime candidates are ambiguous', async () => {
      repo.findCanonicalByDeviceDatetime.mockResolvedValue([
        { annotation: makeAnnotationRow({ id: 100 }), position: makePositionRow({ pos0: '/a' }) },
        { annotation: makeAnnotationRow({ id: 101 }), position: makePositionRow({ pos0: '/b' }) },
      ]);

      const result = await ingest(service, [makeIncoming({ pos0: '/c' })]);

      expect(result.created).toBe(1);
      expect(repo.createCanonical).toHaveBeenCalled();
    });
  });

  describe('push echo handling', () => {
    it('records a bumped device timestamp without bumping the version when content is unchanged', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow());
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow());
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ingest(service, [makeIncoming({ datetimeUpdated: '2026-06-09 12:00:00' })]);

      expect(result.unchanged).toBe(1);
      expect(repo.applyContentPatch).not.toHaveBeenCalled();
      expect(repo.setDeviceUpdatedAtSilent).toHaveBeenCalledWith(100, '2026-06-09 12:00:00', TX);
    });
  });

  describe('detectDeviceDeletions', () => {
    const detect = (presentKeys: { k: string; dt: string }[]) =>
      service.detectDeviceDeletions({ userId: USER_ID, source: 'koreader', deviceId: DEVICE_ID, bookId: BOOK_ID, presentKeys });

    it('soft-deletes annotations missing from the device key set and acks this device', async () => {
      repo.findStatesForDeviceBook.mockResolvedValue([{ state: makeStateRow(), annotation: makeAnnotationRow() }]);

      const deleted = await detect([{ k: 'f'.repeat(32), dt: '2026-06-05 00:00:00' }]);

      expect(deleted).toBe(1);
      expect(repo.softDeleteById).toHaveBeenCalledWith(100, TX);
      expect(repo.setDeleteAcked).toHaveBeenCalledWith(900, TX);
    });

    it('keeps annotations whose key is still present', async () => {
      const state = makeStateRow();
      repo.findStatesForDeviceBook.mockResolvedValue([{ state, annotation: makeAnnotationRow() }]);

      const deleted = await detect([{ k: state.externalKey as string, dt: state.externalCreatedAt as string }]);

      expect(deleted).toBe(0);
      expect(repo.softDeleteById).not.toHaveBeenCalled();
    });

    it('treats a known datetime under a changed key as a move, not a delete', async () => {
      repo.findStatesForDeviceBook.mockResolvedValue([{ state: makeStateRow(), annotation: makeAnnotationRow() }]);

      const deleted = await detect([{ k: 'a'.repeat(32), dt: '2026-06-01 21:14:03' }]);

      expect(deleted).toBe(0);
      expect(repo.softDeleteById).not.toHaveBeenCalled();
    });

    it('ignores already-deleted annotations', async () => {
      repo.findStatesForDeviceBook.mockResolvedValue([{ state: makeStateRow(), annotation: makeAnnotationRow({ deletedAt: new Date() }) }]);

      const deleted = await detect([]);

      expect(deleted).toBe(0);
    });
  });

  describe('computePushDown', () => {
    it('orders deletes before edits before adds within the limit', async () => {
      repo.findDeleteCandidates.mockResolvedValue([{ state: makeStateRow({ id: 1 }), annotation: makeAnnotationRow({ id: 11 }) }]);
      repo.findEditCandidates.mockResolvedValue([{ state: makeStateRow({ id: 2 }), annotation: makeAnnotationRow({ id: 12 }) }]);
      repo.findAddCandidates.mockResolvedValue([makeAnnotationRow({ id: 13 })]);

      const result = await service.computePushDown(USER_ID, 'koreader', DEVICE_ID, BOOK_ID, 10);

      expect(result.deletes).toHaveLength(1);
      expect(result.edits).toHaveLength(1);
      expect(result.adds).toHaveLength(1);
      expect(result.more).toBe(false);
      expect(repo.findEditCandidates).toHaveBeenCalledWith(USER_ID, 'koreader', DEVICE_ID, BOOK_ID, 10);
      expect(repo.findAddCandidates).toHaveBeenCalledWith(USER_ID, 'koreader', DEVICE_ID, BOOK_ID, 9);
    });

    it('reports more when a category overflows the remaining budget', async () => {
      repo.findDeleteCandidates.mockResolvedValue([
        { state: makeStateRow({ id: 1 }), annotation: makeAnnotationRow({ id: 11 }) },
        { state: makeStateRow({ id: 2 }), annotation: makeAnnotationRow({ id: 12 }) },
      ]);

      const result = await service.computePushDown(USER_ID, 'koreader', DEVICE_ID, BOOK_ID, 1);

      expect(result.deletes).toHaveLength(1);
      expect(result.edits).toHaveLength(0);
      expect(result.adds).toHaveLength(0);
      expect(result.more).toBe(true);
    });
  });

  describe('ensureDeviceCreatedAt', () => {
    it('returns the existing identity datetime untouched', async () => {
      const annotation = makeAnnotationRow();
      const result = await service.ensureDeviceCreatedAt(USER_ID, BOOK_ID, annotation as never);
      expect(result).toBe('2026-06-01 21:14:03');
      expect(repo.setDeviceIdentitySilent).not.toHaveBeenCalled();
    });

    it('mints a unique UTC datetime from createdAt, skipping collisions', async () => {
      const annotation = makeAnnotationRow({ deviceCreatedAt: null, createdAt: new Date('2026-06-08T10:00:00Z') });
      repo.listDeviceCreatedAtsForBook.mockResolvedValue(new Set(['2026-06-08 10:00:00', '2026-06-08 10:00:01']));

      const result = await service.ensureDeviceCreatedAt(USER_ID, BOOK_ID, annotation as never);

      expect(result).toBe('2026-06-08 10:00:02');
      expect(repo.setDeviceIdentitySilent).toHaveBeenCalledWith(100, '2026-06-08 10:00:02');
    });
  });

  describe('applyExchangeAck', () => {
    const ack = (
      applied: Partial<Parameters<AnnotationSyncService['applyExchangeAck']>[0]['applied'][number]>[],
      deleted: { serverId: number; status: 'applied' | 'failed' }[] = [],
    ) =>
      service.applyExchangeAck({
        userId: USER_ID,
        source: 'koreader',
        deviceId: DEVICE_ID,
        bookFileId: BOOK_FILE_ID,
        applied: applied as never,
        deleted,
        converterVersion: 1,
      });

    it('advances lastAppliedVersion and verifies the position on a clean apply', async () => {
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ version: 3 }));
      repo.findDevicePosition.mockResolvedValue(makePositionRow());

      const result = await ack([{ serverId: 100, version: 3, status: 'applied', verified: true, datetimeUpdated: '2026-06-08 10:00:00' }]);

      expect(result.acked).toBe(1);
      expect(repo.updatePosition).toHaveBeenCalledWith(100, 'xpointer', { status: 'exact' }, TX);
      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ lastAppliedVersion: 3, deviceId: DEVICE_ID }), TX);
      expect(repo.setDeviceUpdatedAtSilent).toHaveBeenCalledWith(100, '2026-06-08 10:00:00', TX);
      expect(repo.bumpVersion).not.toHaveBeenCalled();
    });

    it('stores corrected positions, rewrites the key and bumps the version for other devices', async () => {
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ version: 3 }));
      repo.bumpVersion.mockResolvedValue(4);

      const result = await ack([
        {
          serverId: 100,
          version: 3,
          status: 'applied',
          verified: true,
          corrected: true,
          pos0: '/corrected/pos0',
          pos1: '/corrected/pos1',
          pageno: 7,
        },
      ]);

      expect(result.acked).toBe(1);
      expect(repo.upsertPosition).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'xpointer', pos0: '/corrected/pos0', pos1: '/corrected/pos1', status: 'repaired' }),
        TX,
      );
      expect(repo.bumpVersion).toHaveBeenCalledWith(100, TX);
      expect(repo.insertState).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAppliedVersion: 4,
          externalKey: buildAnnotationKey('2026-06-01 21:14:03', '/corrected/pos0'),
        }),
        TX,
      );
    });

    it('marks the position failed without creating device state on a failed apply', async () => {
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow());

      const result = await ack([{ serverId: 100, version: 3, status: 'failed' }]);

      expect(result.acked).toBe(1);
      expect(repo.updatePosition).toHaveBeenCalledWith(100, 'xpointer', { status: 'failed' }, TX);
      expect(repo.insertState).not.toHaveBeenCalled();
    });

    it('acks deletions by setting deleteAckedAt', async () => {
      repo.findStateByAnnotationAndDevice.mockResolvedValue(makeStateRow());

      const result = await ack([], [{ serverId: 100, status: 'applied' }]);

      expect(result.acked).toBe(1);
      expect(repo.setDeleteAcked).toHaveBeenCalledWith(900, TX);
    });

    it('ignores acks for annotations the user does not own', async () => {
      repo.findAnnotationById.mockResolvedValue(null);

      const result = await ack([{ serverId: 999, version: 1, status: 'applied' }]);

      expect(result.acked).toBe(0);
      expect(repo.insertState).not.toHaveBeenCalled();
    });
  });

  describe('kobo external-key identity', () => {
    const KOBO_UUID = '11111111-2222-3333-4444-555555555555';

    function makeKoboIncoming(overrides: Partial<IncomingDeviceAnnotation> = {}): IncomingDeviceAnnotation {
      return {
        externalKey: KOBO_UUID,
        datetime: '2026-06-01 21:14:03',
        datetimeUpdated: null,
        color: '#F6F3B3',
        colorSpace: 'kobo',
        style: 'highlight',
        text: 'highlighted text',
        note: null,
        chapter: 'Chapter 1',
        posFormat: 'kobo_span',
        pos0: 'kobo.3.1:0',
        pos1: 'kobo.3.1:16',
        posExtras: { koboLocation: { span: { startPath: 'span#kobo\\.3\\.1' } } },
        ...overrides,
      };
    }

    function ingestKobo(annotations: IncomingDeviceAnnotation[]) {
      return service.ingestDeviceAnnotations({
        userId: USER_ID,
        source: 'kobo',
        deviceId: '42',
        bookId: BOOK_ID,
        bookFileId: BOOK_FILE_ID,
        annotations,
      });
    }

    it('creates a canonical annotation with kobo color mapping and location extras', async () => {
      const result = await ingestKobo([makeKoboIncoming()]);

      expect(result.created).toBe(1);
      expect(repo.findCanonicalByDeviceDatetime).not.toHaveBeenCalled();
      const [annotation, position, state] = repo.createCanonical.mock.calls[0];
      expect(annotation).toMatchObject({ color: '#FACC15', style: 'highlight', origin: 'kobo' });
      expect(position).toMatchObject({
        format: 'kobo_span',
        pos0: 'kobo.3.1:0',
        pos1: 'kobo.3.1:16',
        extras: { koboLocation: { span: { startPath: 'span#kobo\\.3\\.1' } } },
      });
      expect(state).toMatchObject({ externalKey: KOBO_UUID });
    });

    it('dedupes incoming batches by the external key', async () => {
      const result = await ingestKobo([makeKoboIncoming({ text: 'first' }), makeKoboIncoming({ text: 'second' })]);
      expect(result.created).toBe(1);
      expect(repo.createCanonical).toHaveBeenCalledTimes(1);
      expect(repo.createCanonical.mock.calls[0][0]).toMatchObject({ text: 'second' });
    });

    it('updates the position and invalidates siblings when pos0 changes under the same key', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow({ externalKey: KOBO_UUID, source: 'kobo', deviceId: '42' }));
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ origin: 'kobo', color: '#FACC15' }));
      repo.findDevicePosition.mockResolvedValue(makePositionRow({ format: 'kobo_span', pos0: 'kobo.2.1:0', pos1: 'kobo.2.1:9' }));

      const result = await ingestKobo([makeKoboIncoming()]);

      expect(result.updated).toBe(1);
      expect(repo.updatePosition).toHaveBeenCalledWith(
        100,
        'kobo_span',
        expect.objectContaining({ pos0: 'kobo.3.1:0', pos1: 'kobo.3.1:16', status: 'exact' }),
        TX,
      );
      expect(repo.markPositionPending).toHaveBeenCalledWith(100, 'cfi', TX);
      expect(repo.markPositionPending).toHaveBeenCalledWith(100, 'xpointer', TX);
    });

    it('keeps the canonical color when the device echoes the projected kobo color', async () => {
      repo.findStateByDeviceKey.mockResolvedValue(makeStateRow({ externalKey: KOBO_UUID, source: 'kobo', deviceId: '42' }));
      repo.findAnnotationById.mockResolvedValue(makeAnnotationRow({ origin: 'web', color: '#FB923C' }));
      repo.findDevicePosition.mockResolvedValue(makePositionRow({ format: 'kobo_span', pos0: 'kobo.3.1:0', pos1: 'kobo.3.1:16' }));

      // Orange projects to kobo yellow; the echo of that yellow must not overwrite orange.
      const result = await ingestKobo([makeKoboIncoming({ datetimeUpdated: '2026-06-02 08:00:00', note: 'new note' })]);

      expect(result.updated).toBe(1);
      const patch = repo.applyContentPatch.mock.calls[0][1];
      expect(patch.note).toBe('new note');
      expect(patch.color).toBeUndefined();
    });
  });

  describe('applyDeviceDeletes', () => {
    const KOBO_UUID = '99999999-8888-7777-6666-555555555555';

    it('soft-deletes by any-device key and acks the reporting device', async () => {
      const state = makeStateRow({ externalKey: KOBO_UUID, source: 'kobo', deviceId: '42' });
      repo.findStateByKeyAnyDevice.mockResolvedValue({ state, annotation: makeAnnotationRow() });

      const deleted = await service.applyDeviceDeletes({
        userId: USER_ID,
        source: 'kobo',
        deviceId: '42',
        bookId: BOOK_ID,
        deletes: [{ externalKey: KOBO_UUID }],
      });

      expect(deleted).toBe(1);
      expect(repo.softDeleteById).toHaveBeenCalledWith(100, TX);
      expect(repo.setDeleteAcked).toHaveBeenCalledWith(900, TX);
    });

    it('inserts an acked state when another device reported the deletion', async () => {
      const state = makeStateRow({ externalKey: KOBO_UUID, source: 'kobo', deviceId: '42' });
      repo.findStateByKeyAnyDevice.mockResolvedValue({ state, annotation: makeAnnotationRow() });
      repo.findStateByAnnotationAndDevice.mockResolvedValue(null);

      await service.applyDeviceDeletes({
        userId: USER_ID,
        source: 'kobo',
        deviceId: '77',
        bookId: BOOK_ID,
        deletes: [{ externalKey: KOBO_UUID }],
      });

      expect(repo.insertState).toHaveBeenCalledWith(expect.objectContaining({ deviceId: '77', externalKey: KOBO_UUID }), TX);
      expect(repo.setDeleteAcked).toHaveBeenCalled();
    });

    it('ignores unknown keys', async () => {
      repo.findStateByKeyAnyDevice.mockResolvedValue(null);
      const deleted = await service.applyDeviceDeletes({
        userId: USER_ID,
        source: 'kobo',
        deviceId: '42',
        bookId: BOOK_ID,
        deletes: [{ externalKey: KOBO_UUID }],
      });
      expect(deleted).toBe(0);
      expect(repo.softDeleteById).not.toHaveBeenCalled();
    });
  });

  describe('markServedApplied', () => {
    it('upserts served states and acks omitted tombstones', async () => {
      await service.markServedApplied({
        userId: USER_ID,
        source: 'kobo',
        deviceId: '42',
        entries: [{ annotationId: 100, version: 4, externalKey: 'uuid-1', externalCreatedAt: '2026-06-01 21:14:03' }],
        tombstoneStateIds: [901, 902],
      });

      expect(repo.insertState).toHaveBeenCalledWith(
        expect.objectContaining({ annotationId: 100, lastAppliedVersion: 4, externalKey: 'uuid-1', deviceId: '42' }),
        TX,
      );
      expect(repo.setDeleteAcked).toHaveBeenCalledWith(901, TX);
      expect(repo.setDeleteAcked).toHaveBeenCalledWith(902, TX);
    });

    it('does nothing on empty input', async () => {
      await service.markServedApplied({ userId: USER_ID, source: 'kobo', deviceId: '42', entries: [], tombstoneStateIds: [] });
      expect(repo.transaction).not.toHaveBeenCalled();
    });
  });

  describe('ensureExternalKey', () => {
    it('returns the existing key when one device already holds it', async () => {
      repo.findExternalKeyForAnnotation.mockResolvedValue('existing-uuid');
      expect(await service.ensureExternalKey(100, 'kobo', () => 'minted')).toBe('existing-uuid');
    });

    it('mints a new key otherwise', async () => {
      expect(await service.ensureExternalKey(100, 'kobo', () => 'minted')).toBe('minted');
    });
  });
});
