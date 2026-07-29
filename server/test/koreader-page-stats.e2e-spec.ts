import { randomUUID } from 'crypto';
import { and, asc, eq, like } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import {
  KOREADER_SESSION_GAP_SECONDS,
  buildSessionIdPrefix,
  deriveKoreaderSessions,
  type KoreaderPageEvent,
} from '../src/modules/koreader/koreader-stats.util';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
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
  let fileHash!: string;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function uploadPageStats(events: KoreaderPageEvent[]) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/page-stats',
      headers: deviceHeaders(),
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'E2E',
        pluginVersion: '0.4.0',
        books: [{ hash: fileHash, events }],
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
    const epubPath = await createEpubFixture(library.folderPath, 'page-stats-book.epub', {
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
});
