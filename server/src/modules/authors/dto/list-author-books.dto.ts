import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { SORT_DIRECTIONS, type SortDirection } from './list-authors.dto';

export const AUTHOR_BOOK_SORTS = ['title', 'publishedYear', 'addedAt'] as const;
export type AuthorBookSort = (typeof AUTHOR_BOOK_SORTS)[number];

export class ListAuthorBooksDto {
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
  @IsIn(AUTHOR_BOOK_SORTS)
  sort?: AuthorBookSort = 'addedAt';

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  order?: SortDirection = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;
}
