import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AnyColumn, SQL, and, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { GroupRule, Rule, SortField, SortSpec } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookTags, tags } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SORT_FIELD_MAP: Record<SortField, AnyColumn> = {
  title: bookMetadata.title,
  addedAt: books.addedAt,
  publishedYear: bookMetadata.publishedYear,
  pageCount: bookMetadata.pageCount,
  seriesIndex: bookMetadata.seriesIndex,
};

@Injectable()
export class BookQueryBuilder {
  constructor(@Inject(DB) private readonly db: Db) {}

  buildWhere(filter: GroupRule | null | undefined, ctx: { accessibleLibraryIds: number[]; implicitLibraryId?: number }): SQL | undefined {
    if (ctx.accessibleLibraryIds.length === 0) {
      return sql`1 = 0`;
    }

    const clauses: SQL[] = [inArray(books.libraryId, ctx.accessibleLibraryIds)];

    if (ctx.implicitLibraryId !== undefined) {
      clauses.push(eq(books.libraryId, ctx.implicitLibraryId));
    }

    if (filter) {
      clauses.push(this.groupToSql(filter, 0));
    }

    return and(...clauses);
  }

  buildOrderBy(sort: SortSpec[]): SQL[] {
    if (sort.length === 0) return [sql`${bookMetadata.title} ASC NULLS LAST`];
    const result: SQL[] = [];
    for (const { field, dir } of sort) {
      const col = SORT_FIELD_MAP[field];
      result.push(sql`${col} ${sql.raw(dir.toUpperCase())} NULLS LAST`);
      if (field === 'seriesIndex') {
        result.push(sql`${bookMetadata.seriesName} ${sql.raw(dir.toUpperCase())} NULLS LAST`);
      }
    }
    return result;
  }

  private groupToSql(node: GroupRule, depth: number): SQL {
    if (depth > 5) throw new BadRequestException('Filter nesting exceeds maximum depth of 5');
    const clauses = node.rules.map((r) => (r.type === 'group' ? this.groupToSql(r, depth + 1) : this.ruleToSql(r)));
    return node.join === 'AND' ? and(...clauses)! : or(...clauses)!;
  }

  private ruleToSql(rule: Rule): SQL {
    const { field, operator, value, valueTo } = rule;
    switch (field) {
      case 'title':
        return this.textRuleToSql(bookMetadata.title, operator, value as string);
      case 'publisher':
        return this.textRuleToSql(bookMetadata.publisher, operator, value as string);
      case 'language':
        return this.textRuleToSql(bookMetadata.language, operator, value as string);
      case 'series':
        return this.textRuleToSql(bookMetadata.seriesName, operator, value as string);
      case 'publishedYear':
        return this.numericRuleToSql(bookMetadata.publishedYear, operator, value as number, valueTo as number | undefined);
      case 'seriesIndex':
        return this.numericRuleToSql(bookMetadata.seriesIndex, operator, value as number, valueTo as number | undefined);
      case 'pageCount':
        return this.numericRuleToSql(bookMetadata.pageCount, operator, value as number, valueTo as number | undefined);
      case 'author':
        return this.authorRuleToSql(operator, value as string[]);
      case 'tag':
        return this.tagRuleToSql(operator, value as string[]);
      case 'format':
        return this.formatRuleToSql(operator, value as string[]);
      case 'addedAt':
        return this.dateRuleToSql(operator, value as string | number, valueTo as string | undefined);
      default:
        throw new BadRequestException(`Unknown filter field: ${field}`);
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

  private numericRuleToSql(col: AnyColumn, operator: string, value?: number, valueTo?: number): SQL {
    switch (operator) {
      case 'eq':
        return eq(col, value!);
      case 'notEq':
        return ne(col, value!);
      case 'gt':
        return gt(col, value!);
      case 'gte':
        return gte(col, value!);
      case 'lt':
        return lt(col, value!);
      case 'lte':
        return lte(col, value!);
      case 'between':
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
        return inArray(books.id, sq(or(...values.map((v) => ilike(authors.name, `%${v}%`)))!));
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => inArray(books.id, sq(ilike(authors.name, `%${v}%`)))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => ilike(authors.name, `%${v}%`)))!)));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for author field`);
    }
  }

  private tagRuleToSql(operator: string, values?: string[]): SQL {
    const sq = (whereClause?: SQL) =>
      this.db.select({ bookId: bookTags.bookId }).from(bookTags).innerJoin(tags, eq(bookTags.tagId, tags.id)).where(whereClause);

    switch (operator) {
      case 'includesAny':
        if (!values?.length) return sql`1 = 0`;
        return inArray(books.id, sq(or(...values.map((v) => eq(tags.name, v)))!));
      case 'includesAll':
        if (!values?.length) return sql`1 = 0`;
        return and(...values.map((v) => inArray(books.id, sq(eq(tags.name, v)))))!;
      case 'excludesAll':
        if (!values?.length) return sql`1 = 1`;
        return not(inArray(books.id, sq(or(...values.map((v) => eq(tags.name, v)))!)));
      case 'isEmpty':
        return not(inArray(books.id, sq()));
      case 'isNotEmpty':
        return inArray(books.id, sq());
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for tag field`);
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
        return lt(books.addedAt, new Date(value as string));
      case 'after':
        return gt(books.addedAt, new Date(value as string));
      case 'between':
        return and(gte(books.addedAt, new Date(value as string)), lte(books.addedAt, new Date(valueTo!)))!;
      case 'withinLast':
        return sql`${books.addedAt} >= NOW() - (${value} * INTERVAL '1 day')`;
      default:
        throw new BadRequestException(`Invalid operator '${operator}' for date field`);
    }
  }
}
