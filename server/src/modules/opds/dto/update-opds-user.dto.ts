import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OPDS_MAX_PAGE_SIZE, OPDS_MIN_PAGE_SIZE } from '@bookorbit/types';

const SORT_ORDER_VALUES = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

export class UpdateOpdsUserDto {
  @IsOptional()
  @IsEnum(SORT_ORDER_VALUES)
  sortOrder?: (typeof SORT_ORDER_VALUES)[number];

  @IsOptional()
  @IsInt()
  @Min(OPDS_MIN_PAGE_SIZE)
  @Max(OPDS_MAX_PAGE_SIZE)
  pageSize?: number;
}
