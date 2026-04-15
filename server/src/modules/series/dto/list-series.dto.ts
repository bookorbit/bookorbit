import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const SERIES_LIST_SORTS = ['name', 'bookCount', 'lastAddedAt', 'readProgress'] as const;
export type SeriesListSort = (typeof SERIES_LIST_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const COMPLETION_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export class ListSeriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
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
  @Max(100)
  size?: number = 50;

  @IsOptional()
  @IsIn(SERIES_LIST_SORTS)
  sort?: SeriesListSort = 'name';

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  order?: SortDirection = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @IsIn(COMPLETION_STATUSES)
  completionStatus?: CompletionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  author?: string;
}
