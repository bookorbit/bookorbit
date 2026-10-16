import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

type KoboDevice = { id: number; token: string };
type Book = { bookId: number; bookFileId: number; entitlementId: string };
type MeasuredSession = { id: string; startedAt: string; endedAt: string; seconds: number };

const BOOK_COUNT = 13;
const RUN = randomUUID().slice(0, 8);

/** Day `n` of a calendar that starts on 2026-03-01, so every scenario owns its own dates. */
function day(n: number): string {
  return new Date(Date.UTC(2026, 2, n)).toISOString().slice(0, 10);
}

function at(n: number, time: string): string {
  return `${day(n)}T${time}.000Z`;
}

function measured(name: string, n: number, from: string, to: string): MeasuredSession {
  const startedAt = at(n, from);
  const endedAt = at(n, to);
  return { id: `${RUN}-${name}`, startedAt, endedAt, seconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 };
}

describe('Kobo reading time reconciliation (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let userId!: number;
  let books!: Book[];
  let deviceA!: KoboDevice;
  let deviceB!: KoboDevice;

  async function createDevice(name: string): Promise<KoboDevice> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(ctx.adminToken),
      payload: { name },
    });
    expect([200, 201]).toContain(response.statusCode);
    return response.json() as KoboDevice;
  }

  async function drainLibrary(device: KoboDevice): Promise<void> {
    let syncToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/kobo/${device.token}/v1/library/sync`,
        headers: syncToken ? { 'x-kobo-synctoken': syncToken } : undefined,
      });
      expect(response.statusCode).toBe(200);
      if (response.headers['x-kobo-sync'] !== 'continue') return;
      syncToken = response.headers['x-kobo-synctoken'] as string;
    }
    throw new Error(`Kobo device ${device.id} did not finish syncing within ten pages`);
  }

  /** A state push carrying the device reading-time counter, as sent when a book is closed or a sync starts. */
  async function pushCounter(device: KoboDevice, book: Book, minutes: number, lastModified: string, progressPercent = 10): Promise<void> {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/kobo/${device.token}/v1/library/${book.entitlementId}/state`,
      payload: {
        ReadingStates: [
          {
            EntitlementId: book.entitlementId,
            LastModified: lastModified,
            PriorityTimestamp: lastModified,
            CurrentBookmark: { LastModified: lastModified, ProgressPercent: progressPercent },
            Statistics: { LastModified: lastModified, SpentReadingMinutes: minutes },
            StatusInfo: { LastModified: lastModified, Status: 'Reading' },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
  }

  /** The analytics batch a device that still measures its sessions sends with a library sync. */
  async function sendMeasured(device: KoboDevice, book: Book, sessions: MeasuredSession[]): Promise<void> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/kobo/${device.token}/v1/analytics/event`,
      payload: {
        Events: sessions.flatMap((session) => [
          { Id: `${session.id}-open`, EventType: 'OpenContent', Timestamp: session.startedAt, Attributes: { volumeid: book.entitlementId } },
          {
            Id: session.id,
            EventType: 'LeaveContent',
            Timestamp: session.endedAt,
            Metrics: { SecondsRead: session.seconds },
            Attributes: { volumeid: book.entitlementId },
          },
        ]),
      },
    });
    expect(response.statusCode).toBe(200);
  }

  async function storedSessions(book: Book) {
    const rows = await ctx.db
      .select({
        sessionId: schema.readingSessions.sessionId,
        sourceDeviceKey: schema.readingSessions.sourceDeviceKey,
        startedAt: schema.readingSessions.startedAt,
        endedAt: schema.readingSessions.endedAt,
        durationSeconds: schema.readingSessions.durationSeconds,
        progressDelta: schema.readingSessions.progressDelta,
        syncIntervalStartedAt: schema.readingSessions.syncIntervalStartedAt,
      })
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.userId, userId), eq(schema.readingSessions.bookId, book.bookId)))
      .orderBy(asc(schema.readingSessions.startedAt), asc(schema.readingSessions.id));

    return rows.map((row) => ({
      sessionId: row.sessionId,
      device: row.sourceDeviceKey,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      seconds: row.durationSeconds,
      progressDelta: row.progressDelta,
      intervalStartedAt: row.syncIntervalStartedAt?.toISOString() ?? null,
    }));
  }

  function estimate(
    device: KoboDevice,
    book: Book,
    counter: number,
    endedAt: string,
    seconds: number,
    intervalStartedAt: string,
    extra: { generation?: number; progressDelta?: number | null } = {},
  ) {
    return {
      sessionId: `kst:${device.id}:${book.bookFileId}:${extra.generation ?? 0}:${counter}`,
      device: String(device.id),
      startedAt: new Date(Date.parse(endedAt) - seconds * 1000).toISOString(),
      endedAt,
      seconds,
      progressDelta: extra.progressDelta === undefined ? 0 : extra.progressDelta,
      intervalStartedAt,
    };
  }

  function stored(device: KoboDevice, session: MeasuredSession) {
    return {
      sessionId: session.id,
      device: String(device.id),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      seconds: session.seconds,
      progressDelta: null,
      intervalStartedAt: null,
    };
  }

  /** Reading seconds per day over the given days of the scenario calendar; days without a row are absent. */
  async function dailySeconds(...days: number[]): Promise<Record<string, number>> {
    const rows = await ctx.db
      .select({ day: schema.userReadingDailyStats.day, readingSeconds: schema.userReadingDailyStats.readingSeconds })
      .from(schema.userReadingDailyStats)
      .where(
        and(
          eq(schema.userReadingDailyStats.userId, userId),
          eq(schema.userReadingDailyStats.libraryId, library.libraryId),
          inArray(schema.userReadingDailyStats.day, days.map(day)),
        ),
      );
    return Object.fromEntries(rows.map((row) => [row.day, row.readingSeconds]));
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `kobo-reading-time-${RUN}` });

    const paths = await Promise.all(
      Array.from({ length: BOOK_COUNT }, (_, index) =>
        createEpubFixture(library.folderPath, `kobo-reading-time-${index + 1}.epub`, {
          title: `Kobo Reading Time ${index + 1}`,
          uid: `urn:uuid:${randomUUID()}`,
        }),
      ),
    );
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const located = await Promise.all(paths.map((path) => locateBookByAbsolutePath(ctx, path)));

    const [user] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'reader-state-e2e-admin'));
    userId = user!.id;

    const collectionResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/collections',
      headers: authHeader(ctx.adminToken),
      payload: { name: `Kobo Reading Time ${RUN}`, icon: 'book', syncToKobo: true },
    });
    expect([200, 201]).toContain(collectionResponse.statusCode);
    const collectionId = (collectionResponse.json() as { id: number }).id;

    const addBooksResponse = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${collectionId}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { bookIds: located.map((book) => book.bookId) },
    });
    expect([200, 201]).toContain(addBooksResponse.statusCode);

    deviceA = await createDevice(`Kobo A ${RUN}`);
    deviceB = await createDevice(`Kobo B ${RUN}`);
    await drainLibrary(deviceA);
    await drainLibrary(deviceB);

    const entitlements = await ctx.db
      .select({ bookId: schema.koboBookEntitlements.bookId, entitlementId: schema.koboBookEntitlements.entitlementId })
      .from(schema.koboBookEntitlements)
      .where(eq(schema.koboBookEntitlements.userId, userId));
    books = located.map((book) => ({
      bookId: book.bookId,
      bookFileId: book.bookFileId,
      entitlementId: entitlements.find((entitlement) => entitlement.bookId === book.bookId)!.entitlementId,
    }));
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  describe('reading done offline, well before the sync that reports it', () => {
    const evening = [
      measured('offline-1', 2, '20:16:11', '20:26:36'),
      measured('offline-2', 2, '20:31:36', '20:54:35'),
      measured('offline-3', 2, '20:54:55', '21:09:57'),
    ];

    it('retires the estimate when the counter push arrives before the measured sessions', async () => {
      const book = books[0]!;
      await pushCounter(deviceA, book, 9, at(1, '20:52:44'));
      await pushCounter(deviceA, book, 57, at(3, '07:41:58'));

      expect(await storedSessions(book)).toEqual([estimate(deviceA, book, 57, at(3, '07:41:58'), 2880, at(1, '20:52:44'))]);
      expect(await dailySeconds(1, 2, 3)).toEqual({ [day(3)]: 2880 });

      await sendMeasured(deviceA, book, evening);

      expect(await storedSessions(book)).toEqual(evening.map((session) => stored(deviceA, session)));
      expect(await dailySeconds(1, 2, 3)).toEqual({ [day(2)]: 2906 });
    });

    it('derives no estimate when the measured sessions arrive before the counter push', async () => {
      const book = books[1]!;
      const sessions = evening.map((session) => measured(`${session.id}-first`, 6, session.startedAt.slice(11, 19), session.endedAt.slice(11, 19)));
      await pushCounter(deviceA, book, 9, at(5, '20:52:44'));
      await sendMeasured(deviceA, book, sessions);
      await pushCounter(deviceA, book, 57, at(7, '07:41:58'));

      expect(await storedSessions(book)).toEqual(sessions.map((session) => stored(deviceA, session)));
      expect(await dailySeconds(5, 6, 7)).toEqual({ [day(6)]: 2906 });
    });
  });

  it('matches each delayed measured session to its own counter interval when several estimates exist', async () => {
    const book = books[2]!;
    await pushCounter(deviceA, book, 0, at(9, '07:00:00'));
    await pushCounter(deviceA, book, 30, at(10, '07:00:00'));
    await pushCounter(deviceA, book, 60, at(11, '07:00:00'));
    await pushCounter(deviceA, book, 80, at(12, '07:00:00'));

    const unmeasured = estimate(deviceA, book, 80, at(12, '07:00:00'), 1200, at(11, '07:00:00'));
    expect(await storedSessions(book)).toEqual([
      estimate(deviceA, book, 30, at(10, '07:00:00'), 1800, at(9, '07:00:00')),
      estimate(deviceA, book, 60, at(11, '07:00:00'), 1800, at(10, '07:00:00')),
      unmeasured,
    ]);

    const delayed = [
      measured('delayed-1', 9, '20:00:00', '20:20:00'),
      measured('delayed-2', 9, '20:30:00', '20:40:00'),
      measured('delayed-3', 10, '20:00:00', '20:15:00'),
      measured('delayed-4', 10, '20:20:00', '20:35:00'),
    ];
    await sendMeasured(deviceA, book, delayed);

    expect(await storedSessions(book)).toEqual([...delayed.map((session) => stored(deviceA, session)), unmeasured]);
    expect(await dailySeconds(9, 10, 11, 12)).toEqual({ [day(9)]: 1800, [day(10)]: 1800, [day(12)]: 1200 });
  });

  describe('a counter delta the measured sessions cover only in part', () => {
    it('keeps the unmeasured remainder and takes nothing more off it on a replay', async () => {
      const book = books[3]!;
      const partial = [measured('partial', 15, '20:00:00', '20:15:00')];
      await pushCounter(deviceA, book, 0, at(14, '07:00:00'), 10);
      await pushCounter(deviceA, book, 40, at(16, '07:00:00'), 30);

      expect(await storedSessions(book)).toEqual([estimate(deviceA, book, 40, at(16, '07:00:00'), 2400, at(14, '07:00:00'), { progressDelta: 20 })]);

      await sendMeasured(deviceA, book, partial);

      const remainder = estimate(deviceA, book, 40, at(16, '07:00:00'), 1500, at(14, '07:00:00'), { progressDelta: 12.5 });
      expect(await storedSessions(book)).toEqual([stored(deviceA, partial[0]!), remainder]);
      expect(await dailySeconds(14, 15, 16)).toEqual({ [day(15)]: 900, [day(16)]: 1500 });

      await sendMeasured(deviceA, book, partial);

      expect(await storedSessions(book)).toEqual([stored(deviceA, partial[0]!), remainder]);
      expect(await dailySeconds(14, 15, 16)).toEqual({ [day(15)]: 900, [day(16)]: 1500 });
    });

    it('reaches the same remainder when the measured session arrives first', async () => {
      const book = books[4]!;
      const partial = [measured('partial-first', 19, '20:00:00', '20:15:00')];
      await pushCounter(deviceA, book, 0, at(18, '07:00:00'), 10);
      await sendMeasured(deviceA, book, partial);
      await pushCounter(deviceA, book, 40, at(20, '07:00:00'), 30);

      expect(await storedSessions(book)).toEqual([
        stored(deviceA, partial[0]!),
        estimate(deviceA, book, 40, at(20, '07:00:00'), 1500, at(18, '07:00:00'), { progressDelta: 12.5 }),
      ]);
      expect(await dailySeconds(18, 19, 20)).toEqual({ [day(19)]: 900, [day(20)]: 1500 });
    });
  });

  it('keeps measured sessions from before a counter reset away from the estimates after it', async () => {
    const book = books[5]!;
    const beforeReset = measured('before-reset', 22, '20:00:00', '20:10:00');
    const beforeResetLate = measured('before-reset-late', 22, '21:00:00', '21:05:00');
    await pushCounter(deviceA, book, 100, at(22, '07:00:00'));
    await sendMeasured(deviceA, book, [beforeReset]);
    await pushCounter(deviceA, book, 5, at(23, '07:00:00'));

    expect(await storedSessions(book)).toEqual([stored(deviceA, beforeReset)]);

    await pushCounter(deviceA, book, 25, at(24, '07:00:00'));
    await sendMeasured(deviceA, book, [beforeResetLate]);

    expect(await storedSessions(book)).toEqual([
      stored(deviceA, beforeReset),
      stored(deviceA, beforeResetLate),
      estimate(deviceA, book, 25, at(24, '07:00:00'), 1200, at(23, '07:00:00'), { generation: 1 }),
    ]);
    expect(await dailySeconds(22, 23, 24)).toEqual({ [day(22)]: 900, [day(24)]: 1200 });
  });

  it('leaves the estimate of another device alone', async () => {
    const book = books[6]!;
    const onDeviceA = measured('device-a', 27, '20:00:00', '20:20:00');
    await pushCounter(deviceA, book, 0, at(27, '07:00:00'));
    await pushCounter(deviceB, book, 0, at(27, '07:01:00'));
    await pushCounter(deviceA, book, 20, at(28, '07:00:00'));
    await pushCounter(deviceB, book, 20, at(28, '07:05:00'));

    const otherDevice = estimate(deviceB, book, 20, at(28, '07:05:00'), 1200, at(27, '07:01:00'));
    expect(await storedSessions(book)).toEqual([estimate(deviceA, book, 20, at(28, '07:00:00'), 1200, at(27, '07:00:00')), otherDevice]);

    await sendMeasured(deviceA, book, [onDeviceA]);

    expect(await storedSessions(book)).toEqual([stored(deviceA, onDeviceA), otherDevice]);
    expect(await dailySeconds(27, 28)).toEqual({ [day(27)]: 1200, [day(28)]: 1200 });
  });

  it('recomputes the daily totals of an estimate that spans midnight as it shrinks and disappears', async () => {
    const book = books[7]!;
    const first = measured('midnight-1', 33, '12:00:00', '12:30:00');
    const second = measured('midnight-2', 33, '13:00:00', '13:30:00');
    await pushCounter(deviceA, book, 0, at(32, '07:00:00'));
    await pushCounter(deviceA, book, 60, at(34, '00:20:00'));

    expect(await dailySeconds(32, 33, 34)).toEqual({ [day(33)]: 2400, [day(34)]: 1200 });

    await sendMeasured(deviceA, book, [first]);

    expect(await storedSessions(book)).toEqual([stored(deviceA, first), estimate(deviceA, book, 60, at(34, '00:20:00'), 1800, at(32, '07:00:00'))]);
    expect(await dailySeconds(32, 33, 34)).toEqual({ [day(33)]: 2400, [day(34)]: 1200 });

    await sendMeasured(deviceA, book, [second]);

    expect(await storedSessions(book)).toEqual([stored(deviceA, first), stored(deviceA, second)]);
    expect(await dailySeconds(32, 33, 34)).toEqual({ [day(33)]: 3600 });
  });

  describe('a counter push made while the book is open', () => {
    it('retires the estimate when the device syncs on waking, seconds after the book reopens', async () => {
      const book = books[8]!;
      const session = measured('wake-sync', 37, '20:00:00', '20:30:00');
      await pushCounter(deviceA, book, 100, at(36, '07:00:00'));
      await pushCounter(deviceA, book, 100, at(37, '20:00:05'));
      await pushCounter(deviceA, book, 130, at(37, '20:30:10'));

      expect(await storedSessions(book)).toEqual([estimate(deviceA, book, 130, at(37, '20:30:10'), 1800, at(37, '20:00:05'))]);

      await sendMeasured(deviceA, book, [session]);

      expect(await storedSessions(book)).toEqual([stored(deviceA, session)]);
      expect(await dailySeconds(36, 37, 38)).toEqual({ [day(37)]: 1800 });
    });

    it('derives no estimate after a wake-up sync when the measured session arrives first', async () => {
      const book = books[9]!;
      const session = measured('wake-sync-first', 40, '20:00:00', '20:30:00');
      await pushCounter(deviceA, book, 100, at(39, '07:00:00'));
      await pushCounter(deviceA, book, 100, at(40, '20:00:05'));
      await sendMeasured(deviceA, book, [session]);
      await pushCounter(deviceA, book, 130, at(40, '20:30:10'));

      expect(await storedSessions(book)).toEqual([stored(deviceA, session)]);
      expect(await dailySeconds(39, 40, 41)).toEqual({ [day(40)]: 1800 });
    });

    it('shares the session between the estimates on both sides of a push made while reading', async () => {
      const book = books[10]!;
      const session = measured('mid-session', 43, '20:00:00', '20:30:00');
      await pushCounter(deviceA, book, 100, at(42, '07:00:00'));
      await pushCounter(deviceA, book, 110, at(43, '20:10:00'));
      await pushCounter(deviceA, book, 130, at(43, '20:30:05'));

      expect(await storedSessions(book)).toEqual([
        estimate(deviceA, book, 110, at(43, '20:10:00'), 600, at(42, '07:00:00')),
        estimate(deviceA, book, 130, at(43, '20:30:05'), 1200, at(43, '20:10:00')),
      ]);

      await sendMeasured(deviceA, book, [session]);

      expect(await storedSessions(book)).toEqual([stored(deviceA, session)]);
      expect(await dailySeconds(42, 43, 44)).toEqual({ [day(43)]: 1800 });
    });

    it('retires the estimate of reading that carried on after the sync that reported the evening', async () => {
      const book = books[11]!;
      const evening = measured('carried-on-evening', 46, '20:16:11', '21:09:57');
      const morning = measured('carried-on-morning', 47, '07:41:50', '08:10:00');
      await pushCounter(deviceA, book, 9, at(45, '20:52:44'));
      await pushCounter(deviceA, book, 63, at(47, '07:41:58'));
      await sendMeasured(deviceA, book, [evening]);
      await pushCounter(deviceA, book, 91, at(47, '12:00:00'));

      expect(await storedSessions(book)).toEqual([
        stored(deviceA, evening),
        estimate(deviceA, book, 91, at(47, '12:00:00'), 1680, at(47, '07:41:58')),
      ]);

      await sendMeasured(deviceA, book, [morning]);

      expect(await storedSessions(book)).toEqual([stored(deviceA, evening), stored(deviceA, morning)]);
      expect(await dailySeconds(45, 46, 47)).toEqual({ [day(46)]: 3226, [day(47)]: 1690 });
    });

    it('keeps the unmeasured reading of an earlier interval that the session only grazes', async () => {
      const book = books[12]!;
      const session = measured('grazing', 50, '19:59:50', '20:20:00');
      await pushCounter(deviceA, book, 100, at(49, '07:00:00'));
      await pushCounter(deviceA, book, 105, at(50, '19:59:55'));
      await pushCounter(deviceA, book, 125, at(51, '08:00:00'));

      await sendMeasured(deviceA, book, [session]);

      // Five of the session's 1210 seconds fall before the push, so the earlier estimate gives up only those.
      expect(await storedSessions(book)).toEqual([
        estimate(deviceA, book, 105, at(50, '19:59:55'), 295, at(49, '07:00:00')),
        stored(deviceA, session),
      ]);
      expect(await dailySeconds(49, 50, 51)).toEqual({ [day(50)]: 1505 });
    });
  });
});
