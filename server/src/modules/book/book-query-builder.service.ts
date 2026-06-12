import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AnyColumn, SQL, and, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules, GroupRule, ReadStatus, Rule, SortSpec } from '@bookorbit/types';
import { DB } from '../../db';
import { isDateKey, resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import * as schema from '../../db/schema';
import { BookSortBuilder } from './book-sort-builder.service';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  bookNarrators,
  books,
  bookTags,
  collectionBooks,
  collections,
  readingProgress,
  userBookRatings,
  userBookStatus,
  genres,
  libraries,
  narrators,
  tags,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookQueryBuilder {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sortBuilder: BookSortBuilder,
  ) {}

  buildWhere(
    filter: GroupRule | null | undefined,
    ctx: {
      accessibleLibraryIds: number[];
      implicitLibraryId?: number;
      userId?: number;
      q?: string;
      timeZone?: string;
      contentFilters?: ContentFilterRules;
    },
  ): SQL | undefined {
    if (ctx.accessibleLibraryIds.length === 0) {
      return sql`1 = 0`;
    }
    const timeZone = resolveTimeZone(ctx.timeZone, 'UTC');

    const clauses: SQL[] = [inArray(books.libraryId, ctx.accessibleLibraryIds)];

    if (ctx.implicitLibraryId !== undefined) {
      clauses.push(eq(books.libraryId, ctx.implicitLibraryId));
    }

    if (filter) {
      clauses.push(this.groupToSql(filter, 0, ctx.userId, timeZone));
    }

    if (ctx.q?.trim()) {
      clauses.push(this.buildQuickSearch(ctx.q.trim()));
    }

    if (ctx.contentFilters) {
      clauses.push(...buildContentFilterClauses(ctx.contentFilters, this.db));
    }

    return and(...clauses);
  }

  buildQuickSearch(q: string): SQL {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

    const existsAuthor = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(eq(bookAuthors.bookId, books.id), ilike(authors.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsNarrator = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookNarrators)
        .innerJoin(narrators, eq(bookNarrators.narratorId, narrators.id))
        .where(and(eq(bookNarrators.bookId, books.id), ilike(narrators.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    return or(ilike(bookMetadata.title, pattern), existsAuthor, ilike(bookMetadata.seriesName, pattern), existsNarrator)!;
  }

  buildOrderBy(sort: SortSpec[], userId?: number): SQL[] {
    return this.sortBuilder.build(sort, userId);
  }

  private groupToSql(node: GroupRule, depth: number, userId?: number, timeZone = 'UTC'): SQL {
    if (depth > 5) throw new BadRequestException('Filter nesting exceeds maximum depth of 5');
    const clauses = node.rules.map((r) =>
      r.type === 'group' ? this.groupToSql(r, depth + 1, userId, timeZone) : this.ruleToSql(r, userId, timeZone),
    );
    return node.join === 'AND' ? and(...clauses)! : or(...clauses)!;
  }

  private ruleToSql(rule: Rule, userId?: number, timeZone = 'UTC'): SQL {
    const { field, operator, value, valueTo } = rule;
    switch (field) {
      case 'title':
        return this.textRuleToSql(bookMetadata.title, operator, value as string);
      case 'publisher':
        return Array.isArray(value)
          ? this.textSetRuleToSql(bookMetadata.publisher, operator, value as string[])
          : this.textRuleToSql(bookMetadata.publisher, operator, value as string);
      case 'language':
        return Array.isArray(value)
          ? this.textSetRuleToSql(bookMetadata.language, operator, value as string[])
          : this.textRuleToSql(bookMetadata.language, operator, value as string);
      case 'series':
        return Array.isArray(value)
          ? this.textSetRuleToSql(bookMetadata.seriesName, operator, value as string[])
          : this.textRuleToSql(bookMetadata.seriesName, operator, value as string);
      case 'publishedYear':
        return this.numericRuleToSql(bookMetadata.publishedYear, operator, value as number, valueTo as number | undefined);
      case 'seriesIndex':
        return this.numericRuleToSql(bookMetadata.seriesIndex, operator, value as number, valueTo as number | undefined);
      case 'pageCount':
        return this.numericRuleToSql(bookMetadata.pageCount, operator, value as number, valueTo as number | undefined);
      case 'rating':
        if (userId === undefined) throw new BadRequestException('rating filter requires an authenticated user');
        return this.ratingRuleToSql(operator, value as number | undefined, valueTo as number | undefined, userId);
      case 'author':
        return this.authorRuleToSql(operator, value as string[]);
      case 'genre':
        return this.genreRuleToSql(operator, value as string[]);
      case 'tag':
        return this.tagRuleToSql(operator, value as string[]);
      case 'collection':
        return this.collectionRuleToSql(operator, value as string[], userId);
      case 'library':
        return this.libraryRuleToSql(operator, value as string[]);
      case 'format':
        return this.formatRuleToSql(operator, value as string[]);
      case 'addedAt':
        return this.dateRuleToSql(operator, value as string | number, valueTo as string | undefined);
      case 'startedAt':
      case 'finishedAt':
        return this.readStatusDateRuleToSql(field, operator, value as string | number, valueTo as string | number | undefined, userId, timeZone);
      case 'fileAvailability':
        return this.statusRuleToSql(operator);
      case 'readProgress':
        return this.readProgressRuleToSql(operator, userId);
      case 'readStatus':
        return this.readStatusRuleToSql(operator, value as string[] | undefined, userId);
      case 'description':
        return this.textRuleToSql(bookMetadata.description, operator, value as string);
      case 'isbn':
        return this.isbnRuleToSql(operator, value as string | undefined);
      case 'metadataScore':
        return this.numericRuleToSql(bookMetadata.metadataScore, operator, value as number, valueTo as number | undefined);
      case 'cover':
        return this.coverRuleToSql(operator);
      default:
        throw new BadRequestException(`Unknown filter field: ${String(field)}`);
    }
  }

  private textRuleToSql(col: AnyColumn, operator: string, value?: string): SQL {
    const VALUE_REQUIRED = ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'notEq'];
    if (VALUE_REQUIRED.includes(operator) && !value) {
      throw new BadRequestException(`Operator '${operator}' requires a non-empty value`);
    }
    switch (operator) {
      case 'contains':
        return ilike(col, `%${escapeLikePattern(value!)}%`);
      case 'notContains':
        return or(isNull(col), not(ilike(col, `%${escapeLikePattern(value!)}%`)))!;
      case 'startsWith':
        return ilike(col, `${escapeLikePattern(value!)}%`);
      case 'endsWith':
        return ilike(col, `%${escapeLikePattern(value!)}`);
      case 'eq':
        return ilike(col, escapeLikePattern(value!));
      case 'notEq':
        return or(isNull(col), not(ilike(col, escapeLikePattern(value!))))!;
      case 'isEmpty':
        return or(isNull(col), eq(col, ''))!;
      case 'isNotEmpty':
        return and(isNotNull(col), ne(col, ''))!;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for text field`);
    }
  }

  private textSetRuleToSql(col: AnyColumn, operator: string, values?: string[]): SQL {
    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(col, values);
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return or(isNull(col), not(inArray(col, values)))!;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for text set field`);
    }
  }

  private numericRuleToSql(col: AnyColumn, operator: string, value?: number, valueTo?: number): SQL {
    switch (operator) {
      case 'eq':
        this.assertNumber(value, operator, 'value');
        return eq(col, value!);
      case 'notEq':
        this.assertNumber(value, operator, 'value');
        return ne(col, value!);
      case 'gt':
        this.assertNumber(value, operator, 'value');
        return gt(col, value!);
      case 'gte':
        this.assertNumber(value, operator, 'value');
        return gte(col, value!);
      case 'lt':
        this.assertNumber(value, operator, 'value');
        return lt(col, value!);
      case 'lte':
        this.assertNumber(value, operator, 'value');
        return lte(col, value!);
      case 'between':
        this.assertNumber(value, operator, 'value');
        this.assertNumber(valueTo, operator, 'valueTo');
        return and(gte(col, value!), lte(col, valueTo!))!;
      case 'isEmpty':
        return isNull(col);
      case 'isNotEmpty':
        return isNotNull(col);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for numeric field`);
    }
  }

  private ratingRuleToSql(operator: string, value: number | undefined, valueTo: number | undefined, userId: number): SQL {
    const ratingExpr = sql<number>`(SELECT ${userBookRatings.rating} FROM ${userBookRatings} WHERE ${userBookRatings.bookId} = ${books.id} AND ${userBookRatings.userId} = ${userId})`;
    switch (operator) {
      case 'eq':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} = ${value!}`;
      case 'notEq':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} <> ${value!}`;
      case 'gt':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} > ${value!}`;
      case 'gte':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} >= ${value!}`;
      case 'lt':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} < ${value!}`;
      case 'lte':
        this.assertNumber(value, operator, 'value');
        return sql`${ratingExpr} <= ${value!}`;
      case 'between':
        this.assertNumber(value, operator, 'value');
        this.assertNumber(valueTo, operator, 'valueTo');
        return sql`${ratingExpr} >= ${value!} and ${ratingExpr} <= ${valueTo!}`;
      case 'isEmpty':
        return sql`${ratingExpr} is null`;
      case 'isNotEmpty':
        return sql`${ratingExpr} is not null`;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for numeric field`);
    }
  }

  private authorRuleToSql(operator: string, values?: string[]): SQL {
    const existsAuthor = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookAuthors.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsAuthor(or(...values.map((v) => ilike(authors.name, `%${v}%`)))!);
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => existsAuthor(ilike(authors.name, `%${v}%`))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsAuthor(or(...values.map((v) => ilike(authors.name, `%${v}%`)))!));
      case 'isEmpty':
        return not(existsAuthor());
      case 'isNotEmpty':
        return existsAuthor();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for author field`);
    }
  }

  private genreRuleToSql(operator: string, values?: string[]): SQL {
    const existsGenre = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookGenres.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookGenres)
        .innerJoin(genres, eq(bookGenres.genreId, genres.id))
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsGenre(or(...values.map((v) => eq(genres.name, v)))!);
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => existsGenre(eq(genres.name, v))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsGenre(or(...values.map((v) => eq(genres.name, v)))!));
      case 'isEmpty':
        return not(existsGenre());
      case 'isNotEmpty':
        return existsGenre();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for genre field`);
    }
  }

  private formatRuleToSql(operator: string, values?: string[]): SQL {
    const existsFormat = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookFiles.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookFiles)
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsFormat(inArray(bookFiles.format, values));
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsFormat(inArray(bookFiles.format, values)));
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for format field`);
    }
  }

  private dateRuleToSql(operator: string, value?: string | number, valueTo?: string): SQL {
    switch (operator) {
      case 'before':
        return lt(books.addedAt, this.parseDate(value, operator, 'value'));
      case 'after':
        return gt(books.addedAt, this.parseDate(value, operator, 'value'));
      case 'between':
        return and(gte(books.addedAt, this.parseDate(value, operator, 'value')), lte(books.addedAt, this.parseDate(valueTo, operator, 'valueTo')))!;
      case 'withinLast': {
        const days = typeof value === 'string' ? Number(value) : value;
        this.assertNumber(days, operator, 'value');
        if (days! < 0) throw new BadRequestException(`Operator '${operator}' requires a non-negative value`);
        return sql`${books.addedAt} >= NOW() - (${days} * INTERVAL '1 day')`;
      }
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for date field`);
    }
  }

  private readStatusDateRuleToSql(
    field: 'startedAt' | 'finishedAt',
    operator: string,
    value: string | number | undefined,
    valueTo: string | number | undefined,
    userId: number | undefined,
    timeZone: string,
  ): SQL {
    if (userId === undefined) {
      throw new BadRequestException(`${field} filter requires an authenticated user`);
    }
    const dateExpr = this.readStatusDateExpr(field, userId, timeZone);
    switch (operator) {
      case 'before':
        return sql`${dateExpr} < ${this.parseDateKey(value, operator, 'value', timeZone)}`;
      case 'after':
        return sql`${dateExpr} > ${this.parseDateKey(value, operator, 'value', timeZone)}`;
      case 'between': {
        const from = this.parseDateKey(value, operator, 'value', timeZone);
        const to = this.parseDateKey(valueTo, operator, 'valueTo', timeZone);
        return sql`${dateExpr} >= ${from} and ${dateExpr} <= ${to}`;
      }
      case 'withinLast': {
        const days = typeof value === 'string' ? Number(value) : value;
        this.assertNumber(days, operator, 'value');
        if (days! < 0) throw new BadRequestException(`Operator '${operator}' requires a non-negative value`);
        const wholeDays = Math.floor(days!);
        const shiftDays = wholeDays > 0 ? wholeDays - 1 : 0;
        return sql`${dateExpr} >= (timezone(${timeZone}, now())::date - ${shiftDays})`;
      }
      case 'isEmpty':
        return sql`${dateExpr} is null`;
      case 'isNotEmpty':
        return sql`${dateExpr} is not null`;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for ${field} field`);
    }
  }

  private readStatusDateExpr(field: 'startedAt' | 'finishedAt', userId: number, timeZone: string): SQL {
    const column = field === 'startedAt' ? userBookStatus.startedAt : userBookStatus.finishedAt;
    return sql`(SELECT (${column} AT TIME ZONE ${timeZone})::date FROM ${userBookStatus} WHERE ${userBookStatus.bookId} = ${books.id} AND ${userBookStatus.userId} = ${userId})`;
  }

  private parseDateKey(value: string | number | undefined, operator: string, key: 'value' | 'valueTo', timeZone: string): string {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
      }
      if (isDateKey(trimmed)) return trimmed;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
      }
      return toDateKeyInTimeZone(parsed, timeZone);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
    }
    return toDateKeyInTimeZone(parsed, timeZone);
  }

  private assertNumber(value: number | undefined, operator: string, key: 'value' | 'valueTo'): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`Operator '${operator}' requires a valid numeric ${key}`);
    }
  }

  private parseDate(value: string | number | undefined, operator: string, key: 'value' | 'valueTo'): Date {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Operator '${operator}' requires a valid date ${key}`);
    }
    return parsed;
  }

  private statusRuleToSql(operator: string): SQL {
    switch (operator) {
      case 'isMissing':
        return eq(books.status, 'missing');
      case 'isPresent':
        return eq(books.status, 'present');
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for status field`);
    }
  }

  private coverRuleToSql(operator: string): SQL {
    switch (operator) {
      case 'isMissing':
        return isNull(bookMetadata.coverSource);
      case 'isPresent':
        return isNotNull(bookMetadata.coverSource);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for cover field`);
    }
  }

  private readProgressRuleToSql(operator: string, userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Reading progress filter requires an authenticated user');
    const existsReadingProgress = (whereClause: SQL) => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(readingProgress)
        .innerJoin(bookFiles, eq(readingProgress.bookFileId, bookFiles.id))
        .where(and(eq(bookFiles.bookId, books.id), whereClause)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'isUnread':
        return not(existsReadingProgress(and(eq(readingProgress.userId, userId), gt(readingProgress.percentage, 0))!));
      case 'isInProgress':
        return existsReadingProgress(
          and(eq(readingProgress.userId, userId), gt(readingProgress.percentage, 0), lt(readingProgress.percentage, 100))!,
        );
      case 'isFinished':
        return existsReadingProgress(and(eq(readingProgress.userId, userId), gte(readingProgress.percentage, 100))!);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for readProgress field`);
    }
  }

  private readStatusRuleToSql(operator: string, values: string[] | undefined, userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Read status filter requires an authenticated user');
    const existsStatus = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(userBookStatus)
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsStatus(inArray(userBookStatus.status, values as ReadStatus[]));
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsStatus(inArray(userBookStatus.status, values as ReadStatus[])));
      case 'isEmpty':
        return not(existsStatus());
      case 'isNotEmpty':
        return existsStatus();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for readStatus field`);
    }
  }

  private tagRuleToSql(operator: string, values?: string[]): SQL {
    const existsTag = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookTags.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookTags)
        .innerJoin(tags, eq(bookTags.tagId, tags.id))
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsTag(or(...values.map((v) => eq(tags.name, v)))!);
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => existsTag(eq(tags.name, v))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsTag(or(...values.map((v) => eq(tags.name, v)))!));
      case 'isEmpty':
        return not(existsTag());
      case 'isNotEmpty':
        return existsTag();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for tag field`);
    }
  }

  private collectionRuleToSql(operator: string, values?: string[], userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Collection filter requires an authenticated user');
    const existsCollection = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(collectionBooks.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(collectionBooks)
        .innerJoin(collections, and(eq(collectionBooks.collectionId, collections.id), eq(collections.userId, userId)))
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsCollection(or(...values.map((v) => eq(collections.name, v)))!);
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsCollection(or(...values.map((v) => eq(collections.name, v)))!));
      case 'isEmpty':
        return not(existsCollection());
      case 'isNotEmpty':
        return existsCollection();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for collection field`);
    }
  }

  private libraryRuleToSql(operator: string, values?: string[]): SQL {
    const existsLibrary = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(libraries.id, books.libraryId)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(libraries)
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return existsLibrary(or(...values.map((v) => eq(libraries.name, v)))!);
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsLibrary(or(...values.map((v) => eq(libraries.name, v)))!));
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for library field`);
    }
  }

  private isbnRuleToSql(operator: string, value?: string): SQL {
    switch (operator) {
      case 'isEmpty':
        return and(isNull(bookMetadata.isbn13), isNull(bookMetadata.isbn10))!;
      case 'isNotEmpty':
        return or(isNotNull(bookMetadata.isbn13), isNotNull(bookMetadata.isbn10))!;
      case 'eq':
        if (!value) throw new BadRequestException("Operator 'eq' requires a non-empty value");
        return or(eq(bookMetadata.isbn13, value), eq(bookMetadata.isbn10, value))!;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for isbn field`);
    }
  }

  static hasSeriesFilter(node: GroupRule | Rule | undefined): boolean {
    if (!node) return false;
    if (node.type === 'rule') return node.field === 'series';
    return node.rules.some((r) => BookQueryBuilder.hasSeriesFilter(r));
  }

  static buildCollapseOrderBy(sort: SortSpec[], userId: number): string {
    if (sort.length === 0) return 'sort_title ASC NULLS LAST, r.id ASC';

    if (!Number.isSafeInteger(userId)) throw new BadRequestException('Invalid userId for collapse order');
    const safeUserId = String(Math.trunc(userId));

    const parts: string[] = [];
    for (const { field, dir } of sort) {
      const D = dir.toUpperCase();
      if (D !== 'ASC' && D !== 'DESC') continue;
      switch (field) {
        case 'title':
        case 'series':
          parts.push(`sort_title ${D} NULLS LAST`);
          break;
        case 'addedAt':
          parts.push(`sort_added_at ${D} NULLS LAST`);
          break;
        case 'seriesIndex':
          parts.push(`series_index ${D} NULLS LAST`);
          if (!sort.some((s) => s.field === 'series')) {
            parts.push(`sort_title ${D} NULLS LAST`);
          }
          break;
        case 'publishedYear':
          parts.push(`published_year ${D} NULLS LAST`);
          break;
        case 'rating':
          parts.push(`rating ${D} NULLS LAST`);
          break;
        case 'publisher':
          parts.push(`publisher ${D} NULLS LAST`);
          break;
        case 'pageCount':
          parts.push(`page_count ${D} NULLS LAST`);
          break;
        case 'updatedAt':
          parts.push(`updated_at ${D} NULLS LAST`);
          break;
        case 'author':
          parts.push(`author_sort_name ${D} NULLS LAST`);
          break;
        case 'fileSize':
          parts.push(`(SELECT bf.size_bytes FROM book_files bf WHERE bf.id = r.primary_file_id) ${D} NULLS LAST`);
          break;
        case 'readProgress':
          parts.push(
            `(SELECT max(rp.percentage) FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = r.id AND rp.user_id = ${safeUserId}) ${D} NULLS LAST`,
          );
          break;
        case 'lastReadAt':
          parts.push(
            `(SELECT max(rp.updated_at) FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = r.id AND rp.user_id = ${safeUserId}) ${D} NULLS LAST`,
          );
          break;
        case 'finishedAt':
          parts.push(`(SELECT ubs.finished_at FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}) ${D} NULLS LAST`);
          break;
        case 'startedAt':
          parts.push(`(SELECT ubs.started_at FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}) ${D} NULLS LAST`);
          break;
        case 'random': {
          const daySeed = Math.floor(Date.now() / 86_400_000);
          const scopedSeed = daySeed + userId;
          parts.push(`md5(r.id::text || ':' || ${scopedSeed}::text) ${D}`);
          parts.push(`r.id ${D}`);
          break;
        }
        case 'readStatus':
          parts.push(`(SELECT ubs.status FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}) ${D} NULLS LAST`);
          break;
        case 'format':
          parts.push(`(SELECT bf.format FROM book_files bf WHERE bf.id = r.primary_file_id) ${D} NULLS LAST`);
          break;
      }
    }
    if (parts.length === 0) parts.push('sort_title ASC NULLS LAST');
    parts.push('r.id ASC');
    return parts.join(', ');
  }
}

function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
