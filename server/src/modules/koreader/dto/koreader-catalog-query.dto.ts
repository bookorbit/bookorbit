import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { KoreaderCatalogSort } from '@bookorbit/types';

export const KOREADER_CATALOG_SORTS = [
  'title',
  'author',
  'recently_added',
  'recently_updated',
  'series',
] as const satisfies readonly KoreaderCatalogSort[];

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
  @IsString()
  q?: string;

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
}
