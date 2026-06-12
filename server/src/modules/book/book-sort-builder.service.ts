import { BadRequestException, Injectable } from '@nestjs/common';
import { AnyColumn, SQL, sql } from 'drizzle-orm';

import type { SortField, SortSpec } from '@bookorbit/types';
import { bookMetadata, books } from '../../db/schema';

const SORT_FIELD_MAP: Partial<Record<SortField, AnyColumn>> = {
  title: bookMetadata.title,
  series: bookMetadata.seriesName,
  seriesIndex: bookMetadata.seriesIndex,
  addedAt: books.addedAt,
  updatedAt: books.updatedAt,
  publishedYear: bookMetadata.publishedYear,
  pageCount: bookMetadata.pageCount,
  publisher: bookMetadata.publisher,
  language: bookMetadata.language,
  metadataScore: bookMetadata.metadataScore,
};

@Injectable()
export class BookSortBuilder {
  build(sort: SortSpec[], userId?: number): SQL[] {
    const result: SQL[] = [];
    for (const { field, dir } of sort) {
      const D = this.normalizeDir(dir);
      if (!D) continue;
      this.appendField(result, field, D, sort, userId);
    }
    if (result.length === 0) result.push(sql`${bookMetadata.title} ASC NULLS LAST`);
    result.push(sql`${books.id} ASC`);
    return result;
  }

  private normalizeDir(dir: string): 'ASC' | 'DESC' | null {
    const d = dir.toUpperCase();
    return d === 'ASC' || d === 'DESC' ? d : null;
  }

  private appendField(result: SQL[], field: SortField, D: 'ASC' | 'DESC', allSorts: SortSpec[], userId?: number): void {
    switch (field) {
      case 'author':
        result.push(sql`${books.primaryAuthorSortName} ${sql.raw(D)} NULLS LAST`);
        break;
      case 'fileSize':
        result.push(sql.raw(`(SELECT bf.size_bytes FROM book_files bf WHERE bf.id = books.primary_file_id) ${D} NULLS LAST`));
        break;
      case 'readProgress':
        if (userId === undefined) throw new BadRequestException('readProgress sort requires an authenticated user');
        result.push(
          sql`(SELECT max(rp.percentage) FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = books.id AND rp.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'lastReadAt':
        if (userId === undefined) throw new BadRequestException('lastReadAt sort requires an authenticated user');
        result.push(
          sql`(SELECT max(rp.updated_at) FROM reading_progress rp INNER JOIN book_files bf ON rp.book_file_id = bf.id WHERE bf.book_id = books.id AND rp.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'finishedAt':
        if (userId === undefined) throw new BadRequestException('finishedAt sort requires an authenticated user');
        result.push(
          sql`(SELECT ubs.finished_at FROM user_book_status ubs WHERE ubs.book_id = books.id AND ubs.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'startedAt':
        if (userId === undefined) throw new BadRequestException('startedAt sort requires an authenticated user');
        result.push(
          sql`(SELECT ubs.started_at FROM user_book_status ubs WHERE ubs.book_id = books.id AND ubs.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'rating':
        if (userId === undefined) throw new BadRequestException('rating sort requires an authenticated user');
        result.push(
          sql`(SELECT ubr.rating FROM user_book_ratings ubr WHERE ubr.book_id = books.id AND ubr.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'random': {
        const daySeed = Math.floor(Date.now() / 86_400_000);
        const scopedSeed = daySeed + (userId ?? 0);
        result.push(sql`md5(${books.id}::text || ':' || ${scopedSeed}::text) ${sql.raw(D)}`);
        result.push(sql`${books.id} ${sql.raw(D)}`);
        break;
      }
      case 'readStatus':
        if (userId === undefined) throw new BadRequestException('readStatus sort requires an authenticated user');
        result.push(
          sql`(SELECT ubs.status FROM user_book_status ubs WHERE ubs.book_id = books.id AND ubs.user_id = ${userId}) ${sql.raw(D)} NULLS LAST`,
        );
        break;
      case 'format':
        result.push(sql.raw(`(SELECT bf.format FROM book_files bf WHERE bf.id = books.primary_file_id) ${D} NULLS LAST`));
        break;
      default: {
        const col = SORT_FIELD_MAP[field];
        if (!col) return;
        result.push(sql`${col} ${sql.raw(D)} NULLS LAST`);
        if (field === 'seriesIndex' && !allSorts.some((s) => s.field === 'series')) {
          result.push(sql`${bookMetadata.seriesName} ${sql.raw(D)} NULLS LAST`);
        }
      }
    }
  }
}
