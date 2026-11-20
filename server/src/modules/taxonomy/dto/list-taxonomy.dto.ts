import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { TAXONOMY_INDEX_SORTS, type TaxonomyIndexSort } from '@bookorbit/types';

export const TAXONOMY_PAGE_MAX_SIZE = 200;

export class ListTaxonomyDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAXONOMY_PAGE_MAX_SIZE)
  size?: number = 50;

  @IsOptional()
  @IsIn(TAXONOMY_INDEX_SORTS)
  sort?: TaxonomyIndexSort = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;
}
