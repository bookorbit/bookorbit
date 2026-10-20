import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryVariant, KOREADER_DASHBOARD_SECTION_TYPES } from '@bookorbit/types';
import { MAX_OFFSET_ROWS } from '../../../common/constants/pagination.constants';
import type {
  KoreaderCatalogReadStatusFilter,
  KoreaderCatalogSectionFilter,
  KoreaderCatalogSectionSort,
  KoreaderCatalogSettableReadStatus,
  KoreaderCatalogSort,
  KoreaderCatalogSortOrder,
  KoreaderDashboardSectionType,
} from '@bookorbit/types';
import { KOREADER_DEVICE_ID_REGEX } from './koreader-device-param.dto';

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

export const KOREADER_CATALOG_SECTION_SORTS = ['name', 'name_desc', 'books'] as const satisfies readonly KoreaderCatalogSectionSort[];

export const KOREADER_CATALOG_SECTION_FILTERS = ['reading', 'finished'] as const satisfies readonly KoreaderCatalogSectionFilter[];

export const KOREADER_CATALOG_SETTABLE_READ_STATUSES = [
  'unread',
  'want_to_read',
  'reading',
  'on_hold',
  'read',
  'abandoned',
] as const satisfies readonly KoreaderCatalogSettableReadStatus[];

function parseQueryBoolean(value: unknown): unknown {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

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

  // Starts the page at any entry instead of a multiple of size, so a reader
  // keeps the same first book when the page size changes. Wins over page.
  // Sent only to a server advertising catalogListsV2.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET_ROWS)
  offset?: number;

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

  // Jump buckets cost a pass over the whole filtered set, so they are computed
  // only on request and only for the title and author sorts.
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  buckets?: boolean;
}

// Bulk download enumeration. Deliberately not a subclass of the list query:
// the manifest has one fixed cursor order and no page/sort inputs.
export class KoreaderCatalogManifestQueryDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  variant?: ReadAloudDeliveryVariant;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number = 100;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(KOREADER_DEVICE_ID_REGEX)
  deviceId?: string;

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
  @ArrayMaxSize(500)
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

// Omitting `section` yields the pre-section dashboard response, so a plugin
// that predates the configurable row keeps working against a newer server.
export class KoreaderCatalogDashboardQueryDto {
  @IsOptional()
  @IsIn(KOREADER_DASHBOARD_SECTION_TYPES)
  section?: KoreaderDashboardSectionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  smartScopeId?: number;
}

export class KoreaderCatalogDashboardSectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  smartScopeId?: number;
}

export class KoreaderCatalogSectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // As on the books list: the first entry of the page, winning over page.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET_ROWS)
  offset?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  @IsOptional()
  @IsIn(KOREADER_CATALOG_SECTION_SORTS)
  sort?: KoreaderCatalogSectionSort;

  @IsOptional()
  @IsIn(KOREADER_CATALOG_SECTION_FILTERS)
  filter?: KoreaderCatalogSectionFilter;
}

export class KoreaderCatalogBookDetailQueryDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  variant?: ReadAloudDeliveryVariant;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(KOREADER_DEVICE_ID_REGEX)
  deviceId?: string;
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

export class KoreaderCatalogDownloadQueryDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  variant?: ReadAloudDeliveryVariant;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  selection?: string;
}
