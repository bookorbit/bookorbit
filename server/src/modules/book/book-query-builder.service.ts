import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AnyColumn, SQL, and, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { GroupRule, Rule, SortField, SortSpec } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  books,
  bookTags,
  collectionBooks,
  collections,
  readingProgress,
  genres,
  tags,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_FIELD_MAP: Partial<Record<SortField, AnyColumn>> = {
  title: bookMetadata.title,
  series: bookMetadata.seriesName,
  seriesIndex: bookMetadata.seriesIndex,
  addedAt: books.addedAt,
  updatedAt: books.updatedAt,
  publishedYear: bookMetadata.publishedYear,
  pageCount: bookMetadata.pageCount,
  rating: bookMetadata.rating,
  publisher: bookMetadata.publisher,
};

@Injectable()
export class BookQueryBuilder {
  constructor(@Inject(DB) private readonly db: Db) {}

  buildWhere(
    filter: GroupRule | null | undefined,
    ctx: { accessibleLibraryIds: number[]; implicitLibraryId?: number; userId?: number },
  ): SQL | undefined {
    if (ctx.accessibleLibraryIds.length === 0) {
      return sql`1 = 0`;
    }

    const clauses: SQL[] = [inArray(books.libraryId, ctx.accessibleLibraryIds)];

    if (ctx.implicitLibraryId !== undefined) {
      clauses.push(eq(books.libraryId, ctx.implicitLibraryId));
    }

    if (filter) {
      clauses.push(this.groupToSql(filter, 0, ctx.userId));
    }

    return and(...clauses);
  }

