import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import {
  BOOK_DUPLICATE_ACTIONS,
  BOOK_DUPLICATE_BOOK_ACTIONS,
  BOOK_DUPLICATE_GROUP_SORTS,
  BOOK_DUPLICATE_KINDS,
  BOOK_DUPLICATE_MATCH_REASONS,
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  BOOK_DUPLICATE_SORT_ORDERS,
  BOOK_MERGE_MAX_BOOKS,
  DUPLICATE_KEEP_RULES,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateGroupSort,
  type BookDuplicateKind,
  type BookDuplicateMatchReason,
  type BookDuplicateSortOrder,
  type DuplicateKeepRule,
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

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_KINDS)
  kind: BookDuplicateKind = 'duplicate';
}

export class CreateBookDuplicateDismissalDto {
  @IsInt()
  @Min(1)
  scanId!: number;

  @IsInt()
  @Min(1)
  groupId!: number;
}

export class RestoreBookDuplicateDismissalDto {
  @IsOptional()
  @IsIn(BOOK_DUPLICATE_KINDS)
  kind: BookDuplicateKind = 'duplicate';
}

export class BookDuplicateResolutionBookChoiceDto {
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsIn(BOOK_DUPLICATE_BOOK_ACTIONS)
  action!: BookDuplicateBookAction;
}

export class BookDuplicateResolutionGroupDto {
  @IsInt()
  @Min(1)
  groupId!: number;

  @IsInt()
  @Min(1)
  keeperId!: number;

  @IsIn(BOOK_DUPLICATE_ACTIONS)
  action!: BookDuplicateAction;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOK_MERGE_MAX_BOOKS * 5)
  @ValidateNested({ each: true })
  @Type(() => BookDuplicateResolutionBookChoiceDto)
  perBook?: BookDuplicateResolutionBookChoiceDto[];
}

export class BookDuplicateResolutionAllGroupsDto {
  @IsOptional()
  @IsIn(BOOK_DUPLICATE_KINDS)
  kind?: BookDuplicateKind;

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_MATCH_REASONS)
  reason?: BookDuplicateMatchReason;

  @IsIn(DUPLICATE_KEEP_RULES)
  keepRule!: DuplicateKeepRule;

  @IsOptional()
  @IsIn(BOOK_DUPLICATE_ACTIONS)
  action?: BookDuplicateAction;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  excludeGroupIds?: number[];
}

export class CreateBookDuplicateResolutionDto {
  @IsInt()
  @Min(1)
  scanId!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS)
  @ArrayUnique((group: BookDuplicateResolutionGroupDto) => group.groupId)
  @ValidateNested({ each: true })
  @Type(() => BookDuplicateResolutionGroupDto)
  groups?: BookDuplicateResolutionGroupDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BookDuplicateResolutionAllGroupsDto)
  allGroups?: BookDuplicateResolutionAllGroupsDto;

  @IsOptional()
  @IsBoolean()
  removeIdenticalCopies?: boolean;
}
