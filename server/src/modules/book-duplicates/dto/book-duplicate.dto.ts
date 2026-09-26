import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  BOOK_DUPLICATE_GROUP_SORTS,
  BOOK_DUPLICATE_MATCH_REASONS,
  BOOK_DUPLICATE_SORT_ORDERS,
  type BookDuplicateGroupSort,
  type BookDuplicateMatchReason,
  type BookDuplicateSortOrder,
} from '@bookorbit/types';

export class CreateBookDuplicateScanDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsInt()
  @Min(70)
  @Max(100)
  similarityPercent!: number;
}

export class ListBookDuplicateGroupsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_MATCH_REASONS)
  reason?: BookDuplicateMatchReason;

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_GROUP_SORTS)
  sortBy: BookDuplicateGroupSort = 'reclaimable';

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_SORT_ORDERS)
  order: BookDuplicateSortOrder = 'desc';
}

export class CreateBookDuplicateDismissalDto {
  @IsInt()
  @Min(1)
  scanId!: number;

  @IsInt()
  @Min(1)
  groupId!: number;
}
