import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AnyColumn, SQL, and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { parseCustomRuleFieldId, parseCustomSortFieldId, parseSeriesIndex } from '@bookorbit/types';
import type {
  CommunityRatingProvider,
  ContentFilterRules,
  CustomMetadataFieldTypeMap,
  GroupRule,
  ReadStatus,
  Rule,
  RuleValue,
  SortSpec,
} from '@bookorbit/types';
import { DB } from '../../db';
import { isDateKey, resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike, buildSearchPattern, escapeLikePattern } from '../../common/utils/accent-insensitive-search.utils';
import { compareSeriesIndexSql, seriesIndexSortKey, seriesIndexSortKeySql } from '../../common/utils/series-index-sql.utils';
import * as schema from '../../db/schema';
import { BookSortBuilder, customMetadataValueColumn, resolveRandomSortSeed, type BookSortContext } from './book-sort-builder.service';
import {
  audiobookProgress,
  authors,
  bookAuthors,
  bookCustomMetadataValues,
  bookFiles,
  bookGenres,
  bookCommunityRatings,
  bookMetadata,
  bookNarrators,
  bookSeries,
  bookSeriesMemberships,
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
    const pattern = buildSearchPattern(q);

    const existsAuthor = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(eq(bookAuthors.bookId, books.id), accentInsensitiveIlike(authors.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsNarrator = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookNarrators)
        .innerJoin(narrators, eq(bookNarrators.narratorId, narrators.id))
        .where(and(eq(bookNarrators.bookId, books.id), accentInsensitiveIlike(narrators.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsSeries = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookSeriesMemberships)
        .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
        .where(and(eq(bookSeriesMemberships.bookId, books.id), accentInsensitiveIlike(bookSeries.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    return or(
      accentInsensitiveIlike(bookMetadata.title, pattern),
      existsAuthor,
      accentInsensitiveIlike(bookMetadata.seriesName, pattern),
      existsSeries,
      existsNarrator,
    )!;
  }

  buildOrderBy(sort: SortSpec[], userId?: number, customFieldTypes?: CustomMetadataFieldTypeMap, context?: BookSortContext): SQL[] {
    return this.sortBuilder.build(sort, userId, customFieldTypes, context);
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
    const customFieldId = parseCustomRuleFieldId(field);
    if (customFieldId !== null) {
      return this.customFieldRuleToSql(customFieldId, operator, value, valueTo, timeZone);
    }
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
        return this.seriesRuleToSql(operator, value as string | string[] | undefined);
      case 'publishedDate':
        return this.publishedDateRuleToSql(operator, value as string | number, valueTo as string | number | undefined, timeZone);
      case 'publishedYear':
        return this.numericRuleToSql(bookMetadata.publishedYear, operator, value as number, valueTo as number | undefined);
      case 'seriesIndex':
        return this.seriesIndexRuleToSql(operator, value as string, valueTo as string | undefined);
      case 'pageCount':
        return this.numericRuleToSql(bookMetadata.pageCount, operator, value as number, valueTo as number | undefined);
      case 'rating':
        if (userId === undefined) throw new BadRequestException('rating filter requires an authenticated user');
        return this.ratingRuleToSql(operator, value as number | undefined, valueTo as number | undefined, userId);
      case 'communityRating':
        return this.communityRatingRuleToSql(
          bookCommunityRatings.rating,
          'communityRating',
          operator,
          value as number | undefined,
          valueTo as number | undefined,
          rule.provider,
        );
      case 'communityRatingCount':
        return this.communityRatingRuleToSql(
          bookCommunityRatings.ratingCount,
          'communityRatingCount',
          operator,
          value as number | undefined,
          valueTo as number | undefined,
          rule.provider,
        );
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
      case 'fileSize':
        return this.numericRuleToSql(
          sql<number>`(SELECT ${bookFiles.sizeBytes} FROM ${bookFiles} WHERE ${bookFiles.id} = ${books.primaryFileId})`,
          operator,
          value as number,
          valueTo as number | undefined,
        );
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
      case 'lockStatus':
        return this.lockStatusRuleToSql(operator);
      case 'seriesStatus':
        return this.seriesStatusRuleToSql(operator, userId);
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
        return accentInsensitiveIlike(col, `%${escapeLikePattern(value!)}%`);
      case 'notContains':
        return or(isNull(col), not(accentInsensitiveIlike(col, `%${escapeLikePattern(value!)}%`)))!;
      case 'startsWith':
        return accentInsensitiveIlike(col, `${escapeLikePattern(value!)}%`);
      case 'endsWith':
        return accentInsensitiveIlike(col, `%${escapeLikePattern(value!)}`);
      case 'eq':
        return accentInsensitiveIlike(col, escapeLikePattern(value!));
      case 'notEq':
        return or(isNull(col), not(accentInsensitiveIlike(col, escapeLikePattern(value!))))!;
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

  private numericRuleToSql(col: AnyColumn | SQL, operator: string, value?: number, valueTo?: number): SQL {
    const expression = col as SQL;
    switch (operator) {
      case 'eq':
        this.assertNumber(value, operator, 'value');
        return eq(expression, value!);
      case 'notEq':
        this.assertNumber(value, operator, 'value');
        return ne(expression, value!);
      case 'gt':
        this.assertNumber(value, operator, 'value');
        return gt(expression, value!);
      case 'gte':
        this.assertNumber(value, operator, 'value');
        return gte(expression, value!);
      case 'lt':
        this.assertNumber(value, operator, 'value');
        return lt(expression, value!);
      case 'lte':
        this.assertNumber(value, operator, 'value');
        return lte(expression, value!);
      case 'between':
        this.assertNumber(value, operator, 'value');
        this.assertNumber(valueTo, operator, 'valueTo');
        return and(gte(expression, value!), lte(expression, valueTo!))!;
      case 'isEmpty':
        return isNull(expression);
      case 'isNotEmpty':
        return isNotNull(expression);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for numeric field`);
    }
  }

  /**
   * User-defined custom metadata fields, addressed as `custom:<id>`.
   *
   * Negated operators negate the whole EXISTS so that books carrying no value for the field
   * still match, the same way `notContains` treats a null column on a built-in field.
   */
  private customFieldRuleToSql(
    fieldId: number,
    operator: string,
    value: RuleValue | undefined,
    valueTo: string | number | undefined,
    timeZone: string,
  ): SQL {
    const existsValue = (whereClause: SQL) => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookCustomMetadataValues)
        .where(and(eq(bookCustomMetadataValues.bookId, books.id), eq(bookCustomMetadataValues.fieldId, fieldId), whereClause)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'isEmpty':
        return not(existsValue(this.customValuePresentSql()));
      case 'isNotEmpty':
        return existsValue(this.customValuePresentSql());
      case 'notContains':
        return not(existsValue(this.customValueMatchSql('contains', value, valueTo, timeZone)));
      case 'notEq':
        return not(existsValue(this.customValueMatchSql('eq', value, valueTo, timeZone)));
      default:
        return existsValue(this.customValueMatchSql(operator, value, valueTo, timeZone));
    }
  }

  /** True for a row holding a value of any kind, so presence is answered without knowing the field's type. */
  private customValuePresentSql(): SQL {
    return or(
      isNotNull(bookCustomMetadataValues.valueText),
      isNotNull(bookCustomMetadataValues.valueNumber),
      isNotNull(bookCustomMetadataValues.valueDate),
      isNotNull(bookCustomMetadataValues.valueBoolean),
    )!;
  }

  /**
   * Predicate over a single `book_custom_metadata_values` row.
   *
   * `book_custom_metadata_values` keeps one typed column per value kind, and a field's type is
   * fixed at creation, so the column to compare follows from the operator. The operators more
   * than one type offers (`eq`, `between`) split on the value's runtime type instead. A rule
   * whose operator does not suit its field therefore reads a column that is always null and
   * matches nothing, which is how an archived or deleted field behaves too.
   */
  private customValueMatchSql(operator: string, value: RuleValue | undefined, valueTo: string | number | undefined, timeZone: string): SQL {
    switch (operator) {
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        return this.textRuleToSql(bookCustomMetadataValues.valueText, operator, value as string);
      case 'eq':
        return typeof value === 'number'
          ? this.numericRuleToSql(bookCustomMetadataValues.valueNumber, operator, value)
          : this.textRuleToSql(bookCustomMetadataValues.valueText, operator, value as string);
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return this.numericRuleToSql(bookCustomMetadataValues.valueNumber, operator, value as number, valueTo as number | undefined);
      case 'between':
        return typeof value === 'number'
          ? this.numericRuleToSql(bookCustomMetadataValues.valueNumber, operator, value, valueTo as number | undefined)
          : this.dateExprRuleToSql(sql`${bookCustomMetadataValues.valueDate}`, operator, value as string, valueTo, timeZone, 'custom metadata');
      case 'before':
      case 'after':
      case 'withinLast':
        return this.dateExprRuleToSql(sql`${bookCustomMetadataValues.valueDate}`, operator, value as string, valueTo, timeZone, 'custom metadata');
      case 'isTrue':
        return eq(bookCustomMetadataValues.valueBoolean, true);
      case 'isFalse':
        return eq(bookCustomMetadataValues.valueBoolean, false);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for custom metadata field`);
    }
  }

  private seriesRuleToSql(operator: string, value?: string | string[]): SQL {
    const existsSeries = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookSeriesMemberships.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookSeriesMemberships)
        .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    if (Array.isArray(value)) {
      switch (operator) {
        case 'includesAny':
          if (!value.length) return sql`1 = 0`;
          return existsSeries(inArray(bookSeries.name, value));
        case 'excludesAll':
          if (!value.length) return sql`1 = 1`;
          return not(existsSeries(inArray(bookSeries.name, value)));
        default:
          throw new BadRequestException(`Invalid operator '${operator}' for series field`);
      }
    }

    const VALUE_REQUIRED = ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'notEq'];
    if (VALUE_REQUIRED.includes(operator) && !value) {
      throw new BadRequestException(`Operator '${operator}' requires a non-empty value`);
    }

    switch (operator) {
      case 'contains':
        return existsSeries(accentInsensitiveIlike(bookSeries.name, `%${escapeLikePattern(value!)}%`));
      case 'notContains':
        return not(existsSeries(accentInsensitiveIlike(bookSeries.name, `%${escapeLikePattern(value!)}%`)));
      case 'startsWith':
        return existsSeries(accentInsensitiveIlike(bookSeries.name, `${escapeLikePattern(value!)}%`));
      case 'endsWith':
        return existsSeries(accentInsensitiveIlike(bookSeries.name, `%${escapeLikePattern(value!)}`));
      case 'eq':
        return existsSeries(accentInsensitiveIlike(bookSeries.name, escapeLikePattern(value!)));
      case 'notEq':
        return not(existsSeries(accentInsensitiveIlike(bookSeries.name, escapeLikePattern(value!))));
      case 'isEmpty':
        return not(existsSeries());
      case 'isNotEmpty':
        return existsSeries();
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for series field`);
    }
  }

  private seriesIndexRuleToSql(operator: string, value?: string, valueTo?: string): SQL {
    const existsSeriesIndex = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookSeriesMemberships.bookId, books.id)];
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookSeriesMemberships)
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'eq':
        return existsSeriesIndex(eq(bookSeriesMemberships.seriesIndex, this.requireSeriesIndex(value, operator, 'value')));
      case 'notEq':
        return existsSeriesIndex(ne(bookSeriesMemberships.seriesIndex, this.requireSeriesIndex(value, operator, 'value')));
      case 'gt':
        return existsSeriesIndex(compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '>', this.requireSeriesIndex(value, operator, 'value')));
      case 'gte':
        return existsSeriesIndex(compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '>=', this.requireSeriesIndex(value, operator, 'value')));
      case 'lt':
        return existsSeriesIndex(compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '<', this.requireSeriesIndex(value, operator, 'value')));
      case 'lte':
        return existsSeriesIndex(compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '<=', this.requireSeriesIndex(value, operator, 'value')));
      case 'between':
        return existsSeriesIndex(
          and(
            compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '>=', this.requireSeriesIndex(value, operator, 'value')),
            compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '<=', this.requireSeriesIndex(valueTo, operator, 'valueTo')),
          )!,
        );
      case 'isEmpty':
        return not(existsSeriesIndex(isNotNull(bookSeriesMemberships.seriesIndex)));
      case 'isNotEmpty':
        return existsSeriesIndex(isNotNull(bookSeriesMemberships.seriesIndex));
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for series index field`);
    }
  }

  private requireSeriesIndex(value: unknown, operator: string, name: string): string {
    const parsed = parseSeriesIndex(value);
    if (parsed === null) throw new BadRequestException(`Operator '${operator}' requires a valid series index ${name}`);
    return parsed;
  }

  private ratingRuleToSql(operator: string, value: number | undefined, valueTo: number | undefined, userId: number): SQL {
    const ratingExpr = sql<
      number | null
    >`(SELECT ${userBookRatings.rating} FROM ${userBookRatings} WHERE ${userBookRatings.bookId} = ${books.id} AND ${userBookRatings.userId} = ${userId})`;
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

  private communityRatingRuleToSql(
    metricColumn: AnyColumn,
    field: 'communityRating' | 'communityRatingCount',
    operator: string,
    value: number | undefined,
    valueTo: number | undefined,
    provider: CommunityRatingProvider | undefined,
  ): SQL {
    const selectedProvider = provider && provider !== 'any' ? provider : undefined;
    const existsCommunityRating = (whereClause?: SQL) => {
      const predicates: SQL[] = [eq(bookCommunityRatings.bookId, books.id)];
      if (selectedProvider) predicates.push(eq(bookCommunityRatings.provider, selectedProvider));
      if (whereClause) predicates.push(whereClause);
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookCommunityRatings)
        .where(and(...predicates)!);
      return sql`exists (${sq})`;
    };

    switch (operator) {
      case 'eq':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(eq(metricColumn, value!));
      case 'notEq':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(ne(metricColumn, value!));
      case 'gt':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(gt(metricColumn, value!));
      case 'gte':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(gte(metricColumn, value!));
      case 'lt':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(lt(metricColumn, value!));
      case 'lte':
        this.assertNumber(value, operator, 'value');
        return existsCommunityRating(lte(metricColumn, value!));
      case 'between':
        this.assertNumber(value, operator, 'value');
        this.assertNumber(valueTo, operator, 'valueTo');
        return existsCommunityRating(and(gte(metricColumn, value!), lte(metricColumn, valueTo!))!);
      case 'isEmpty':
        return not(existsCommunityRating(isNotNull(metricColumn)));
      case 'isNotEmpty':
        return existsCommunityRating(isNotNull(metricColumn));
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for ${field} field`);
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
        return existsAuthor(or(...values.map((v) => accentInsensitiveIlike(authors.name, `%${v}%`)))!);
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => existsAuthor(accentInsensitiveIlike(authors.name, `%${v}%`))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(existsAuthor(or(...values.map((v) => accentInsensitiveIlike(authors.name, `%${v}%`)))!));
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
        return sql`${dateExpr} >= (timezone(${timeZone}, now())::date - ${shiftDays}::int)`;
      }
      case 'isEmpty':
        return sql`${dateExpr} is null`;
      case 'isNotEmpty':
        return sql`${dateExpr} is not null`;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for ${field} field`);
    }
  }

  private publishedDateRuleToSql(operator: string, value: string | number | undefined, valueTo: string | number | undefined, timeZone: string): SQL {
    const dateExpr = sql`coalesce(${bookMetadata.publishedDate}, make_date(${bookMetadata.publishedYear}, 1, 1))`;
    switch (operator) {
      case 'isEmpty':
        return and(isNull(bookMetadata.publishedDate), isNull(bookMetadata.publishedYear))!;
      case 'isNotEmpty':
        return or(isNotNull(bookMetadata.publishedDate), isNotNull(bookMetadata.publishedYear))!;
      default:
        return this.dateExprRuleToSql(dateExpr, operator, value, valueTo, timeZone, 'publishedDate');
    }
  }

  /** Date comparisons shared by every date-valued expression: `publishedDate` and custom date fields. */
  private dateExprRuleToSql(
    dateExpr: SQL,
    operator: string,
    value: string | number | undefined,
    valueTo: string | number | undefined,
    timeZone: string,
    fieldLabel: string,
  ): SQL {
    switch (operator) {
      case 'before':
        return sql`${dateExpr} < ${this.parseDateKey(value, operator, 'value', timeZone)}::date`;
      case 'after':
        return sql`${dateExpr} > ${this.parseDateKey(value, operator, 'value', timeZone)}::date`;
      case 'between':
        return sql`${dateExpr} >= ${this.parseDateKey(value, operator, 'value', timeZone)}::date and ${dateExpr} <= ${this.parseDateKey(valueTo, operator, 'valueTo', timeZone)}::date`;
      case 'withinLast': {
        const days = typeof value === 'string' ? Number(value) : value;
        this.assertNumber(days, operator, 'value');
        if (days! < 0) throw new BadRequestException(`Operator '${operator}' requires a non-negative value`);
        const wholeDays = Math.floor(days!);
        const shiftDays = wholeDays > 0 ? wholeDays - 1 : 0;
        return sql`${dateExpr} >= (timezone(${timeZone}, now())::date - ${shiftDays}::int)`;
      }
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for ${fieldLabel} field`);
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

  private lockStatusRuleToSql(operator: string): SQL {
    switch (operator) {
      case 'isLocked':
        return sql`coalesce(cardinality(${bookMetadata.lockedFields}), 0) > 0`;
      case 'isUnlocked':
        return sql`coalesce(cardinality(${bookMetadata.lockedFields}), 0) = 0`;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for lockStatus field`);
    }
  }

  private seriesStatusRuleToSql(operator: string, userId?: number): SQL {
    if (userId === undefined) throw new BadRequestException('Series status filter requires an authenticated user');
    switch (operator) {
      case 'isUpNext':
        return this.upNextInSeriesSql(userId);
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for seriesStatus field`);
    }
  }

  /**
   * Set membership against the same window-function pipeline as the "Up Next in Series" shelf
   * (DashboardRepository.findUpNextInSeriesBookIds): per (library, series), the next unstarted book
   * whose immediately preceding entry is finished. Implemented as a subquery (not a per-row predicate)
   * so results match the shelf exactly. Keep the merged-progress / completion definitions in sync with
   * that repository. Library scoping is omitted here because the window partitions by library already;
   * the surrounding query restricts to the user's accessible libraries.
   */
  private upNextInSeriesSql(userId: number): SQL {
    const mergedProgress = sql`coalesce(
      case
        when rp.last_read_at is null then ab.percentage
        when ab.updated_at is null then rp.percentage
        when rp.last_read_at >= ab.updated_at then rp.percentage
        else ab.percentage
      end,
      rp.percentage,
      ab.percentage,
      0
    )`;
    const isCompleted = sql`(ubs.status in ('read', 'skimmed') or ${mergedProgress} >= 100)`;
    return sql`${books.id} in (
      with scoped as (
        select
          b.id as id,
          b.library_id as library_id,
          m.series_id as series_id,
          m.series_index as series_index,
          b.added_at as added_at,
          ${mergedProgress} as current_progress,
          case when ${isCompleted} then true else false end as is_completed
        from ${books} b
        inner join ${bookMetadata} m on m.book_id = b.id
        left join ${bookFiles} bf on bf.id = b.primary_file_id
        left join ${readingProgress} rp on rp.book_file_id = bf.id and rp.user_id = ${userId}
        left join ${audiobookProgress} ab on ab.book_id = b.id and ab.user_id = ${userId}
        left join ${userBookStatus} ubs on ubs.book_id = b.id and ubs.user_id = ${userId}
        where b.status = 'present' and m.series_id is not null and m.series_index is not null
      ),
      ordered as (
        select
          s.id,
          s.library_id,
          s.series_id,
          s.series_index,
          s.added_at,
          s.is_completed,
          s.current_progress,
          lag(s.is_completed) over (
            partition by s.library_id, s.series_id
            order by ${seriesIndexSortKey(sql.raw('s.series_index'))} asc,
              s.series_index collate "C" asc, s.added_at asc, s.id asc
          ) as previous_is_completed
        from scoped s
      )
      select distinct on (o.library_id, o.series_id) o.id
      from ordered o
      where o.previous_is_completed = true and o.is_completed = false and o.current_progress = 0
      order by o.library_id, o.series_id, ${seriesIndexSortKey(sql.raw('o.series_index'))} asc,
        o.series_index collate "C" asc, o.added_at asc, o.id asc
    )`;
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

    // A book only gets a user_book_status row once a status is set explicitly or derived from
    // progress. Everywhere else (sorting, jump buckets, OPDS, the UI) a missing row reads as
    // 'unread', so filtering on 'unread' has to cover row-less books too.
    const targetsUnread = values?.includes('unread') ?? false;

    switch (operator) {
      case 'includesAny': {
        if (!values?.length) return sql`1 = 0`;
        const matches = existsStatus(inArray(userBookStatus.status, values as ReadStatus[]));
        return targetsUnread ? or(matches, not(existsStatus()))! : matches;
      }
      case 'excludesAll': {
        if (!values?.length) return sql`1 = 1`;
        const matches = existsStatus(inArray(userBookStatus.status, values as ReadStatus[]));
        return targetsUnread ? and(not(matches), existsStatus())! : not(matches);
      }
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

  static hasSeriesSelectionFilter(node: GroupRule | Rule | undefined): boolean {
    if (!node) return false;
    if (node.type === 'rule') return node.field === 'series' && node.operator !== 'isEmpty' && node.operator !== 'isNotEmpty';
    return node.rules.some((r) => BookQueryBuilder.hasSeriesSelectionFilter(r));
  }

  static buildCollapseOrderBy(sort: SortSpec[], userId: number, customFieldTypes?: CustomMetadataFieldTypeMap, context?: BookSortContext): string {
    if (sort.length === 0) return 'sort_title ASC NULLS LAST, r.id ASC';

    if (!Number.isSafeInteger(userId)) throw new BadRequestException('Invalid userId for collapse order');
    const safeUserId = String(Math.trunc(userId));

    const parts: string[] = [];
    for (const { field, dir } of sort) {
      const D = dir.toUpperCase();
      if (D !== 'ASC' && D !== 'DESC') continue;
      // Custom field ids are parsed to bounded integers and the column comes from a fixed
      // map, so both are safe to inline into this raw ORDER BY.
      const customFieldId = parseCustomSortFieldId(field);
      if (customFieldId !== null) {
        const column = customMetadataValueColumn(customFieldId, customFieldTypes);
        if (column) {
          parts.push(
            `(SELECT v.${column} FROM book_custom_metadata_values v WHERE v.book_id = r.id AND v.field_id = ${customFieldId}) ${D} NULLS LAST`,
          );
        }
        continue;
      }
      switch (field) {
        case 'title':
        case 'series':
          parts.push(`sort_title ${D} NULLS LAST`);
          break;
        case 'addedAt':
          parts.push(`sort_added_at ${D} NULLS LAST`);
          break;
        // Precomputed by the collapsed query as the earliest membership position in the group,
        // so a collapsed series sits where its first-added volume was added.
        case 'collectionOrder':
          parts.push(`sort_collection_position ${D} NULLS LAST`);
          break;
        case 'seriesIndex':
          parts.push(`${seriesIndexSortKeySql('series_index')} ${D} NULLS LAST`);
          parts.push(`series_index COLLATE "C" ${D} NULLS LAST`);
          if (!sort.some((s) => s.field === 'series')) {
            parts.push(`sort_title ${D} NULLS LAST`);
          }
          break;
        case 'publishedYear':
          parts.push(`published_year ${D} NULLS LAST`);
          break;
        case 'publishedDate':
          parts.push(`coalesce(published_date, make_date(published_year, 1, 1)) ${D} NULLS LAST`);
          break;
        case 'rating':
          parts.push(`rating ${D} NULLS LAST`);
          break;
        case 'publisher':
          parts.push(`publisher ${D} NULLS LAST`);
          break;
        case 'language':
          parts.push(`r.language ${D} NULLS LAST`);
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
            `(SELECT max(rp.last_read_at) FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = r.id AND rp.user_id = ${safeUserId}) ${D} NULLS LAST`,
          );
          break;
        case 'finishedAt':
          parts.push(`(SELECT ubs.finished_at FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}) ${D} NULLS LAST`);
          break;
        case 'startedAt':
          parts.push(`(SELECT ubs.started_at FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}) ${D} NULLS LAST`);
          break;
        case 'random': {
          const seed = Math.trunc(resolveRandomSortSeed(context, userId));
          parts.push(`md5(r.id::text || ':' || ${seed}::text) ${D}`);
          parts.push(`r.id ${D}`);
          break;
        }
        case 'readStatus':
          parts.push(
            `COALESCE((SELECT ubs.status FROM user_book_status ubs WHERE ubs.book_id = r.id AND ubs.user_id = ${safeUserId}), 'unread') ${D} NULLS LAST`,
          );
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