  buildOrderBy(sort: SortSpec[], userId?: number): SQL[] {
    if (sort.length === 0) return [sql`${bookMetadata.title} ASC NULLS LAST`];
    const result: SQL[] = [];
    for (const { field, dir } of sort) {
      const D = this.normalizeSortDirection(dir);
      if (!D) continue;
      if (field === 'author') {
        result.push(
          sql.raw(
            `(SELECT a.sort_name FROM book_authors ba INNER JOIN authors a ON ba.author_id = a.id WHERE ba.book_id = books.id ORDER BY ba.display_order LIMIT 1) ${D} NULLS LAST`,
          ),
        );
      } else if (field === 'fileSize') {
        result.push(sql.raw(`(SELECT bf.size_bytes FROM book_files bf WHERE bf.id = books.primary_file_id) ${D} NULLS LAST`));
      } else if (field === 'readProgress') {
        if (userId === undefined) throw new BadRequestException('readProgress sort requires an authenticated user');
        result.push(
          sql`(SELECT rp.percentage FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = books.id AND rp.user_id = ${userId} ORDER BY rp.percentage DESC LIMIT 1) ${sql.raw(D)} NULLS LAST`,
        );
      } else if (field === 'lastReadAt') {
        if (userId === undefined) throw new BadRequestException('lastReadAt sort requires an authenticated user');
        result.push(
          sql`(SELECT rp.updated_at FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = books.id AND rp.user_id = ${userId} ORDER BY rp.updated_at DESC LIMIT 1) ${sql.raw(D)} NULLS LAST`,
        );
      } else if (field === 'finishedAt') {
        if (userId === undefined) throw new BadRequestException('finishedAt sort requires an authenticated user');
        result.push(
          sql`(SELECT ubs.finished_at FROM user_book_status ubs WHERE ubs.book_id = books.id AND ubs.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
      } else if (field === 'random') {
        result.push(sql.raw('RANDOM()'));
      } else {
        const col = SORT_FIELD_MAP[field];
        if (!col) continue;
        result.push(sql`${col} ${sql.raw(D)} NULLS LAST`);
        if (field === 'seriesIndex' && !sort.some((s) => s.field === 'series')) {
          result.push(sql`${bookMetadata.seriesName} ${sql.raw(D)} NULLS LAST`);
        }
      }
    }
    return result.length > 0 ? result : [sql`${bookMetadata.title} ASC NULLS LAST`];
  }

  private normalizeSortDirection(dir: string): 'ASC' | 'DESC' | null {
    const direction = dir.toUpperCase();
    if (direction === 'ASC' || direction === 'DESC') return direction;
    return null;
  }

  private groupToSql(node: GroupRule, depth: number, userId?: number): SQL {
    if (depth > 5) throw new BadRequestException('Filter nesting exceeds maximum depth of 5');
    const clauses = node.rules.map((r) => (r.type === 'group' ? this.groupToSql(r, depth + 1, userId) : this.ruleToSql(r, userId)));
    return node.join === 'AND' ? and(...clauses)! : or(...clauses)!;
  }

  private ruleToSql(rule: Rule, userId?: number): SQL {
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
        return this.numericRuleToSql(bookMetadata.rating, operator, value as number, valueTo as number | undefined);
      case 'author':
        return this.authorRuleToSql(operator, value as string[]);
      case 'genre':
        return this.genreRuleToSql(operator, value as string[]);
      case 'tag':
        return this.tagRuleToSql(operator, value as string[]);
      case 'collection':
        return this.collectionRuleToSql(operator, value as string[], userId);
      case 'format':
        return this.formatRuleToSql(operator, value as string[]);
      case 'addedAt':
        return this.dateRuleToSql(operator, value as string | number, valueTo as string | undefined);
      case 'fileAvailability':
        return this.statusRuleToSql(operator);
      case 'readProgress':
        return this.readProgressRuleToSql(operator, userId);
      case 'description':
        return this.textRuleToSql(bookMetadata.description, operator, value as string);
      case 'isbn':
        return this.isbnRuleToSql(operator, value as string | undefined);
      case 'metadataScore':
        return this.numericRuleToSql(bookMetadata.metadataScore, operator, value as number, valueTo as number | undefined);
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
        return ilike(col, `%${value}%`);
      case 'notContains':
        return not(ilike(col, `%${value}%`));
      case 'startsWith':
        return ilike(col, `${value}%`);
      case 'endsWith':
        return ilike(col, `%${value}`);
      case 'eq':
        return ilike(col, value!);
      case 'notEq':
        return not(ilike(col, value!));
      case 'isEmpty':
        return isNull(col);
      case 'isNotEmpty':
        return isNotNull(col);
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

  private authorRuleToSql(operator: string, values?: string[]): SQL {
    const sq = (whereClause?: SQL) =>
      this.db.select({ bookId: bookAuthors.bookId }).from(bookAuthors).innerJoin(authors, eq(bookAuthors.authorId, authors.id)).where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(or(...values.map((v) => ilike(authors.name, `%${v}%`)))));
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => inArray(books.id, sq(ilike(authors.name, `%${v}%`)))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => ilike(authors.name, `%${v}%`))))));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for author field`);
    }
  }

  private genreRuleToSql(operator: string, values?: string[]): SQL {
    const sq = (whereClause?: SQL) =>
      this.db.select({ bookId: bookGenres.bookId }).from(bookGenres).innerJoin(genres, eq(bookGenres.genreId, genres.id)).where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(or(...values.map((v) => eq(genres.name, v)))));
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => inArray(books.id, sq(eq(genres.name, v)))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => eq(genres.name, v))))));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for genre field`);
    }
  }

  private formatRuleToSql(operator: string, values?: string[]): SQL {
    const sq = (whereClause?: SQL) => this.db.select({ bookId: bookFiles.bookId }).from(bookFiles).where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(inArray(bookFiles.format, values)));
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(inArray(bookFiles.format, values))));
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

  private readProgressRuleToSql(operator: string, userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Reading progress filter requires an authenticated user');
    const sq = (whereClause: SQL) =>
      this.db
        .select({ bookId: bookFiles.bookId })
        .from(readingProgress)
        .innerJoin(bookFiles, eq(readingProgress.bookFileId, bookFiles.id))
        .where(whereClause);

    switch (operator) {
      case 'isUnread':
        return not(inArray(books.id, sq(and(eq(readingProgress.userId, userId), gt(readingProgress.percentage, 0))!)));
      case 'isInProgress':
        return inArray(
          books.id,
          sq(and(eq(readingProgress.userId, userId), gt(readingProgress.percentage, 0), lt(readingProgress.percentage, 100))!),
        );
      case 'isFinished':
        return inArray(books.id, sq(and(eq(readingProgress.userId, userId), gte(readingProgress.percentage, 100))!));
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for readProgress field`);
    }
  }

  private tagRuleToSql(operator: string, values?: string[]): SQL {
    const sq = (whereClause?: SQL) =>
      this.db.select({ bookId: bookTags.bookId }).from(bookTags).innerJoin(tags, eq(bookTags.tagId, tags.id)).where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(or(...values.map((v) => eq(tags.name, v)))));
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => inArray(books.id, sq(eq(tags.name, v)))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => eq(tags.name, v))))));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for tag field`);
    }
  }

  private collectionRuleToSql(operator: string, values?: string[], userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Collection filter requires an authenticated user');
    const sq = (whereClause?: SQL) =>
      this.db
        .select({ bookId: collectionBooks.bookId })
        .from(collectionBooks)
        .innerJoin(collections, and(eq(collectionBooks.collectionId, collections.id), eq(collections.userId, userId)))
        .where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(or(...values.map((v) => eq(collections.name, v)))));
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => eq(collections.name, v))))));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for collection field`);
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
}
