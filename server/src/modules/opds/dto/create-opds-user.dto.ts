import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OPDS_MAX_PAGE_SIZE, OPDS_MIN_PAGE_SIZE } from '@bookorbit/types';

const SORT_ORDER_VALUES = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

export class CreateOpdsUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEnum(SORT_ORDER_VALUES)
  sortOrder?: (typeof SORT_ORDER_VALUES)[number];

  @IsOptional()
  @IsInt()
  @Min(OPDS_MIN_PAGE_SIZE)
  @Max(OPDS_MAX_PAGE_SIZE)
  pageSize?: number;
}
