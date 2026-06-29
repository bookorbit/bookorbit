import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import type {
  KoreaderCatalogReadStatusFilter,
  KoreaderCatalogSettableReadStatus,
  KoreaderCatalogSort,
  KoreaderCatalogSortOrder,
} from '@bookorbit/types';

export const KOREADER_CATALOG_SORTS = [
  'title',
  'author',
  'recently_added',
  'recently_updated',
  'recently_read',
  'series',
] as const satisfies readonly KoreaderCatalogSort[];

export const KOREADER_CATALOG_SORT_ORDERS = ['asc', 'desc'] as const satisfies readonly KoreaderCatalogSortOrder[];

export const KOREADER_CATALOG_READ_STATUS_FILTERS = ['unread', 'reading', 'finished'] as const satisfies readonly KoreaderCatalogReadStatusFilter[];

export const KOREADER_CATALOG_SETTABLE_READ_STATUSES = [
  'want_to_read',
  'reading',
  'on_hold',
  'read',
  'abandoned',
] as const satisfies readonly KoreaderCatalogSettableReadStatus[];

function parseIdList(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let raw: unknown[];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  } else if (typeof value === 'number') {
    raw = [value];
  } else {
    return [];
  }
  const ids = raw.map((part) => Number(String(part).trim())).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? [...new Set(ids)] : [];
}

export class KoreaderCatalogBooksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number = 20;

  @IsOptional()
  @IsIn(KOREADER_CATALOG_SORTS)
  sort?: KoreaderCatalogSort = 'recently_added';

  @IsOptional()
  @IsIn(KOREADER_CATALOG_SORT_ORDERS)
  order?: KoreaderCatalogSortOrder;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(KOREADER_CATALOG_READ_STATUS_FILTERS)
  readStatus?: KoreaderCatalogReadStatusFilter;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  format?: string;

  @IsOptional()
  @Transform(({ value }) => parseIdList(value))
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  collectionId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  smartScopeId?: number;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  series?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seriesId?: number;
}

export class KoreaderCatalogSectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;
}

export class KoreaderCatalogSetReadStatusDto {
  @IsIn(KOREADER_CATALOG_SETTABLE_READ_STATUSES)
  status!: KoreaderCatalogSettableReadStatus;
}

export class KoreaderCatalogSetRatingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number | null;
}
