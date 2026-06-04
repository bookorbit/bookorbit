import { Logger } from '@nestjs/common';

import type { KoboAnalyticsEvent } from '../kobo-analytics.types';
import { KoboAnalyticsService } from './kobo-analytics.service';

describe('KoboAnalyticsService', () => {
  const resolver = { resolveBookFileId: vi.fn() };
  const readingSessionService = { save: vi.fn() };
  const user = { id: 7 } as never;
  const device = { deviceId: 2, deviceToken: 'tok', userId: 7 } as never;

  function makeService() {
    return new KoboAnalyticsService(resolver as never, readingSessionService as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolver.resolveBookFileId.mockResolvedValue({ kind: 'resolved', bookFileId: 100 });
    readingSessionService.save.mockResolvedValue(undefined);
  });

  it('maps LeaveContent to reading sessions (duration minimum enforced in ReadingSessionService.save)', async () => {
    const events: KoboAnalyticsEvent[] = [
      {
        Id: '9aa9fefd-21e7-4974-8123-6a7fa58bd771',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:37:36Z',
        Metrics: { SecondsRead: 10, IdleTime: 4 },
        Attributes: { volumeid: '1', progress: '4' },
      },
      {
        Id: 'ca3fcb0b-3e16-440a-985e-b754cdf904d8',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:38:13Z',
        Metrics: { SecondsRead: 34, IdleTime: 6 },
        Attributes: { volumeid: '1', progress: '6' },
      },
      {
        Id: '21c140de-5341-4d6f-af0d-412b769d0135',
        EventType: 'LeaveContent',
        Timestamp: '2026-06-01T00:38:58Z',
        Metrics: { SecondsRead: 4, IdleTime: 4 },
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
    );
    expect(readingSessionService.save).toHaveBeenNthCalledWith(
      3,
      100,
      expect.objectContaining({
        sessionId: '21c140de-5341-4d6f-af0d-412b769d0135',
        durationSeconds: 4,
      }),
      user,
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

    expect(readingSessionService.save).toHaveBeenNthCalledWith(1, 100, expect.objectContaining({ endProgress: null }), user);
    expect(readingSessionService.save).toHaveBeenNthCalledWith(2, 100, expect.objectContaining({ endProgress: null }), user);
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

  it('skips LeaveContent without volumeid or SecondsRead', async () => {
    await makeService().ingest(
      {
        Events: [
          { Id: 'a', EventType: 'LeaveContent', Timestamp: '2026-06-01T00:00:00Z', Metrics: {} },
          { Id: 'b', EventType: 'LeaveContent', Timestamp: '2026-06-01T00:00:00Z', Attributes: { volumeid: '1' } },
        ],
      },
      user,
      device,
    );

    expect(readingSessionService.save).not.toHaveBeenCalled();
  });

  it('ignores non-session analytics event types', async () => {
    await makeService().ingest(
      { Events: [{ Id: 'x', EventType: 'OpenContent', Timestamp: '2026-06-01T00:00:00Z', Attributes: { volumeid: '1' } }] },
      user,
      device,
    );

    expect(resolver.resolveBookFileId).not.toHaveBeenCalled();
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
});
