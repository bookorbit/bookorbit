import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const AUTHOR_LIST_SORTS = ['name', 'bookCount', 'lastAddedAt'] as const;
export type AuthorListSort = (typeof AUTHOR_LIST_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export class ListAuthorsDto {
  @IsOptional()
  @IsString()
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
}
