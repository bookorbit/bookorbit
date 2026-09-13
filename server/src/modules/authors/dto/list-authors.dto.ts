import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const AUTHOR_LIST_SORTS = ['name', 'sortName', 'bookCount', 'lastAddedAt', 'lastEnrichedAt'] as const;
export type AuthorListSort = (typeof AUTHOR_LIST_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export class ListAuthorsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
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
  @IsIn(AUTHOR_LIST_SORTS)
  sort?: AuthorListSort = 'name';

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  order?: SortDirection = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasPhoto?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasSortName?: boolean;

  /** "Added recently" filter, expressed in days so the client picks the window. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  addedWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minBookCount?: number;
}

/** Query for the A-Z rail. Same filters as the list, minus paging and sorting. */
export class ListAuthorLettersDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;

  /** Only the two alphabetical sorts have letter buckets; anything else is rejected. */
  @IsOptional()
  @IsIn(['name', 'sortName'])
  sort?: 'name' | 'sortName' = 'name';

  /** Bucket order has to match the list, or every jump index is off. */
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  order?: SortDirection = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasPhoto?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasSortName?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  addedWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minBookCount?: number;
}
