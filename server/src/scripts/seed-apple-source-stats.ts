import { Client } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';
import { addDateKeyDays, aggregateReadingSessionDailyStats } from '../common/utils/reading-daily-stats.utils';
import { resolveTimeZone, toDateKeyInTimeZone, toTimeZoneStartOfDay } from '../common/utils/timezone.utils';

const SESSION_PREFIX = 'visual-apple-v1';
const HISTORY_DAYS = 240;
const AUDIO_FORMATS = new Set(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']);
const FEATURED_BOOK_ID = 929;
const FEATURED_DAYS_AGO = new Set([1, 3, 7, 12, 18, 27, 42, 65, 94, 132, 181, 224]);

type SeedUser = {
  id: number;
  username: string;
  is_superuser: boolean;
  settings: { timezone?: unknown } | null;
};

type BookCandidate = {
  book_id: number;
  book_file_id: number;
  format: string | null;
};

type SeedSession = {
  userId: number;
  bookFileId: number;
  bookId: number;
  sessionId: string;
  source: 'ios' | 'watchos';
  sessionType: 'read' | 'listen';
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number;
  endProgress: number;
};

type SessionForDailyStats = {
  library_id: number;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
  progress_delta: number | null;
};

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInt(random: () => number, minimum: number, maximum: number): number {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(random, 0, index);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function localStartMinute(source: 'ios' | 'watchos', random: () => number): number {
  const roll = random();
  if (source === 'watchos') {
    if (roll < 0.56) return randomInt(random, 6 * 60 + 5, 8 * 60 + 20);
    if (roll < 0.82) return randomInt(random, 11 * 60 + 35, 13 * 60 + 20);
    return randomInt(random, 17 * 60 + 15, 20 * 60 + 10);
  }
  if (roll < 0.58) return randomInt(random, 19 * 60, 22 * 60 + 25);
  if (roll < 0.8) return randomInt(random, 11 * 60 + 45, 14 * 60);
  return randomInt(random, 6 * 60 + 20, 9 * 60);
}

function buildSessions(userId: number, timeZone: string, books: BookCandidate[]): SeedSession[] {
  const today = toDateKeyInTimeZone(new Date(), timeZone);
  const random = createRandom(userId * 10_000 + Number(today.replaceAll('-', '')));
  const audioBooks = books.filter((book) => book.format != null && AUDIO_FORMATS.has(book.format));
  const readableBooks = books.filter((book) => book.format == null || !AUDIO_FORMATS.has(book.format));
  const featuredBook = readableBooks.find((book) => book.book_id === FEATURED_BOOK_ID);

  if (audioBooks.length === 0) throw new Error('No accessible audiobook files found for Apple Watch sessions');
  if (readableBooks.length === 0) throw new Error('No accessible reading files found for iOS sessions');

  const readingShelf = shuffled(readableBooks, random).slice(0, 28);
  if (featuredBook && !readingShelf.some((book) => book.book_id === featuredBook.book_id)) {
    readingShelf[readingShelf.length - 1] = featuredBook;
  }

  const progressByBook = new Map<number, number>();
  const sessions: SeedSession[] = [];

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
    const forceFeatured = featuredBook != null && FEATURED_DAYS_AGO.has(daysAgo);
    if (!forceFeatured && random() > 0.82) continue;

    const day = addDateKeyDays(today, -daysAgo);
    const startOfDay = toTimeZoneStartOfDay(day, timeZone);
    const sessionCount = forceFeatured || random() > 0.48 ? 1 : 2;

    for (let daySessionIndex = 0; daySessionIndex < sessionCount; daySessionIndex += 1) {
      const isFeaturedSession = forceFeatured && daySessionIndex === 0;
      const source = isFeaturedSession || random() >= 0.38 ? 'ios' : 'watchos';
      const iosListening = source === 'ios' && !isFeaturedSession && random() < 0.2;
      const sessionType = source === 'watchos' || iosListening ? 'listen' : 'read';
      const book = isFeaturedSession ? featuredBook : sessionType === 'listen' ? pick(audioBooks, random) : pick(readingShelf, random);
      const durationMinutes =
        source === 'watchos' ? randomInt(random, 12, 47) : sessionType === 'listen' ? randomInt(random, 22, 83) : randomInt(random, 14, 69);
      const startedAt = new Date(startOfDay.getTime() + localStartMinute(source, random) * 60_000 + daySessionIndex * 90 * 60_000);
      const durationSeconds = durationMinutes * 60 + randomInt(random, 3, 57);
      const endedAt = new Date(startedAt.getTime() + durationSeconds * 1_000);

      let priorProgress = progressByBook.get(book.book_id) ?? randomInt(random, 3, 28);
      const progressDelta = sessionType === 'listen' ? 0.4 + random() * 3.8 : 1.1 + random() * 7.2;
      if (priorProgress + progressDelta > 98.5) priorProgress = 2 + random() * 7;
      const endProgress = Math.min(99, priorProgress + progressDelta);
      progressByBook.set(book.book_id, endProgress);

      sessions.push({
        userId,
        bookFileId: book.book_file_id,
        bookId: book.book_id,
        sessionId: '',
        source,
        sessionType,
        startedAt,
        endedAt,
        durationSeconds,
        progressDelta: round(progressDelta),
        endProgress: round(endProgress),
      });
    }
  }

  sessions.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  sessions.forEach((session, index) => {
    session.sessionId = `${SESSION_PREFIX}-${userId}-${String(index + 1).padStart(4, '0')}`;
  });
  return sessions;
}

async function insertSessions(client: Client, sessions: SeedSession[]): Promise<void> {
  const columnsPerRow = 11;
  const values: unknown[] = [];
  const placeholders = sessions.map((session, rowIndex) => {
    const offset = rowIndex * columnsPerRow;
    values.push(
      session.userId,
      session.bookFileId,
      session.bookId,
      session.sessionId,
      session.source,
      session.sessionType,
      session.startedAt,
      session.endedAt,
      session.durationSeconds,
      session.progressDelta,
      session.endProgress,
    );
    return `(${Array.from({ length: columnsPerRow }, (_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
  });

  await client.query(
    `insert into reading_sessions
      (user_id, book_file_id, book_id, session_id, source, session_type, started_at, ended_at, duration_seconds, progress_delta, end_progress)
     values ${placeholders.join(', ')}`,
    values,
  );
}

async function rebuildDailyStats(client: Client, userId: number, timeZone: string): Promise<number> {
  const result = await client.query<SessionForDailyStats>(
    `select b.library_id, rs.started_at, rs.ended_at, rs.duration_seconds, rs.progress_delta
     from reading_sessions rs
     inner join books b on b.id = rs.book_id
     where rs.user_id = $1`,
    [userId],
  );
  const sessionsByLibrary = new Map<number, SessionForDailyStats[]>();
  for (const session of result.rows) {
    const sessions = sessionsByLibrary.get(session.library_id) ?? [];
    sessions.push(session);
    sessionsByLibrary.set(session.library_id, sessions);
  }

  await client.query('delete from user_reading_daily_stats where user_id = $1', [userId]);
  const rows: unknown[][] = [];
  for (const [libraryId, sessions] of sessionsByLibrary) {
    const segments = aggregateReadingSessionDailyStats(
      sessions.map((session) => ({
        startedAt: session.started_at,
        endedAt: session.ended_at,
        durationSeconds: session.duration_seconds,
        progressDelta: session.progress_delta,
      })),
      timeZone,
    );
    for (const segment of segments) {
      rows.push([userId, libraryId, segment.day, segment.readingSeconds, segment.progressDelta, segment.sessionsCount]);
    }
  }

  for (let rowOffset = 0; rowOffset < rows.length; rowOffset += 1_000) {
    const chunk = rows.slice(rowOffset, rowOffset + 1_000);
    const values = chunk.flat();
    const placeholders = chunk.map((_, rowIndex) => {
      const parameterOffset = rowIndex * 6;
      return `(${Array.from({ length: 6 }, (_, columnIndex) => `$${parameterOffset + columnIndex + 1}`).join(', ')})`;
    });
    await client.query(
      `insert into user_reading_daily_stats
        (user_id, library_id, day, reading_seconds, progress_delta, sessions_count)
       values ${placeholders.join(', ')}`,
      values,
    );
  }
  return rows.length;
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const requestedUsername = process.env.SEED_APPLE_STATS_USERNAME?.trim();
    const userResult = requestedUsername
      ? await client.query<SeedUser>(
          'select id, username, is_superuser, settings from users where active = true and lower(username) = lower($1) limit 1',
          [requestedUsername],
        )
      : await client.query<SeedUser>(
          'select id, username, is_superuser, settings from users where active = true order by last_login_at desc nulls last, id limit 1',
        );
    const user = userResult.rows[0];
    if (!user) throw new Error(requestedUsername ? `Active user not found: ${requestedUsername}` : 'No active user found');

    const booksResult = await client.query<BookCandidate>(
      `select b.id as book_id, bf.id as book_file_id, lower(bf.format) as format
       from books b
       inner join lateral (
         select id, format
         from book_files
         where book_id = b.id and role = 'content'
         order by (id = b.primary_file_id) desc, sort_order nulls last, id
         limit 1
       ) bf on true
       where b.status = 'present'
         and ($2::boolean or exists (
           select 1 from user_library_access ula where ula.user_id = $1 and ula.library_id = b.library_id
         ))
       order by b.id`,
      [user.id, user.is_superuser],
    );
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const sessions = buildSessions(user.id, timeZone, booksResult.rows);
    console.log(`[seed.apple_stats] [start] userId=${user.id} historyDays=${HISTORY_DAYS} sessions=${sessions.length}`);

    await client.query('begin');
    const deleted = await client.query('delete from reading_sessions where user_id = $1 and session_id like $2', [
      user.id,
      `${SESSION_PREFIX}-${user.id}-%`,
    ]);
    await insertSessions(client, sessions);
    const dailyRows = await rebuildDailyStats(client, user.id, timeZone);
    await client.query('commit');

    const sourceSummary = sessions.reduce(
      (summary, session) => {
        summary[session.source].sessions += 1;
        summary[session.source].hours += session.durationSeconds / 3_600;
        return summary;
      },
      { ios: { sessions: 0, hours: 0 }, watchos: { sessions: 0, hours: 0 } },
    );
    const featuredSessions = sessions.filter((session) => session.bookId === FEATURED_BOOK_ID).length;
    console.log(
      `[seed.apple_stats] [end] userId=${user.id} deleted=${deleted.rowCount ?? 0} inserted=${sessions.length} dailyRows=${dailyRows} iosSessions=${sourceSummary.ios.sessions} iosHours=${sourceSummary.ios.hours.toFixed(1)} watchSessions=${sourceSummary.watchos.sessions} watchHours=${sourceSummary.watchos.hours.toFixed(1)} featuredBookSessions=${featuredSessions}`,
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void run().catch((error: unknown) => {
  console.error(
    `[seed.apple_stats] [fail] errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : error)}"`,
  );
  process.exitCode = 1;
});
