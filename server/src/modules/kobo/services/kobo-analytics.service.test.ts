import { Logger } from '@nestjs/common';

import type { KoboAnalyticsEvent } from '../kobo-analytics.types';
import { KoboAnalyticsService } from './kobo-analytics.service';

describe('KoboAnalyticsService', () => {
  const bookIdentityService = { resolveBookIdByEntitlementId: vi.fn() };
  const resolver = { resolveBookFileId: vi.fn() };
  const readingSessionService = { save: vi.fn() };
  const bookService = { bulkSetRating: vi.fn() };
  const user = { id: 7 } as never;
  const device = { deviceId: 2, deviceToken: 'tok', userId: 7 } as never;

  function makeService() {
    return new KoboAnalyticsService(bookIdentityService as never, resolver as never, readingSessionService as never, bookService as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookIdentityService.resolveBookIdByEntitlementId.mockImplementation((_userId: number, id: string) =>
      /^\d+$/.test(id) ? Promise.resolve(Number(id)) : Promise.resolve(null),
    );
    resolver.resolveBookFileId.mockResolvedValue({ kind: 'resolved', bookFileId: 100 });
    readingSessionService.save.mockResolvedValue(undefined);
    bookService.bulkSetRating.mockResolvedValue(undefined);
  });

  it('maps LeaveContent to reading sessions (duration minimum enforced in ReadingSessionService.save)', async () => {
    const events: KoboAnalyticsEvent[] = [
      {
        Id: '9aa9fefd-21e7-4974-8123-6a7fa58bd771',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:37:36Z',
        Metrics: { SecondsRead: 10 },
        Attributes: { volumeid: '1', progress: '4' },
      },
      {
        Id: 'ca3fcb0b-3e16-440a-985e-b754cdf904d8',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:38:13Z',
        Metrics: { SecondsRead: 34 },
        Attributes: { volumeid: '1', progress: '6' },
      },
      {
        Id: '21c140de-5341-4d6f-af0d-412b769d0135',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:38:58Z',
        Metrics: { SecondsRead: 4 },
        Attributes: { volumeid: '1', progress: '6' },
      },
    ];

    await makeService().ingest({ Events: events }, user, device);

    expect(resolver.resolveBookFileId).toHaveBeenCalledTimes(3);
    expect(readingSessionService.save).toHaveBeenCalledTimes(3);
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      1,
      100,
      {
        sessionId: '9aa9fefd-21e7-4974-8123-6a7fa58bd771',
        startedAt: '2026-06-01T00:37:26.000Z',
        endedAt: '2026-06-01T00:37:36.000Z',
        durationSeconds: 10,
        progressDelta: null,
        endProgress: 4,
      },
      user,
      'kobo',
    );
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      2,
      100,
      expect.objectContaining({
        sessionId: 'ca3fcb0b-3e16-440a-985e-b754cdf904d8',
        durationSeconds: 34,
        endProgress: 6,
      }),
      user,
      'kobo',
    );
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      3,
      100,
      expect.objectContaining({
        sessionId: '21c140de-5341-4d6f-af0d-412b769d0135',
        durationSeconds: 4,
      }),
      user,
      'kobo',
    );
  });

  it('tags Kobo reading sessions with the kobo source', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'kobo-src',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 20 },
            Attributes: { volumeid: '1', progress: '5' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenCalledWith(100, expect.objectContaining({ sessionId: 'kobo-src' }), user, 'kobo');
  });

  it('pairs OpenContent and LeaveContent to save progress delta and active duration', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'open-forward',
            EventType: 'OpenContent',
            Timestamp: '2026-06-06T18:20:01Z',
            Metrics: {},
            Attributes: { volumeid: '1', progress: '8' },
          },
          {
            Id: 'leave-forward',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-06T18:20:52Z',
            Metrics: { SecondsRead: 52, IdleTime: 3 },
            Attributes: { volumeid: '1', progress: '12' },
          },
          {
            Id: 'open-backward',
            EventType: 'OpenContent',
            Timestamp: '2026-06-06T18:21:18Z',
            Metrics: {},
            Attributes: { volumeid: '1', progress: '12' },
          },
          {
            Id: 'leave-backward',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-06T18:21:44Z',
            Metrics: { SecondsRead: 26, IdleTime: 2 },
            Attributes: { volumeid: '1', progress: '10' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenCalledTimes(2);
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      1,
      100,
      {
        sessionId: 'leave-forward',
        startedAt: '2026-06-06T18:20:01.000Z',
        endedAt: '2026-06-06T18:20:52.000Z',
        durationSeconds: 49,
        progressDelta: 4,
        endProgress: 12,
      },
      user,
      'kobo',
    );
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      2,
      100,
      {
        sessionId: 'leave-backward',
        startedAt: '2026-06-06T18:21:18.000Z',
        endedAt: '2026-06-06T18:21:44.000Z',
        durationSeconds: 24,
        progressDelta: -2,
        endProgress: 10,
      },
      user,
      'kobo',
    );
  });

  it('pairs sessions independently by volumeid', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'open-one',
            EventType: 'OpenContent',
            Timestamp: '2026-06-01T00:00:00Z',
            Attributes: { volumeid: '1', progress: '1' },
          },
          {
            Id: 'open-two',
            EventType: 'OpenContent',
            Timestamp: '2026-06-01T00:00:01Z',
            Attributes: { volumeid: '2', progress: '20' },
          },
          {
            Id: 'leave-one',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1', progress: '3' },
          },
          {
            Id: 'leave-two',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:25Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '2', progress: '25' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      1,
      100,
      expect.objectContaining({ sessionId: 'leave-one', progressDelta: 2 }),
      user,
      'kobo',
    );
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      2,
      100,
      expect.objectContaining({ sessionId: 'leave-two', progressDelta: 5 }),
      user,
      'kobo',
    );
  });

  it('falls back to null progressDelta when the paired open progress is invalid', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'open-bad-progress',
            EventType: 'OpenContent',
            Timestamp: '2026-06-01T00:00:00Z',
            Attributes: { volumeid: '1', progress: 'bad' },
          },
          {
            Id: 'leave-after-bad-progress',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1', progress: '20' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ sessionId: 'leave-after-bad-progress', progressDelta: null, endProgress: 20 }),
      user,
      'kobo',
    );
  });

  it('uses raw SecondsRead when IdleTime is invalid', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'invalid-idle',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 20, IdleTime: '5' as never },
            Attributes: { volumeid: '1', progress: '20' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        sessionId: 'invalid-idle',
        startedAt: '2026-06-01T00:00:00.000Z',
        durationSeconds: 20,
      }),
      user,
      'kobo',
    );
  });

  it('treats empty or invalid progress as null', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'empty-progress',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1', progress: '' },
          },
          {
            Id: 'bad-progress',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:30Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1', progress: 'garbage' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).toHaveBeenNthCalledWith(1, 100, expect.objectContaining({ endProgress: null }), user, 'kobo');
    expect(readingSessionService.save).toHaveBeenNthCalledWith(2, 100, expect.objectContaining({ endProgress: null }), user, 'kobo');
  });

  it('still processes later events when an earlier save throws', async () => {
    readingSessionService.save.mockRejectedValueOnce(new Error('access denied')).mockResolvedValueOnce(undefined);

    const events: KoboAnalyticsEvent[] = [
      {
        Id: 'first',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:00:10Z',
        Metrics: { SecondsRead: 12 },
        Attributes: { volumeid: '1', progress: '5' },
      },
      {
        Id: 'second',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:00:20Z',
        Metrics: { SecondsRead: 15 },
        Attributes: { volumeid: '1' },
      },
    ];

    await makeService().ingest({ Events: events }, user, device);

    expect(readingSessionService.save).toHaveBeenCalledTimes(2);
  });

  it('ignores volumeid values that do not resolve to a book', async () => {
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(null);

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'partial',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:10Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '12abc' },
          },
          {
            Id: 'decimal',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:20Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1.5' },
          },
        ],
      },
      user,
      device,
    );

    expect(resolver.resolveBookFileId).not.toHaveBeenCalled();
    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('resolves UUID entitlement volumeid values via book identity', async () => {
    const entitlementId = '11111111-1111-4111-8111-111111111111';
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(9);

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'uuid-volume',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:10Z',
            Metrics: { SecondsRead: 20 },
            Attributes: { volumeid: entitlementId, progress: '8' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookIdentityService.resolveBookIdByEntitlementId).toHaveBeenCalledWith(7, entitlementId);
    expect(resolver.resolveBookFileId).toHaveBeenCalledWith(7, 9);
    expect(readingSessionService.save).toHaveBeenCalledWith(100, expect.objectContaining({ sessionId: 'uuid-volume', endProgress: 8 }), user, 'kobo');
  });

  it('skips LeaveContent without volumeid or SecondsRead', async () => {
    await makeService().ingest(
      {
        Events: [
          { Id: 'a', EventType: 'LeaveContent', Timestamp: '2026-06-01T00:00:00Z', Metrics: {} },
          { Id: 'b', EventType: 'LeaveContent', Timestamp: '2026-06-01T00:00:00Z', Attributes: { volumeid: '1' } },
          {
            Id: 'c',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:00Z',
            Metrics: { SecondsRead: 10 },
            Attributes: { volumeid: 1 as never },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).not.toHaveBeenCalled();
    expect(bookIdentityService.resolveBookIdByEntitlementId).not.toHaveBeenCalled();
  });

  it('ignores non-session analytics event types', async () => {
    await makeService().ingest(
      { Events: [{ Id: 'x', EventType: 'OpenContent', Timestamp: '2026-06-01T00:00:00Z', Attributes: { volumeid: '1' } }] },
      user,
      device,
    );

    expect(resolver.resolveBookFileId).not.toHaveBeenCalled();
    expect(bookService.bulkSetRating).not.toHaveBeenCalled();
  });

  it('maps RateBook to user ratings via bulkSetRating', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: '74db9ad6-152a-4a97-91d1-129308e4b591',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 4 },
            Attributes: { volumeid: '1', title: 'Promise of Blood', progress: '7' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookIdentityService.resolveBookIdByEntitlementId).toHaveBeenCalledWith(7, '1');
    expect(bookService.bulkSetRating).toHaveBeenCalledWith([1], 4, user);
    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('resolves UUID entitlement volumeid values for RateBook', async () => {
    const entitlementId = '11111111-1111-4111-8111-111111111111';
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(9);

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'rate-uuid',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 5 },
            Attributes: { volumeid: entitlementId },
          },
        ],
      },
      user,
      device,
    );

    expect(bookService.bulkSetRating).toHaveBeenCalledWith([9], 5, user);
  });

  it('ignores malformed RateBook events', async () => {
    await makeService().ingest(
      {
        Events: [
          { Id: 'no-stars', EventType: 'RateBook', Timestamp: '2026-06-01T00:40:50Z', Attributes: { volumeid: '1' } },
          {
            Id: 'no-volume',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 4 },
            Attributes: {},
          },
          {
            Id: 'too-high',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 6 },
            Attributes: { volumeid: '1' },
          },
          {
            Id: 'fractional-stars',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 3.5 },
            Attributes: { volumeid: '1' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookService.bulkSetRating).not.toHaveBeenCalled();
    expect(bookIdentityService.resolveBookIdByEntitlementId).not.toHaveBeenCalled();
  });

  it('ignores RateBook when volumeid does not resolve to a book', async () => {
    bookIdentityService.resolveBookIdByEntitlementId.mockResolvedValue(null);

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'bad-volume',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 4 },
            Attributes: { volumeid: 'unknown-entitlement' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookIdentityService.resolveBookIdByEntitlementId).toHaveBeenCalledWith(7, 'unknown-entitlement');
    expect(bookService.bulkSetRating).not.toHaveBeenCalled();
  });

  it('clears the user rating when Kobo sends stars: 0', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'clear-rating',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 0 },
            Attributes: { volumeid: '1' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookService.bulkSetRating).toHaveBeenCalledWith([1], null, user);
  });

  it('processes RateBook and LeaveContent in the same batch', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'rate',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 3 },
            Attributes: { volumeid: '1' },
          },
          {
            Id: 'leave',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:41:00Z',
            Metrics: { SecondsRead: 20 },
            Attributes: { volumeid: '1', progress: '8' },
          },
        ],
      },
      user,
      device,
    );

    expect(bookService.bulkSetRating).toHaveBeenCalledWith([1], 3, user);
    expect(readingSessionService.save).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when bulkSetRating throws', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    bookService.bulkSetRating.mockRejectedValueOnce(new Error('forbidden'));

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'rate-fail',
            EventType: 'RateBook',
            Timestamp: '2026-06-01T00:40:50Z',
            Metrics: { stars: 4 },
            Attributes: { volumeid: '1' },
          },
        ],
      },
      user,
      device,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[kobo.analytics.rating] [fail]'));
    warnSpy.mockRestore();
  });

  it('warns and skips ingest when Events is not an array', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await makeService().ingest({ Events: 'not-an-array' } as never, user, device);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid Events envelope'));
    expect(readingSessionService.save).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not call save when resolver skips', async () => {
    resolver.resolveBookFileId.mockResolvedValue({ kind: 'skipped', reason: 'no_epub_file' });

    await makeService().ingest(
      {
        Events: [
          {
            Id: 's',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:00Z',
            Metrics: { SecondsRead: 20 },
            Attributes: { volumeid: '3' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('ignores LeaveContent with an invalid timestamp', async () => {
    await makeService().ingest(
      {
        Events: [
          {
            Id: 'bad-ts',
            EventType: 'LeaveContent',
            Timestamp: 'not-a-date',
            Metrics: { SecondsRead: 20 },
            Attributes: { volumeid: '1', progress: '5' },
          },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('treats null or missing Events as an empty batch', async () => {
    await makeService().ingest(null, user, device);
    await makeService().ingest({}, user, device);

    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('logs a warning when a non-Error is thrown during save', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    readingSessionService.save.mockRejectedValueOnce('boom');

    await makeService().ingest(
      {
        Events: [
          {
            Id: 'err',
            EventType: 'LeaveContent',
            Timestamp: '2026-06-01T00:00:10Z',
            Metrics: { SecondsRead: 12 },
            Attributes: { volumeid: '1' },
          },
        ],
      },
      user,
      device,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
    warnSpy.mockRestore();
  });

  it('summarizes events with missing event types', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    await makeService().ingest(
      {
        Events: [{ Id: 'x', EventType: undefined as never, Timestamp: '2026-06-01T00:00:00Z' }],
      },
      user,
      device,
    );

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('types=(missing):1'));
    debugSpy.mockRestore();
  });

  it('falls back when analytics payload cannot be stringified', async () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await makeService().ingest(circular as never, user, device);

    expect(debugSpy).toHaveBeenCalled();
    expect(readingSessionService.save).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});
