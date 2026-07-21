import { Inject, Injectable } from '@nestjs/common';
import type { BroadReadingGenre, ReadingInsightsSharingLevel } from '@bookorbit/types';
import { and, desc, eq, gte, gt, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class SharedReadingInsightsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  getSharingSettings(userId: number) {
    return this.db.query.users.findFirst({
      columns: { id: true, readingInsightsSharingLevel: true, readingInsightsConsentedAt: true },
      where: eq(schema.users.id, userId),
    });
  }

  async updateSharingSettings(userId: number, sharingLevel: ReadingInsightsSharingLevel, consentedAt: Date | null) {
    const [row] = await this.db
      .update(schema.users)
      .set({ readingInsightsSharingLevel: sharingLevel, readingInsightsConsentedAt: consentedAt })
      .where(eq(schema.users.id, userId))
      .returning({
        sharingLevel: schema.users.readingInsightsSharingLevel,
        consentedAt: schema.users.readingInsightsConsentedAt,
      });
    return row;
  }

  createViewSession(values: typeof schema.sharedReadingInsightViewSessions.$inferInsert) {
    return this.db.transaction(async (tx) => {
      const expiredSessions = tx
        .select({ id: schema.sharedReadingInsightViewSessions.id })
        .from(schema.sharedReadingInsightViewSessions)
        .where(lte(schema.sharedReadingInsightViewSessions.expiresAt, new Date()))
        .limit(1000);
      await tx.delete(schema.sharedReadingInsightViewSessions).where(inArray(schema.sharedReadingInsightViewSessions.id, expiredSessions));
      await tx.insert(schema.sharedReadingInsightViewSessions).values(values);
    });
  }

  getViewSession(id: string, viewerUserId: number, subjectUserId: number) {
    return this.db.query.sharedReadingInsightViewSessions.findFirst({
      where: and(
        eq(schema.sharedReadingInsightViewSessions.id, id),
        eq(schema.sharedReadingInsightViewSessions.viewerUserId, viewerUserId),
        eq(schema.sharedReadingInsightViewSessions.subjectUserId, subjectUserId),
        gt(schema.sharedReadingInsightViewSessions.expiresAt, new Date()),
      ),
    });
  }

  async getSummary(userId: number, days: number) {
    const since = this.since(days);
    const sinceDay = since.toISOString().slice(0, 10);
    const broadGenre = sql<BroadReadingGenre>`case
      when lower(${schema.genres.name}) ~ '(science[ -]?fiction|sci[ -]?fi|wissenschaftliche fiktion|znanstvena fantastika)' then 'science_fiction'
      when lower(${schema.genres.name}) ~ '(fantasy|fantastik|fantasie|fantaz)' then 'fantasy'
      when lower(${schema.genres.name}) ~ '(mystery|thriller|crime|krimi|misdaad|misterij|triler)' then 'mystery_thriller'
      when lower(${schema.genres.name}) ~ '(romance|romantik|romantiek|ljubezen)' then 'romance'
      when lower(${schema.genres.name}) ~ '(horror|grozljiv)' then 'horror'
      when lower(${schema.genres.name}) ~ '(history|histor|geschichte|geschiedenis|zgodovin|biograph|biograf|memoir)' then 'history_biography'
      when lower(${schema.genres.name}) ~ '(science|wissenschaft|wetenschap|znanost|technology|technologie|tehnolog)' then 'science_technology'
      when lower(${schema.genres.name}) ~ '(business|wirtschaft|bedrijf|poslov|econom|ökonom|ekonom)' then 'business_economics'
      when lower(${schema.genres.name}) ~ '(self[ -]?help|personal development|selbsthilfe|zelfhulp|samopomoč)' then 'self_development'
      when lower(${schema.genres.name}) ~ '(society|culture|gesellschaft|maatschapp|družb|kultur|politic|politik|philos|relig)' then 'society_culture'
      when lower(${schema.genres.name}) ~ '(children|young adult|kinder|jugend|kinderen|jeugd|otro|mladin)' then 'children_young_adult'
      when lower(${schema.genres.name}) ~ '(comic|graphic novel|strip|risoroman)' then 'comics_graphic_novels'
      when lower(${schema.genres.name}) ~ '(poetry|lyrik|poëzie|poez)' then 'poetry'
      else 'other'
    end`;
    const genreSessions = this.db
      .select({
        sessionId: schema.readingSessions.id,
        name: broadGenre.as('name'),
        readingSeconds: schema.readingSessions.durationSeconds,
      })
      .from(schema.readingSessions)
      .innerJoin(schema.bookGenres, eq(schema.bookGenres.bookId, schema.readingSessions.bookId))
      .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
      .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
      .groupBy(schema.readingSessions.id, schema.readingSessions.durationSeconds, broadGenre)
      .as('genre_sessions');
    const [daily, statusRows, formats, genres, sources] = await Promise.all([
      this.db
        .select({
          day: schema.userReadingDailyStats.day,
          readingSeconds: sql<number>`coalesce(sum(${schema.userReadingDailyStats.readingSeconds}), 0)::int`,
          sessionsCount: sql<number>`coalesce(sum(${schema.userReadingDailyStats.sessionsCount}), 0)::int`,
        })
        .from(schema.userReadingDailyStats)
        .where(and(eq(schema.userReadingDailyStats.userId, userId), gte(schema.userReadingDailyStats.day, sinceDay)))
        .groupBy(schema.userReadingDailyStats.day)
        .orderBy(schema.userReadingDailyStats.day),
      this.db
        .select({
          booksStarted: sql<number>`count(*) filter (where ${schema.userBookStatus.startedAt} >= ${since})::int`,
          booksCompleted: sql<number>`count(*) filter (where ${schema.userBookStatus.finishedAt} >= ${since})::int`,
        })
        .from(schema.userBookStatus)
        .where(eq(schema.userBookStatus.userId, userId)),
      this.db
        .select({
          name: sql<string>`coalesce(upper(${schema.bookFiles.format}), 'UNKNOWN')`,
          readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int`,
        })
        .from(schema.readingSessions)
        .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.readingSessions.bookFileId))
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(sql`coalesce(upper(${schema.bookFiles.format}), 'UNKNOWN')`)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`))
        .limit(10),
      this.db
        .select({
          name: genreSessions.name,
          readingSeconds: sql<number>`sum(${genreSessions.readingSeconds})::int`,
        })
        .from(genreSessions)
        .groupBy(genreSessions.name)
        .orderBy(desc(sql`sum(${genreSessions.readingSeconds})`))
        .limit(14),
      this.db
        .select({
          source: sql<string>`coalesce(${schema.readingSessions.source}, 'unknown')`,
          readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int`,
          sessionsCount: sql<number>`count(*)::int`,
        })
        .from(schema.readingSessions)
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(schema.readingSessions.source)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`)),
    ]);

    return { daily, status: statusRows[0] ?? { booksStarted: 0, booksCompleted: 0 }, formats, genres, sources };
  }

  async getDetail(userId: number, days: number) {
    const since = this.since(days);
    const [topBooks, recentBooks, topAuthors, topGenres, topSeries, topNarrators] = await Promise.all([
      this.bookRanking(userId, since, 'reading'),
      this.bookRanking(userId, since, 'recent'),
      this.db
        .select({ name: schema.authors.name, readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int` })
        .from(schema.readingSessions)
        .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.readingSessions.bookId))
        .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(schema.authors.id, schema.authors.name)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`))
        .limit(10),
      this.db
        .select({ name: schema.genres.name, readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int` })
        .from(schema.readingSessions)
        .innerJoin(schema.bookGenres, eq(schema.bookGenres.bookId, schema.readingSessions.bookId))
        .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(schema.genres.id, schema.genres.name)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`))
        .limit(10),
      this.db
        .select({ name: schema.bookSeries.name, readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int` })
        .from(schema.readingSessions)
        .innerJoin(schema.bookSeriesMemberships, eq(schema.bookSeriesMemberships.bookId, schema.readingSessions.bookId))
        .innerJoin(schema.bookSeries, eq(schema.bookSeries.id, schema.bookSeriesMemberships.seriesId))
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(schema.bookSeries.id, schema.bookSeries.name)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`))
        .limit(10),
      this.db
        .select({ name: schema.narrators.name, readingSeconds: sql<number>`sum(${schema.readingSessions.durationSeconds})::int` })
        .from(schema.readingSessions)
        .innerJoin(schema.bookNarrators, eq(schema.bookNarrators.bookId, schema.readingSessions.bookId))
        .innerJoin(schema.narrators, eq(schema.narrators.id, schema.bookNarrators.narratorId))
        .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
        .groupBy(schema.narrators.id, schema.narrators.name)
        .orderBy(desc(sql`sum(${schema.readingSessions.durationSeconds})`))
        .limit(10),
    ]);
    return { topBooks, recentBooks, topAuthors, topGenres, topSeries, topNarrators };
  }

  private bookRanking(userId: number, since: Date, order: 'reading' | 'recent') {
    const readingSeconds = sql<number>`sum(${schema.readingSessions.durationSeconds})::int`;
    const lastReadAt = sql<Date>`max(${schema.readingSessions.endedAt})`;
    return this.db
      .select({
        bookId: schema.readingSessions.bookId,
        title: schema.bookMetadata.title,
        readingSeconds,
        lastReadAt,
        status: schema.userBookStatus.status,
      })
      .from(schema.readingSessions)
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.readingSessions.bookId))
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.readingSessions.bookId), eq(schema.userBookStatus.userId, userId)))
      .where(and(eq(schema.readingSessions.userId, userId), gte(schema.readingSessions.startedAt, since)))
      .groupBy(schema.readingSessions.bookId, schema.bookMetadata.title, schema.userBookStatus.status)
      .orderBy(desc(order === 'reading' ? readingSeconds : lastReadAt))
      .limit(10);
  }

  private since(days: number): Date {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    return since;
  }
}
