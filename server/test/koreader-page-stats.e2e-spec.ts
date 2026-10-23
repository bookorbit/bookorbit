import { copyFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { and, asc, eq, gte, like } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { Permission } from '@bookorbit/types';
import { buildSessionId, buildSessionIdPrefix, koreaderSessionDeviceKey } from '../src/common/utils/koreader-session-id.utils';
import { KOREADER_SESSION_GAP_SECONDS, deriveKoreaderSessions, type KoreaderPageEvent } from '../src/modules/koreader/koreader-stats.util';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  createReaderStateIsolationE2EContext,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const KOREADER_USERNAME = `page-stats-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'PageStatsDevicePass123';
const DEVICE_ID = 'e2e-stats-0001';
const BASE_EPOCH = 1_780_000_000;
const TOTAL_PAGES = 300;
/** Mirrors POWER_HOUR_PAGES in the reading evaluator. */
const POWER_HOUR_PAGES = 75;

/** A contiguous run of one-minute page reads starting at `startEpoch`. */
function cluster(startEpoch: number, pages: number, firstPage: number): KoreaderPageEvent[] {
  return Array.from({ length: pages }, (_, index) => ({
    page: firstPage + index,
    startTime: startEpoch + index * 60,
    durationSeconds: 55,
    totalPages: TOTAL_PAGES,
  }));
}

describe('KOReader page stats derivation (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let epub!: LocatedBookFile;
  let epubPath!: string;
  let fileHash!: string;
  let ownerId!: number;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function uploadPageStats(events: KoreaderPageEvent[], bookFileId?: number, deviceId = DEVICE_ID) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/page-stats',
      headers: deviceHeaders(),
      payload: {
        deviceId,
        deviceModel: 'E2E',
        pluginVersion: '0.4.0',
        books: [{ hash: fileHash, bookFileId, events }],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { results: { hash: string; accepted: number; duplicates: number }[]; unmatched: string[] };
  }

  async function storedSessions() {
    return ctx.db
      .select({
        id: schema.readingSessions.id,
        sessionId: schema.readingSessions.sessionId,
        startedAt: schema.readingSessions.startedAt,
        endedAt: schema.readingSessions.endedAt,
        durationSeconds: schema.readingSessions.durationSeconds,
        progressDelta: schema.readingSessions.progressDelta,
        endProgress: schema.readingSessions.endProgress,
      })
      .from(schema.readingSessions)
      .where(
        and(
          eq(schema.readingSessions.bookFileId, epub.bookFileId),
          like(schema.readingSessions.sessionId, `${buildSessionIdPrefix(DEVICE_ID, epub.bookFileId)}%`),
        ),
      )
      .orderBy(asc(schema.readingSessions.startedAt));
  }

  function expectedSessions(events: KoreaderPageEvent[]) {
    return deriveKoreaderSessions(events, DEVICE_ID, epub.bookFileId)
      .slice()
      .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
      .map((session) => ({
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds,
        progressDelta: session.progressDelta,
        endProgress: session.endProgress,
      }));
  }

  async function hasAchievement(userId: number, key: string): Promise<boolean> {
    const rows = await ctx.db
      .select({ key: schema.userAchievements.achievementKey })
      .from(schema.userAchievements)
      .where(and(eq(schema.userAchievements.userId, userId), eq(schema.userAchievements.achievementKey, key)));
    return rows.length > 0;
  }

  /** Achievement evaluation is fire-and-forget off the upload response, so the award lands after it. */
  async function waitForAchievement(userId: number, key: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await hasAchievement(userId, key)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function pagesFor(progressDelta: number | null): number {
    return ((progressDelta ?? 0) / 100) * TOTAL_PAGES;
  }

  function comparable(rows: Awaited<ReturnType<typeof storedSessions>>) {
    return rows.map((row) => ({
      sessionId: row.sessionId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSeconds: row.durationSeconds,
      progressDelta: row.progressDelta,
      endProgress: row.endProgress,
    }));
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `koreader-page-stats-${randomUUID()}` });
    epubPath = await createEpubFixture(library.folderPath, 'page-stats-book.epub', {
      title: `Page Stats Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    epub = await locateBookByAbsolutePath(ctx, epubPath);

    const [fileRow] = await ctx.db
      .select({ fileHash: schema.bookFiles.fileHash })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, epub.bookFileId));
    expect(fileRow?.fileHash).toBeTruthy();
    fileHash = fileRow!.fileHash!;

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);
    const [credential] = await ctx.db
      .select({ userId: schema.koreaderUsers.userId })
      .from(schema.koreaderUsers)
      .where(eq(schema.koreaderUsers.username, KOREADER_USERNAME));
    ownerId = credential!.userId;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('derives the same sessions as a full-history derivation across many batches', async () => {
    // Ten clusters an hour apart, uploaded in 400-event batches.
    const history = Array.from({ length: 10 }, (_, index) => cluster(BASE_EPOCH + index * 4 * KOREADER_SESSION_GAP_SECONDS, 20, index * 20)).flat();

    for (let offset = 0; offset < history.length; offset += 400) {
      const batch = history.slice(offset, offset + 400);
      const result = await uploadPageStats(batch);
      expect(result.results[0]!.accepted).toBe(batch.length);
    }

    expect(comparable(await storedSessions())).toEqual(expectedSessions(history));
  });

  it('keeps devices with the same eight-character prefix independent across retry and deletion', async () => {
    const base = BASE_EPOCH + 1_000_000;
    const deviceA = 'shared-prefix-device-A';
    const deviceB = 'shared-prefix-device-B';
    const eventsA = [{ page: 1, startTime: base, durationSeconds: 40, totalPages: TOTAL_PAGES }];
    const eventsB = [{ page: 2, startTime: base, durationSeconds: 70, totalPages: TOTAL_PAGES }];
    await uploadPageStats(eventsA, undefined, deviceA);
    await uploadPageStats(eventsB, undefined, deviceB);
    const rows = await ctx.db
      .select()
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.bookFileId, epub.bookFileId), eq(schema.readingSessions.startedAt, new Date(base * 1000))));
    expect(rows.map((row) => row.durationSeconds).sort((a, b) => a - b)).toEqual([40, 70]);
    await deleteSessionFromLog(rows.find((row) => row.sessionId === buildSessionId(deviceA, epub.bookFileId, base))!.id);
    await uploadPageStats([{ ...eventsB[0]!, page: 3, startTime: base + 80 }], undefined, deviceB);
    expect((await uploadPageStats(eventsA, undefined, deviceA)).results[0]!.duplicates).toBe(1);
    const surviving = await ctx.db
      .select()
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.bookFileId, epub.bookFileId), eq(schema.readingSessions.startedAt, new Date(base * 1000))));
    expect(surviving.map((row) => row.sessionId)).toEqual([buildSessionId(deviceB, epub.bookFileId, base)]);
  });

  it('upgrades a conflated legacy session from complete raw device clusters without double counting', async () => {
    const base = BASE_EPOCH + 2_000_000;
    const devices = ['legacy-prefix-A', 'legacy-prefix-B'];
    await ctx.db.insert(schema.koreaderPageStats).values(
      devices.map((deviceId, index) => ({
        userId: ownerId,
        bookFileId: epub.bookFileId,
        deviceId,
        page: 1,
        startTime: base,
        durationSeconds: 40 + index * 30,
        totalPages: TOTAL_PAGES,
      })),
    );
    await ctx.db.insert(schema.readingSessions).values({
      userId: ownerId,
      bookFileId: epub.bookFileId,
      bookId: epub.bookId,
      source: 'koreader',
      sessionId: `kor:legacy-p:${epub.bookFileId}:${base}`,
      startedAt: new Date(base * 1000),
      endedAt: new Date((base + 70) * 1000),
      durationSeconds: 70,
    });
    await uploadPageStats([{ page: 2, startTime: base + 80, durationSeconds: 40, totalPages: TOTAL_PAGES }], undefined, devices[0]);
    const rows = await ctx.db
      .select()
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.bookFileId, epub.bookFileId), eq(schema.readingSessions.startedAt, new Date(base * 1000))));
    expect(rows.map((row) => row.sessionId).sort()).toEqual(devices.map((device) => buildSessionId(device, epub.bookFileId, base)).sort());
    expect(rows.map((row) => row.durationSeconds).sort((a, b) => a - b)).toEqual([70, 80]);
  });

  it('scopes canonical status and page-time uploads to the authenticated reader', async () => {
    const reader = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    const username = `stats-isolation-${randomUUID().slice(0, 8)}`;
    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(reader.accessToken),
      payload: { username, password: KOREADER_PASSWORD },
    });
    expect(credentials.statusCode).toBe(201);
    const headers = { 'x-auth-user': username, 'x-auth-key': KOREADER_PASSWORD };
    const device = { deviceId: 'isolation-device', deviceModel: 'E2E', pluginVersion: '1.7.0' };
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/book-states',
      headers,
      payload: { ...device, books: [{ hash: fileHash, status: 'complete', rating: 1 }] },
    });
    expect(denied.statusCode).toBe(201);
    expect(denied.json()).toEqual({ results: [], unmatched: [fileHash] });
    const deniedStats = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/page-stats',
      headers,
      payload: { ...device, books: [{ hash: fileHash, bookFileId: epub.bookFileId, events: cluster(BASE_EPOCH + 3_000_000, 1, 1) }] },
    });
    expect(deniedStats.statusCode).toBe(201);
    expect(deniedStats.json()).toEqual({ results: [], unmatched: [fileHash] });
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);
    const empty = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/book-states',
      headers,
      payload: { ...device, books: [{ hash: fileHash }] },
    });
    expect(empty.json().results[0]).toMatchObject({ statusSet: false, ratingSet: false, reviewNoteSet: false });
    const adminBefore = await ctx.db
      .select()
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.userId, ownerId), eq(schema.userBookStatus.bookId, epub.bookId)));
    const own = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/book-states',
      headers,
      payload: { ...device, books: [{ hash: fileHash, status: 'complete', rating: 1 }] },
    });
    expect(own.json().results[0]).toMatchObject({ status: 'complete', statusSet: true, rating: 1 });
    expect(
      await ctx.db
        .select()
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, ownerId), eq(schema.userBookStatus.bookId, epub.bookId))),
    ).toEqual(adminBefore);
  });

  it('merges two stored sessions when a later batch fills the gap between them', async () => {
    const early = cluster(BASE_EPOCH + 5_000_000, 10, 0);
    const late = cluster(BASE_EPOCH + 5_000_000 + 3 * KOREADER_SESSION_GAP_SECONDS, 10, 40);
    await uploadPageStats([...early, ...late]);

    const before = await storedSessions();
    const separated = before.filter((row) => row.startedAt.getTime() >= (BASE_EPOCH + 5_000_000) * 1000);
    expect(separated).toHaveLength(2);

    // Chains to the earlier cluster's end and reaches within the gap of the later one,
    // so the pair becomes a single session under a new id taken from the earlier start.
    const bridge = cluster(early.at(-1)!.startTime + 1_760, 22, 10);
    expect(bridge[0]!.startTime - (early.at(-1)!.startTime + early.at(-1)!.durationSeconds)).toBeLessThanOrEqual(KOREADER_SESSION_GAP_SECONDS);
    expect(late[0]!.startTime - (bridge.at(-1)!.startTime + bridge.at(-1)!.durationSeconds)).toBeLessThanOrEqual(KOREADER_SESSION_GAP_SECONDS);
    await uploadPageStats(bridge);

    const after = await storedSessions();
    const merged = after.filter((row) => row.startedAt.getTime() >= (BASE_EPOCH + 5_000_000) * 1000);
    expect(merged).toHaveLength(1);
    expect(comparable(merged)).toEqual(expectedSessions([...early, ...bridge, ...late]));
    // The superseded rows are gone, not merely orphaned.
    expect(after.some((row) => row.sessionId === separated[1]!.sessionId)).toBe(false);
  });

  it('leaves sessions outside the affected window untouched', async () => {
    const untouched = (await storedSessions())[0]!;
    const distant = cluster(BASE_EPOCH + 9_000_000, 5, 100);

    await uploadPageStats(distant);

    const after = await storedSessions();
    expect(after.find((row) => row.sessionId === untouched.sessionId)).toEqual(untouched);
  });

  it('makes a replayed batch a no-op after an interrupted upload', async () => {
    const resumed = cluster(BASE_EPOCH + 11_000_000, 12, 150);
    await uploadPageStats(resumed.slice(0, 6));
    const partial = await storedSessions();

    const replay = await uploadPageStats(resumed);
    expect(replay.results[0]!.duplicates).toBe(6);

    const complete = await storedSessions();
    expect(complete).toHaveLength(partial.length);
    const finished = complete.find((row) => row.startedAt.getTime() === resumed[0]!.startTime * 1000)!;
    expect(finished.endedAt.getTime()).toBe((resumed.at(-1)!.startTime + resumed.at(-1)!.durationSeconds) * 1000);

    const noop = await uploadPageStats(resumed);
    expect(noop.results[0]!.accepted).toBe(0);
    expect(await storedSessions()).toEqual(complete);
  });

  it('unlocks a session achievement when a later batch grows a stored session past its threshold', async () => {
    const metadata = await ctx.db
      .update(schema.bookMetadata)
      .set({ pageCount: TOTAL_PAGES })
      .where(eq(schema.bookMetadata.bookId, epub.bookId))
      .returning({ bookId: schema.bookMetadata.bookId });
    expect(metadata).toHaveLength(1);

    const opening = cluster(BASE_EPOCH + 13_000_000, 40, 1);
    await uploadPageStats(opening);

    const sessionId = buildSessionId(DEVICE_ID, epub.bookFileId, opening[0]!.startTime);
    const [session] = await ctx.db
      .select({ userId: schema.readingSessions.userId, progressDelta: schema.readingSessions.progressDelta })
      .from(schema.readingSessions)
      .where(eq(schema.readingSessions.sessionId, sessionId));
    expect(session).toBeTruthy();
    expect(pagesFor(session!.progressDelta)).toBeLessThan(POWER_HOUR_PAGES);
    expect(await hasAchievement(session!.userId, 'power_hour')).toBe(false);

    // Resumes within the session gap, so the stored session grows under its existing id instead of
    // being inserted again: the update path that previously emitted no achievement event.
    const continued = cluster(opening.at(-1)!.startTime + 60, 45, opening.at(-1)!.page + 1);
    await uploadPageStats(continued);

    const grown = (await storedSessions()).filter((row) => row.startedAt.getTime() >= (BASE_EPOCH + 13_000_000) * 1000);
    expect(grown).toHaveLength(1);
    expect(grown[0]!.sessionId).toBe(sessionId);
    expect(pagesFor(grown[0]!.progressDelta)).toBeGreaterThanOrEqual(POWER_HOUR_PAGES);

    expect(await waitForAchievement(session!.userId, 'power_hour')).toBe(true);
  });

  async function deleteSessionFromLog(sessionRowId: number) {
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/sessions/${sessionRowId}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(response.statusCode).toBe(204);
  }

  async function sessionsBetween(fromEpoch: number, toEpoch: number) {
    return (await storedSessions()).filter((row) => row.startedAt.getTime() >= fromEpoch * 1000 && row.startedAt.getTime() < toEpoch * 1000);
  }

  async function tombstonesFor(fromEpoch: number) {
    return ctx.db
      .select({
        deviceKey: schema.koreaderSessionTombstones.deviceKey,
        startTime: schema.koreaderSessionTombstones.startTime,
        endTime: schema.koreaderSessionTombstones.endTime,
      })
      .from(schema.koreaderSessionTombstones)
      .where(and(eq(schema.koreaderSessionTombstones.bookFileId, epub.bookFileId), gte(schema.koreaderSessionTombstones.startTime, fromEpoch)));
  }

  it('keeps a deleted session deleted when the device reads on within the session gap', async () => {
    const base = BASE_EPOCH + 15_000_000;
    const sitting = cluster(base, 20, 1);
    await uploadPageStats(sitting);
    const [derived] = await sessionsBetween(base, base + 86_400);
    expect(derived?.sessionId).toBe(buildSessionId(DEVICE_ID, epub.bookFileId, base));

    await deleteSessionFromLog(derived!.id);
    expect(await sessionsBetween(base, base + 86_400)).toEqual([]);
    expect(await tombstonesFor(base)).toEqual([
      { deviceKey: koreaderSessionDeviceKey(DEVICE_ID), startTime: base, endTime: sitting.at(-1)!.startTime + sitting.at(-1)!.durationSeconds },
    ]);

    // Ten minutes after the deleted sitting ended: close enough that derivation used to merge the
    // stored events back in and re-insert the deleted session under its old id.
    const later = cluster(sitting.at(-1)!.startTime + sitting.at(-1)!.durationSeconds + 600, 5, 21);
    await uploadPageStats(later);

    const after = await sessionsBetween(base, base + 86_400);
    expect(comparable(after)).toEqual(expectedSessions(later));
    expect(after.some((row) => row.sessionId === derived!.sessionId)).toBe(false);
  });

  it('counts the page that starts on the second a deleted session ended', async () => {
    const base = BASE_EPOCH + 15_500_000;
    const sitting = cluster(base, 10, 1);
    await uploadPageStats(sitting);
    const [derived] = await sessionsBetween(base, base + 86_400);
    await deleteSessionFromLog(derived!.id);

    const sessionEnd = sitting.at(-1)!.startTime + sitting.at(-1)!.durationSeconds;
    const next = cluster(sessionEnd, 5, 11);
    await uploadPageStats(next);

    expect(comparable(await sessionsBetween(base, base + 86_400))).toEqual(expectedSessions(next));
  });

  it('does not bring a deleted session back when its events are uploaded again', async () => {
    const base = BASE_EPOCH + 16_000_000;
    const sitting = cluster(base, 15, 30);
    await uploadPageStats(sitting);
    const [derived] = await sessionsBetween(base, base + 86_400);
    await deleteSessionFromLog(derived!.id);

    // KOReader's own statistics sync can deliver more pages for the same span from another copy of
    // the history, and a plugin that lost its state resends everything it has.
    const sameSpan = sitting.map((event) => ({ ...event, page: event.page + 500 }));
    const extra = await uploadPageStats(sameSpan);
    expect(extra.results[0]!.accepted).toBe(sameSpan.length);
    expect(await sessionsBetween(base, base + 86_400)).toEqual([]);

    await ctx.db
      .delete(schema.koreaderPageStats)
      .where(and(eq(schema.koreaderPageStats.bookFileId, epub.bookFileId), gte(schema.koreaderPageStats.startTime, base)));
    const resent = await uploadPageStats(sitting);
    expect(resent.results[0]!.accepted).toBe(sitting.length);
    expect(await sessionsBetween(base, base + 86_400)).toEqual([]);
  });

  it('builds a bridged session from the surviving events only', async () => {
    const base = BASE_EPOCH + 17_000_000;
    const early = cluster(base, 10, 0);
    const late = cluster(base + 3 * KOREADER_SESSION_GAP_SECONDS, 10, 40);
    await uploadPageStats([...early, ...late]);
    const [earlyRow, lateRow] = await sessionsBetween(base, base + 86_400);
    expect(earlyRow?.sessionId).toBe(buildSessionId(DEVICE_ID, epub.bookFileId, base));

    await deleteSessionFromLog(earlyRow!.id);

    // Would have merged early, bridge and late into one session starting at the early sitting.
    const bridge = cluster(early.at(-1)!.startTime + 1_760, 22, 10);
    await uploadPageStats(bridge);

    const after = await sessionsBetween(base, base + 86_400);
    expect(comparable(after)).toEqual(expectedSessions([...bridge, ...late]));
    expect(after.some((row) => row.sessionId === earlyRow!.sessionId)).toBe(false);
    expect(after.some((row) => row.sessionId === lateRow!.sessionId)).toBe(false);
  });

  it('leaves the neighbouring sessions of a deleted one untouched', async () => {
    const base = BASE_EPOCH + 18_000_000;
    const first = cluster(base, 8, 0);
    const second = cluster(base + 3 * KOREADER_SESSION_GAP_SECONDS, 8, 10);
    const third = cluster(base + 6 * KOREADER_SESSION_GAP_SECONDS, 8, 20);
    await uploadPageStats([...first, ...second, ...third]);
    const rows = await sessionsBetween(base, base + 86_400);
    expect(rows).toHaveLength(3);

    await deleteSessionFromLog(rows[1]!.id);
    await uploadPageStats(cluster(third.at(-1)!.startTime + 120, 4, 30));

    const after = await sessionsBetween(base, base + 86_400);
    expect(after.map((row) => row.sessionId)).toEqual([rows[0]!.sessionId, rows[2]!.sessionId]);
    expect(after[0]).toEqual(rows[0]);
  });

  // A file hash is not unique: identical bytes in two places are two book file rows. The server
  // must refuse to guess, then honor an accessible file identity previously verified by the
  // plugin so every later upload has one stable target.
  it('requires and persists an explicit identity for a hash shared by two book files', async () => {
    const duplicatePath = join(library.folderPath, 'page-stats-book-copy.epub');
    await copyFile(epubPath, duplicatePath);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const sharing = await ctx.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.fileHash, fileHash))
      .orderBy(asc(schema.bookFiles.id));
    expect(sharing.length).toBeGreaterThan(1);
    expect(sharing[0]!.id).toBe(epub.bookFileId);

    const firstStart = BASE_EPOCH + 20_000_000;
    const ambiguous = await uploadPageStats([{ page: 1, startTime: firstStart, durationSeconds: 55, totalPages: TOTAL_PAGES }]);
    expect(ambiguous.results).toEqual([]);
    expect(ambiguous.unmatched).toEqual([fileHash]);

    const beforeLink = await ctx.db
      .select({ id: schema.koreaderPageStats.id })
      .from(schema.koreaderPageStats)
      .where(and(eq(schema.koreaderPageStats.deviceId, DEVICE_ID), gte(schema.koreaderPageStats.startTime, firstStart)));
    expect(beforeLink).toEqual([]);

    const matchResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/match-check',
      headers: deviceHeaders(),
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'E2E',
        pluginVersion: '1.5.3',
        hashes: [fileHash],
        books: [{ hash: fileHash, source: 'current_file', bookFileId: epub.bookFileId }],
      },
    });
    expect(matchResponse.statusCode).toBe(201);
    expect(matchResponse.json().matches).toEqual([{ hash: fileHash, bookId: epub.bookId, bookFileId: epub.bookFileId }]);

    await uploadPageStats([{ page: 1, startTime: firstStart, durationSeconds: 55, totalPages: TOTAL_PAGES }]);
    await uploadPageStats([{ page: 2, startTime: firstStart + 60, durationSeconds: 55, totalPages: TOTAL_PAGES }]);

    const explicitStart = firstStart + 120;
    const explicit = await uploadPageStats([{ page: 3, startTime: explicitStart, durationSeconds: 55, totalPages: TOTAL_PAGES }], sharing[1]!.id);
    expect(explicit.results).toEqual([{ hash: fileHash, accepted: 1, duplicates: 0, watermark: explicitStart }]);

    const [explicitRow] = await ctx.db
      .select({ bookFileId: schema.koreaderPageStats.bookFileId })
      .from(schema.koreaderPageStats)
      .where(and(eq(schema.koreaderPageStats.deviceId, DEVICE_ID), eq(schema.koreaderPageStats.startTime, explicitStart)));
    expect(explicitRow?.bookFileId).toBe(sharing[1]!.id);

    const targets = await ctx.db
      .selectDistinct({ bookFileId: schema.koreaderPageStats.bookFileId })
      .from(schema.koreaderPageStats)
      .where(and(eq(schema.koreaderPageStats.deviceId, DEVICE_ID), gte(schema.koreaderPageStats.startTime, firstStart)));
    expect(targets.map((row) => row.bookFileId).sort((left, right) => left - right)).toEqual(
      [epub.bookFileId, sharing[1]!.id].sort((left, right) => left - right),
    );
  });
  it('keeps accepting fresh reading events after deleting a KOReader session from the reading log', async () => {
    const opening = cluster(BASE_EPOCH + 30_000_000, 4, 200);
    await uploadPageStats(opening, epub.bookFileId);
    const first = (await storedSessions()).find((row) => row.sessionId === buildSessionId(DEVICE_ID, epub.bookFileId, opening[0]!.startTime))!;

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${epub.bookId}/sessions/${first.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(deleted.statusCode).toBe(204);
    expect((await storedSessions()).some((row) => row.sessionId === first.sessionId)).toBe(false);
    const resets = await ctx.db.select().from(schema.koreaderProgressResets).where(eq(schema.koreaderProgressResets.bookFileId, epub.bookFileId));
    expect(resets).toHaveLength(0);

    const replay = await uploadPageStats(opening, epub.bookFileId);
    expect(replay.results[0]!.accepted).toBe(0);
    expect(replay.results[0]!.duplicates).toBe(opening.length);
    expect((await storedSessions()).some((row) => row.sessionId === first.sessionId)).toBe(false);

    const continued = cluster(opening.at(-1)!.startTime + 60, 4, 204);
    expect((await uploadPageStats(continued, epub.bookFileId)).results[0]!.accepted).toBe(continued.length);
    const afterContinuation = await storedSessions();
    expect(afterContinuation.some((row) => row.sessionId === first.sessionId)).toBe(false);
    const newSession = afterContinuation.filter((row) => row.startedAt.getTime() === continued[0]!.startTime * 1000);
    expect(comparable(newSession)).toEqual(expectedSessions(continued));

    const later = cluster(BASE_EPOCH + 30_010_000, 4, 210);
    expect((await uploadPageStats(later, epub.bookFileId)).results[0]!.accepted).toBe(later.length);
    const log = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${epub.bookId}/sessions?sortBy=startedAt&sortDir=desc`,
      headers: authHeader(ctx.adminToken),
    });
    expect(log.statusCode).toBe(200);
    expect(log.json().items[0].startedAt).toBe(new Date(later[0]!.startTime * 1000).toISOString());
  });

  it('exposes a reset hold while accepting fresh sessions, then restores the selected device position on release', async () => {
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${epub.bookId}/reset-reading-state`,
      headers: authHeader(ctx.adminToken),
    });
    expect(reset.statusCode).toBe(201);
    expect(await storedSessions()).toHaveLength(0);

    const pushed = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: {
        document: fileHash,
        percentage: 0.42,
        progress: '/body/DocFragment[8]/body/p[12]/text().0',
        device: 'Kindle Paperwhite',
        device_id: DEVICE_ID,
      },
    });
    expect(pushed.statusCode).toBe(200);
    const progress = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/books/${epub.bookId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().heldByReset).toEqual([expect.objectContaining({ deviceId: DEVICE_ID, percentage: 42 })]);
    expect(progress.json().canonicalPercentage).toBe(0);

    const fresh = cluster(Math.floor(Date.now() / 1000) + 60, 4, 130);
    expect((await uploadPageStats(fresh, epub.bookFileId)).results[0]!.accepted).toBe(fresh.length);
    const log = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${epub.bookId}/sessions`,
      headers: authHeader(ctx.adminToken),
    });
    expect(log.statusCode).toBe(200);
    expect(log.json().total).toBe(1);

    const released = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/koreader/books/${epub.bookId}/reset-hold/release`,
      headers: authHeader(ctx.adminToken),
      payload: { deviceId: DEVICE_ID },
    });
    expect(released.statusCode).toBe(201);
    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/books/${epub.bookId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().heldByReset).toEqual([]);
    expect(after.json().canonicalPercentage).toBe(42);
  });
});
