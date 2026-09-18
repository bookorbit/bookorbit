import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { OPDS_MAX_PAGE_SIZE, OPDS_MIN_PAGE_SIZE } from '@bookorbit/types';

const SORT_ORDER_VALUES = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

export class UpdateOpdsUserDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(SORT_ORDER_VALUES)
  sortOrder?: (typeof SORT_ORDER_VALUES)[number];

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(OPDS_MIN_PAGE_SIZE)
  @Max(OPDS_MAX_PAGE_SIZE)
  pageSize?: number;
}
