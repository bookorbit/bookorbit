import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { SORT_DIRECTIONS, type SortDirection } from './list-series.dto';

export const SERIES_BOOK_SORTS = ['seriesIndex', 'title', 'addedAt'] as const;
export type SeriesBookSort = (typeof SERIES_BOOK_SORTS)[number];

export class ListSeriesBooksDto {
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
  @IsIn(SERIES_BOOK_SORTS)
  sort?: SeriesBookSort = 'seriesIndex';

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  order?: SortDirection = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  /** Fold linked editions into one card, the one this user read last, else the main one. Released clients never send it. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  collapseLinked?: boolean;
}
